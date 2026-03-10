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
 * Given accounts and a values map, calculate the value of an indicator
 * by summing all accounts whose tipo is in acumula list.
 */
export function calcIndicador(
  contas: ContaRow[],
  valoresMap: Record<string, number | null>,
  acumula: string[]
): number {
  let total = 0;
  for (const c of contas) {
    if (c.is_total) continue; // skip group headers to avoid double-counting
    if (acumula.includes(c.tipo)) {
      const val = valoresMap[c.id];
      if (val != null) total += val;
    }
  }
  return total;
}

/**
 * Determines after which account type each indicator should be inserted.
 * Returns a map: accountType -> indicator to insert after the last account of that type.
 */
export const indicadorAfterType: Record<string, IndicadorDRE> = {
  custo_variavel: indicadoresDRE[0], // Margem de Contribuição after custos variáveis
  despesa_fixa: indicadoresDRE[1],   // Resultado Operacional after despesas fixas
  investimento: indicadoresDRE[2],   // Resultado após Investimentos after investimentos
  financeiro: indicadoresDRE[3],     // Resultado de Caixa after financeiro
};

/**
 * Build ordered rows (contas + indicators) for rendering.
 * Inserts an indicator row after the last account of each type group.
 */
export type DreRow =
  | { type: 'conta'; conta: ContaRow }
  | { type: 'indicador'; indicador: IndicadorDRE };

export function buildDreRows(contas: ContaRow[]): DreRow[] {
  const rows: DreRow[] = [];
  
  for (let i = 0; i < contas.length; i++) {
    const conta = contas[i];
    rows.push({ type: 'conta', conta });
    
    // Check if this is the last account of its type group
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
