import { type ContaRow } from '@/lib/plano-contas-utils';

export interface IndicadorDRE {
  key: string;
  nome: string;
  tipo: 'indicador';
  /** Which account types to sum for this indicator */
  acumula: string[];
  borderColor: string;
}

/**
 * The 4 standard DRE financial indicators, in order.
 * Each one accumulates account types up to that point.
 */
export const indicadoresDRE: IndicadorDRE[] = [
  {
    key: 'margem_contribuicao',
    nome: '= MARGEM DE CONTRIBUIÇÃO',
    tipo: 'indicador',
    acumula: ['receita', 'custo_variavel'],
    borderColor: 'border-l-primary',
  },
  {
    key: 'resultado_operacional',
    nome: '= RESULTADO OPERACIONAL',
    tipo: 'indicador',
    acumula: ['receita', 'custo_variavel', 'despesa_fixa'],
    borderColor: 'border-l-amber',
  },
  {
    key: 'resultado_apos_investimentos',
    nome: '= RESULTADO APÓS INVESTIMENTOS',
    tipo: 'indicador',
    acumula: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'],
    borderColor: 'border-l-[#9333EA]',
  },
  {
    key: 'resultado_caixa',
    nome: '= RESULTADO DE CAIXA',
    tipo: 'indicador',
    acumula: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'],
    borderColor: 'border-l-txt-muted',
  },
];

/**
 * Determines if a conta at a given index is a "leaf" (has no children).
 * A conta is a leaf if:
 * - It's not marked as is_total
 * - The next conta in order has nivel <= current (meaning it's a sibling or higher), or there is no next conta
 */
export function isLeafConta(contas: ContaRow[], index: number): boolean {
  const conta = contas[index];
  if (conta.is_total) return false;
  const next = contas[index + 1];
  return !next || next.nivel <= conta.nivel;
}

/**
 * Returns only leaf contas (those without children) to avoid double-counting.
 */
export function getLeafContas(contas: ContaRow[]): ContaRow[] {
  return contas.filter((_, i) => isLeafConta(contas, i));
}

/**
 * Given accounts and a values map, calculate the value of an indicator
 * by summing only LEAF accounts whose tipo is in acumula list.
 * This prevents double-counting parent/sub-group accounts.
 */
export function calcIndicador(
  contas: ContaRow[],
  valoresMap: Record<string, number | null>,
  acumula: string[]
): number {
  let total = 0;
  for (let i = 0; i < contas.length; i++) {
    if (!isLeafConta(contas, i)) continue;
    const c = contas[i];
    if (acumula.includes(c.tipo)) {
      const val = valoresMap[c.id];
      if (val != null) total += val;
    }
  }
  return total;
}

/**
 * Sum only leaf contas of a given type. Useful for faturamento, custos, etc.
 */
export function sumLeafByTipo(
  contas: ContaRow[],
  valoresMap: Record<string, number | null>,
  tipo: string
): number {
  return calcIndicador(contas, valoresMap, [tipo]);
}

/**
 * Determines after which account type each indicator should be inserted.
 */
export const indicadorAfterType: Record<string, IndicadorDRE> = {
  custo_variavel: indicadoresDRE[0],
  despesa_fixa: indicadoresDRE[1],
  investimento: indicadoresDRE[2],
  financeiro: indicadoresDRE[3],
};

/**
 * Build ordered rows (contas + indicators) for rendering.
 */
export type DreRow =
  | { type: 'conta'; conta: ContaRow }
  | { type: 'indicador'; indicador: IndicadorDRE };

export function buildDreRows(contas: ContaRow[]): DreRow[] {
  const rows: DreRow[] = [];
  
  for (let i = 0; i < contas.length; i++) {
    const conta = contas[i];
    rows.push({ type: 'conta', conta });
    
    const nextConta = contas[i + 1];
    if (!nextConta || nextConta.tipo !== conta.tipo) {
      const indicator = indicadorAfterType[conta.tipo];
      if (indicator) {
        rows.push({ type: 'indicador', indicador: indicator });
      }
    }
  }
  
  return rows;
}
