import * as XLSX from 'xlsx';

export interface ContaParseada {
  nomeOriginal: string;
  nome: string;
  prefixo: '+' | '-';
  tipo: string;
  nivel: 0 | 1 | 2;
  secaoNome: string;
  grupoNome: string | null;
  valores: Record<string, number>;
}

export interface ResultadoParseNibo {
  mesesDisponiveis: string[];
  anoReferencia: number;
  contas: ContaParseada[];
  secoes: string[];
  totalContas: number;
  totalGrupos: number;
  totalCategorias: number;
}

const LINHAS_IGNORADAS = [
  'margem de contribuição',
  'margem de contribuicao',
  '%',
  'resultado',
  'indicadores',
  'resultado operacional',
  'variação de caixa',
  'variacao de caixa',
];

function detectTipoPorSecao(secaoNome: string): string {
  const upper = secaoNome.toUpperCase();
  if (upper.includes('RECEITA')) return 'receita';
  if (upper.includes('CUSTO')) return 'custo_variavel';
  if (upper.includes('DESPESA')) return 'despesa_fixa';
  if (upper.includes('INVESTIMENTO')) return 'investimento';
  if (upper.includes('FINANCIAMENTO')) return 'financeiro';
  return 'despesa_fixa';
}

function limparPrefixo(nome: string): { nome: string; prefixo: '+' | '-' } {
  const trimmed = nome.trim();
  if (trimmed.startsWith('(+)')) return { nome: trimmed.replace(/^\(\+\)\s*/, '').trim(), prefixo: '+' };
  if (trimmed.startsWith('(-)')) return { nome: trimmed.replace(/^\(-\)\s*/, '').trim(), prefixo: '-' };
  // Try to detect sign from first character after paren
  const match = trimmed.match(/^\(([+-])\)/);
  if (match) return { nome: trimmed.replace(/^\([+-]\)\s*/, '').trim(), prefixo: match[1] as '+' | '-' };
  return { nome: trimmed, prefixo: '-' };
}

function isAllUpperCase(str: string): boolean {
  // Check if the alphabetic characters are all uppercase
  const alpha = str.replace(/[^a-zA-ZÀ-ÿ]/g, '');
  return alpha.length > 0 && alpha === alpha.toUpperCase();
}

function isSecaoLine(nome: string): boolean {
  const trimmed = nome.trim();
  // Seção: all uppercase, does NOT start with ( 
  if (trimmed.startsWith('(')) return false;
  return isAllUpperCase(trimmed) && trimmed.length > 2;
}

function isGrupoLine(nome: string): boolean {
  const trimmed = nome.trim();
  if (!trimmed.startsWith('(')) return false;
  // Extract part after the prefix
  const afterPrefix = trimmed.replace(/^\([+-]\)\s*/, '').trim();
  return isAllUpperCase(afterPrefix);
}

function deveIgnorar(nome: string): boolean {
  const lower = nome.trim().toLowerCase();
  return LINHAS_IGNORADAS.some((ig) => lower === ig || lower.startsWith(ig));
}

export function parseNiboXlsx(file: File): Promise<ResultadoParseNibo> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        // Try to find "Realizado" sheet, fallback to first
        const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes('realizado')) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

        // Step 1: Parse header row to get month names
        const mesesDisponiveis: string[] = [];
        const mesColIndices: number[] = [];
        let anoReferencia = new Date().getFullYear();

        for (let c = 1; c <= range.e.c; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
          if (!cell || !cell.v) continue;
          const val = String(cell.v).trim();
          // Check if it's a 4-digit year
          if (/^\d{4}$/.test(val)) {
            anoReferencia = parseInt(val, 10);
            break; // Stop before the year column
          }
          mesesDisponiveis.push(val);
          mesColIndices.push(c);
        }

        // Step 2: Parse data rows
        const contas: ContaParseada[] = [];
        const secoes: string[] = [];
        let secaoAtual = '';
        let tipoAtual = 'despesa_fixa';
        let grupoAtual: string | null = null;
        let ordem = 0;

        for (let r = range.s.r + 1; r <= range.e.r; r++) {
          const nameCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
          if (!nameCell || !nameCell.v) continue;
          const nomeOriginal = String(nameCell.v).trim();
          if (!nomeOriginal) continue;
          if (deveIgnorar(nomeOriginal)) continue;

          // Classify line type
          if (isSecaoLine(nomeOriginal)) {
            // SEÇÃO (nivel 0)
            secaoAtual = nomeOriginal;
            tipoAtual = detectTipoPorSecao(nomeOriginal);
            grupoAtual = null;
            if (!secoes.includes(nomeOriginal)) secoes.push(nomeOriginal);
            continue; // Don't add to contas
          }

          // Extract values for this row
          const valores: Record<string, number> = {};
          for (let mi = 0; mi < mesesDisponiveis.length; mi++) {
            const c = mesColIndices[mi];
            const valCell = sheet[XLSX.utils.encode_cell({ r, c })];
            let val = 0;
            if (valCell) {
              if (typeof valCell.v === 'number') {
                val = Math.abs(valCell.v);
              } else if (typeof valCell.v === 'string') {
                const parsed = parseFloat(valCell.v.replace(/[^\d,.-]/g, '').replace(',', '.'));
                if (!isNaN(parsed)) val = Math.abs(parsed);
              }
            }
            valores[mesesDisponiveis[mi]] = val;
          }

          const { nome, prefixo } = limparPrefixo(nomeOriginal);

          if (isGrupoLine(nomeOriginal)) {
            // GRUPO (nivel 1)
            grupoAtual = nomeOriginal;
            contas.push({
              nomeOriginal,
              nome,
              prefixo,
              tipo: tipoAtual,
              nivel: 1,
              secaoNome: secaoAtual,
              grupoNome: null,
              valores,
            });
          } else if (nomeOriginal.startsWith('(')) {
            // CATEGORIA (nivel 2)
            contas.push({
              nomeOriginal,
              nome,
              prefixo,
              tipo: tipoAtual,
              nivel: 2,
              secaoNome: secaoAtual,
              grupoNome: grupoAtual,
              valores,
            });
          }
          // If it doesn't match any pattern, skip
          ordem++;
        }

        const totalGrupos = contas.filter((c) => c.nivel === 1).length;
        const totalCategorias = contas.filter((c) => c.nivel === 2).length;

        resolve({
          mesesDisponiveis,
          anoReferencia,
          contas,
          secoes,
          totalContas: contas.length,
          totalGrupos,
          totalCategorias,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

const MES_MAP: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};

export function mesAbrevParaNumero(abrev: string): string | null {
  const lower = abrev.toLowerCase().substring(0, 3);
  return MES_MAP[lower] || null;
}

export function buildCompetencia(mesAbrev: string, ano: number): string {
  const num = mesAbrevParaNumero(mesAbrev);
  if (!num) return `${ano}-01-01`;
  return `${ano}-${num}-01`;
}

export function mesAbrevParaNomeCompleto(abrev: string, ano: number): string {
  const num = mesAbrevParaNumero(abrev);
  if (!num) return `${abrev} ${ano}`;
  const d = new Date(ano, parseInt(num, 10) - 1, 1);
  const label = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}
