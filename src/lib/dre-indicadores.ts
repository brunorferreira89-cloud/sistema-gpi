import { type ContaRow } from '@/lib/plano-contas-utils';

export interface IndicadorDRE {
  key: string;
  nome: string;
  tipo: 'indicador';
  acumula: string[];
  borderColor: string;
}

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
    nome: '= GERAÇÃO DE CAIXA',
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
 * Leaf contas are nivel=2 (categorias) — the only level where values are stored.
 */
export function isLeafConta(contas: ContaRow[], index: number): boolean {
  const conta = contas[index];
  if (conta.is_total) return false;
  return conta.nivel === 2;
}

export function getLeafContas(contas: ContaRow[]): ContaRow[] {
  return contas.filter((c) => c.nivel === 2 && !c.is_total);
}

/**
 * Calculate indicator value by summing only nivel=2 (leaf) accounts.
 * Receita adds positively, all other types subtract.
 */
export function calcIndicador(
  contas: ContaRow[],
  valoresMap: Record<string, number | null>,
  acumula: string[]
): number {
  let total = 0;
  const leafs = getLeafContas(contas);
  for (const c of leafs) {
    if (acumula.includes(c.tipo)) {
      const val = valoresMap[c.id];
      if (val != null) {
        if (c.tipo === 'receita') {
          total += val;
        } else {
          total -= val;
        }
      }
    }
  }
  return total;
}

/**
 * Sum leaf contas of a given type (always positive sum for display).
 */
export function sumLeafByTipo(
  contas: ContaRow[],
  valoresMap: Record<string, number | null>,
  tipo: string
): number {
  let total = 0;
  const leafs = getLeafContas(contas);
  for (const c of leafs) {
    if (c.tipo === tipo) {
      const val = valoresMap[c.id];
      if (val != null) total += val;
    }
  }
  return total;
}

/**
 * Sum children (nivel=2) under a specific parent (nivel=1 subgrupo).
 */
export function sumChildrenOfGroup(
  contas: ContaRow[],
  valoresMap: Record<string, number | null>,
  groupId: string
): number | null {
  const children = contas.filter((c) => c.conta_pai_id === groupId && c.nivel === 2);
  if (children.length === 0) return null;
  let hasAnyValue = false;
  let total = 0;
  for (const c of children) {
    const val = valoresMap[c.id];
    if (val != null) {
      hasAnyValue = true;
      total += val;
    }
  }
  return hasAnyValue ? total : null;
}

/**
 * Sum all subgrupos (nivel=1) under a specific grupo (nivel=0).
 */
export function sumChildrenOfSection(
  contas: ContaRow[],
  valoresMap: Record<string, number | null>,
  sectionId: string
): number | null {
  const groups = contas.filter((c) => c.conta_pai_id === sectionId && c.nivel === 1);
  if (groups.length === 0) {
    // Maybe categorias directly under section
    const directChildren = contas.filter((c) => c.conta_pai_id === sectionId && c.nivel === 2);
    if (directChildren.length === 0) return null;
    let hasAny = false;
    let total = 0;
    for (const c of directChildren) {
      const val = valoresMap[c.id];
      if (val != null) { hasAny = true; total += val; }
    }
    return hasAny ? total : null;
  }
  let hasAny = false;
  let total = 0;
  for (const g of groups) {
    const groupTotal = sumChildrenOfGroup(contas, valoresMap, g.id);
    if (groupTotal != null) {
      hasAny = true;
      total += groupTotal;
    }
  }
  return hasAny ? total : null;
}

export const indicadorAfterType: Record<string, IndicadorDRE> = {
  custo_variavel: indicadoresDRE[0],
  despesa_fixa: indicadoresDRE[1],
  investimento: indicadoresDRE[2],
  financeiro: indicadoresDRE[3],
};

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
