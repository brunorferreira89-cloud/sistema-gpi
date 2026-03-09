export type ContaTipo = 'receita' | 'custo_variavel' | 'despesa_fixa' | 'investimento' | 'financeiro';

export interface ContaRow {
  id: string;
  cliente_id: string;
  conta_pai_id: string | null;
  nome: string;
  tipo: ContaTipo;
  nivel: number;
  ordem: number;
  is_total: boolean;
  created_at: string | null;
}

export interface ImportedConta {
  nome: string;
  nivel: number;
  tipo: ContaTipo;
  is_total: boolean;
  selected: boolean;
}

export const tipoLabels: Record<ContaTipo, string> = {
  receita: 'Receita',
  custo_variavel: 'Custo Variável',
  despesa_fixa: 'Despesa Fixa',
  investimento: 'Investimento',
  financeiro: 'Financeiro',
};

export const tipoBadgeColors: Record<ContaTipo, string> = {
  receita: 'bg-primary/10 text-primary',
  custo_variavel: 'bg-red/10 text-red',
  despesa_fixa: 'bg-amber/10 text-amber',
  investimento: 'bg-[#9333EA]/10 text-[#9333EA]',
  financeiro: 'bg-txt-muted/10 text-txt-sec',
};

export function classifyTipo(nome: string): ContaTipo {
  const n = nome.toLowerCase();
  if (/receita|faturamento|venda/i.test(n)) return 'receita';
  if (/cmv|compra|insumo|mercadoria|imposto|taxa|cartão/i.test(n)) return 'custo_variavel';
  if (/aluguel|energia|internet|folha|salário|salario|contador|administrativ|manutenção|manutencao|seguro|software/i.test(n)) return 'despesa_fixa';
  if (/marketing|publicidade|obra|reforma|equipamento|capex/i.test(n)) return 'investimento';
  if (/empréstimo|emprestimo|financiamento|juros|retirada|sócio|socio/i.test(n)) return 'financeiro';
  return 'despesa_fixa';
}

export function isTotalLine(nome: string): boolean {
  return /total|subtotal|resultado|margem|lucro|geração|geracao/i.test(nome);
}

export function getFaturamentoReferencia(faixa: string): number {
  switch (faixa) {
    case 'faixa1': return 115000;
    case 'faixa2': return 225000;
    case 'faixa3': return 400000;
    case 'faixa4': return 500000;
    default: return 115000;
  }
}

export function getMetaSugerida(tipo: ContaTipo, nome: string, faturamentoRef: number): { valor: number | null; label: string } {
  const n = nome.toLowerCase();
  if (tipo === 'custo_variavel' && /cmv|compra|mercadoria/i.test(n)) {
    return { valor: Math.round(faturamentoRef * 0.38), label: 'Benchmark GPI: CMV < 38% do faturamento' };
  }
  if (tipo === 'despesa_fixa' && /folha|salário|salario/i.test(n)) {
    return { valor: Math.round(faturamentoRef * 0.25), label: 'Benchmark GPI: CMO < 25% do faturamento' };
  }
  if (tipo === 'receita') {
    return { valor: null, label: 'Definir meta de crescimento' };
  }
  return { valor: null, label: '' };
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

export function getCompetenciaAtual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
