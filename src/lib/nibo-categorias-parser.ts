import * as XLSX from 'xlsx';

export interface CategoriaParseada {
  grupo: string;
  subgrupo: string;
  categoria: string;
  nomeLimpo: string;
  tipo: string;
  prefixo: '+' | '-';
  ordem: number;
}

export interface ResultadoParseCategorias {
  valido: boolean;
  erro?: string;
  grupos: string[];
  subgrupos: { nome: string; grupo: string }[];
  categorias: CategoriaParseada[];
  avisos: string[];
}

const GRUPO_TIPO_MAP: Record<string, string> = {
  'receitas operacionais': 'receita',
  'custos operacionais': 'custo_variavel',
  'despesas operacionais e outras receitas': 'despesa_fixa',
  'atividades de investimento': 'investimento',
  'atividades de financiamento': 'financeiro',
};

function detectTipoPorGrupo(grupo: string): string {
  const lower = grupo.toLowerCase().trim();
  return GRUPO_TIPO_MAP[lower] || 'despesa_fixa';
}

function limparPrefixo(nome: string): string {
  return nome.replace(/^\(\+\)\s*/, '').replace(/^\(-\)\s*/, '').trim();
}

export function parseCategoriasNibo(file: File): Promise<ResultadoParseCategorias> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');

        // Validate header
        const headerCell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c: 0 })];
        const headerVal = headerCell?.v ? String(headerCell.v).trim().toLowerCase() : '';
        if (!headerVal.includes('grupo')) {
          resolve({
            valido: false,
            erro: 'Arquivo não reconhecido. No Nibo, exporte Configurações → Categorias → Exportar (não a DRE).',
            grupos: [],
            subgrupos: [],
            categorias: [],
            avisos: [],
          });
          return;
        }

        const gruposSet = new Map<string, boolean>();
        const subgruposSet = new Map<string, { nome: string; grupo: string }>();
        const categorias: CategoriaParseada[] = [];
        const avisos: string[] = [];
        let ordem = 0;

        for (let r = range.s.r + 1; r <= range.e.r; r++) {
          const grupoCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
          const subgrupoCell = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
          const categoriaCell = sheet[XLSX.utils.encode_cell({ r, c: 2 })];
          const tipoCell = sheet[XLSX.utils.encode_cell({ r, c: 3 })];

          const grupo = grupoCell?.v ? String(grupoCell.v).trim() : '';
          let subgrupo = subgrupoCell?.v ? String(subgrupoCell.v).trim() : '';
          const categoria = categoriaCell?.v ? String(categoriaCell.v).trim() : '';
          const tipoColuna = tipoCell?.v ? String(tipoCell.v).trim() : '';

          if (!grupo || !categoria) continue;

          // Track grupo
          if (!gruposSet.has(grupo)) {
            gruposSet.set(grupo, true);
          }

          // Handle null subgrupo
          if (!subgrupo) {
            subgrupo = '(+) OUTROS';
            if (!avisos.some((a) => a.includes('sem subgrupo'))) {
              avisos.push('Algumas categorias estão sem subgrupo e foram agrupadas em "OUTROS".');
            }
          }

          // Track subgrupo
          const subKey = `${grupo}|||${subgrupo}`;
          if (!subgruposSet.has(subKey)) {
            subgruposSet.set(subKey, { nome: subgrupo, grupo });
          }

          // Determine prefix from Tipo column
          const prefixo: '+' | '-' = tipoColuna.toLowerCase().includes('entrada') ? '+' : '-';
          const tipo = detectTipoPorGrupo(grupo);
          const nomeLimpo = limparPrefixo(categoria);

          categorias.push({
            grupo,
            subgrupo,
            categoria,
            nomeLimpo,
            tipo,
            prefixo,
            ordem: ordem++,
          });
        }

        const grupos = Array.from(gruposSet.keys());
        const subgrupos = Array.from(subgruposSet.values());

        resolve({
          valido: true,
          grupos,
          subgrupos,
          categorias,
          avisos,
        });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
