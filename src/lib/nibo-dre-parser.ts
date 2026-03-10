import * as XLSX from 'xlsx';

export interface ValorParseado {
  nomeOriginal: string;
  nomeLimpo: string;
  valores: Record<string, number>;
}

export interface ResultadoParseValores {
  valido: boolean;
  erro?: string;
  mesesDisponiveis: string[];
  anoReferencia: number;
  valores: ValorParseado[];
}

const LINHAS_IGNORADAS = [
  'resultado', 'indicadores', '%',
  'margem de contribuição', 'margem de contribuicao',
  'resultado operacional', 'variação de caixa', 'variacao de caixa',
];

const MES_MAP: Record<string, string> = {
  jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06',
  jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12',
};

function limparPrefixo(nome: string): string {
  return nome.replace(/^\(\+\)\s*/, '').replace(/^\(-\)\s*/, '').trim();
}

function deveIgnorar(nome: string): boolean {
  const lower = nome.trim().toLowerCase();
  return LINHAS_IGNORADAS.some((ig) => lower === ig || lower.startsWith(ig));
}

/**
 * A real category has mixed case after removing prefix.
 * Totalizers (groups/subgroups) are ALL UPPERCASE.
 */
function isCategoriaReal(nome: string | null | undefined): boolean {
  if (!nome || nome.trim() === '') return false;
  // Remove prefix (+) or (-)
  const semPrefixo = nome.replace(/^\s*\([+-]\)\s*/, '').trim();
  // Extract only letters (ignore numbers, spaces, hyphens, symbols)
  const apenasLetras = semPrefixo.replace(/[^a-zA-ZÀ-ú]/g, '');
  // No letters → skip
  if (apenasLetras.length === 0) return false;
  // All uppercase → totalizer → skip
  if (apenasLetras === apenasLetras.toUpperCase()) return false;
  // Has at least one lowercase letter → real category → import
  return true;
}

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

export function parseValoresNibo(file: File): Promise<ResultadoParseValores> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });

        const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes('realizado')) || workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

        // Validate header
        const headerA = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: 0 })];
        const headerVal = headerA?.v ? String(headerA.v).trim().toLowerCase() : '';
        if (!headerVal.includes('resultado')) {
          resolve({
            valido: false,
            erro: 'Arquivo não reconhecido. No Nibo, exporte Relatórios → DRE → Exportar Excel.',
            mesesDisponiveis: [],
            anoReferencia: new Date().getFullYear(),
            valores: [],
          });
          return;
        }

        // Parse header for months
        const mesesDisponiveis: string[] = [];
        const mesColIndices: number[] = [];
        let anoReferencia = new Date().getFullYear();

        for (let c = 1; c <= range.e.c; c++) {
          const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })];
          if (!cell || !cell.v) continue;
          const val = String(cell.v).trim();
          if (/^\d{4}$/.test(val)) {
            anoReferencia = parseInt(val, 10);
            break;
          }
          mesesDisponiveis.push(val);
          mesColIndices.push(c);
        }

        if (mesesDisponiveis.length === 0) {
          resolve({
            valido: false,
            erro: 'Nenhum mês encontrado no cabeçalho da planilha.',
            mesesDisponiveis: [],
            anoReferencia,
            valores: [],
          });
          return;
        }

        // Parse data rows
        const valores: ValorParseado[] = [];

        for (let r = range.s.r + 1; r <= range.e.r; r++) {
          const nameCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
          if (!nameCell || !nameCell.v) continue;
          const nomeOriginal = String(nameCell.v).trim();
          if (!nomeOriginal) continue;
          if (deveIgnorar(nomeOriginal)) continue;
          if (!nomeOriginal.startsWith('(')) continue; // Only lines with prefix (+) or (-)
          if (!isCategoriaReal(nomeOriginal)) continue; // Skip totalizers (all uppercase)

          const valoresRow: Record<string, number> = {};
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
            valoresRow[mesesDisponiveis[mi]] = val;
          }

          valores.push({
            nomeOriginal,
            nomeLimpo: limparPrefixo(nomeOriginal),
            valores: valoresRow,
          });
        }

        resolve({
          valido: true,
          mesesDisponiveis,
          anoReferencia,
          valores,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
