import { supabase } from '@/integrations/supabase/client';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas, sumLeafByTipo, calcIndicador } from '@/lib/dre-indicadores';

export interface KpiIndicador {
  id: string;
  cliente_id: string | null;
  nome: string;
  descricao: string | null;
  tipo_fonte: string;
  conta_id: string | null;
  totalizador_key: string | null;
  limite_verde: number;
  limite_ambar: number;
  direcao: string;
  ativo: boolean;
  ordem: number;
}

export interface IndicadorCalculado {
  indicador: KpiIndicador;
  pct: number | null;
  valor: number | null;
  faturamento: number;
  status: 'verde' | 'ambar' | 'vermelho';
  pontos: number;
  detalhe: { nome: string; valor: number; pct: number; contaId: string }[];
}

const TOTALIZADOR_TIPOS: Record<string, string[]> = {
  MC: ['receita', 'custo_variavel'],
  RO: ['receita', 'custo_variavel', 'despesa_fixa'],
  RAI: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'],
  GC: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'],
};

const TOTALIZADOR_FORMULAS: Record<string, string> = {
  MC: 'MC% = (Faturamento − Custos Variáveis) / Faturamento × 100',
  RO: 'RO% = (MC − Despesas Fixas) / Faturamento × 100',
  RAI: 'RAI% = (RO − Investimentos) / Faturamento × 100',
  GC: 'GC% = (RAI + Financeiro) / Faturamento × 100',
};

const CMO_KEYWORDS = ['pessoal', 'salário', 'salario', 'folha', 'cmo', 'mão de obra', 'mao de obra', 'pró-labore', 'pro-labore'];

export function getFormula(ind: KpiIndicador): string {
  if (ind.tipo_fonte === 'totalizador' && ind.totalizador_key) {
    return TOTALIZADOR_FORMULAS[ind.totalizador_key] || `${ind.nome}% = Valor / Faturamento × 100`;
  }
  if (ind.nome === 'CMV') return 'CMV% = Custos Variáveis / Faturamento × 100';
  if (ind.nome === 'CMO') return 'CMO% = Custos de Pessoal / Faturamento × 100';
  return `${ind.nome}% = Valor / Faturamento × 100`;
}

export async function fetchMergedIndicadores(clienteId: string): Promise<KpiIndicador[]> {
  const { data: defaults } = await supabase
    .from('kpi_indicadores' as any)
    .select('*')
    .is('cliente_id', null)
    .order('ordem');

  const { data: overrides } = await supabase
    .from('kpi_indicadores' as any)
    .select('*')
    .eq('cliente_id', clienteId)
    .order('ordem');

  const overrideMap = new Map<string, any>();
  (overrides || []).forEach((o: any) => overrideMap.set(o.nome, o));

  const result: KpiIndicador[] = [];
  const usedNames = new Set<string>();

  for (const d of (defaults || [])) {
    const nome = (d as any).nome;
    const override = overrideMap.get(nome);
    if (override) {
      result.push(override as KpiIndicador);
    } else {
      result.push(d as unknown as KpiIndicador);
    }
    usedNames.add(nome);
  }

  for (const o of (overrides || [])) {
    if (!usedNames.has((o as any).nome)) {
      result.push(o as unknown as KpiIndicador);
    }
  }

  return result.sort((a, b) => a.ordem - b.ordem);
}

export async function fetchAllIndicadores(clienteId: string): Promise<KpiIndicador[]> {
  const { data: defaults } = await supabase
    .from('kpi_indicadores' as any)
    .select('*')
    .is('cliente_id', null)
    .order('ordem');

  const { data: overrides } = await supabase
    .from('kpi_indicadores' as any)
    .select('*')
    .eq('cliente_id', clienteId)
    .order('ordem');

  const overrideMap = new Map<string, any>();
  (overrides || []).forEach((o: any) => overrideMap.set(o.nome, o));

  const result: KpiIndicador[] = [];
  const usedNames = new Set<string>();

  for (const d of (defaults || [])) {
    const nome = (d as any).nome;
    const override = overrideMap.get(nome);
    if (override) {
      result.push(override as KpiIndicador);
    } else {
      result.push(d as unknown as KpiIndicador);
    }
    usedNames.add(nome);
  }

  for (const o of (overrides || [])) {
    if (!usedNames.has((o as any).nome)) {
      result.push(o as unknown as KpiIndicador);
    }
  }

  return result.sort((a, b) => a.ordem - b.ordem);
}

export function calcularIndicadores(
  indicadores: KpiIndicador[],
  contas: ContaRow[],
  valoresMap: Record<string, number | null>,
): IndicadorCalculado[] {
  const leafs = getLeafContas(contas);
  const faturamento = sumLeafByTipo(contas, valoresMap, 'receita');

  return indicadores.map(ind => {
    let valor: number | null = null;
    const detalhe: { nome: string; valor: number; pct: number; contaId: string }[] = [];

    if (ind.tipo_fonte === 'totalizador' && ind.totalizador_key) {
      const tipos = TOTALIZADOR_TIPOS[ind.totalizador_key];
      if (tipos) {
        valor = calcIndicador(contas, valoresMap, tipos);
        tipos.forEach(tipo => {
          const tipoVal = sumLeafByTipo(contas, valoresMap, tipo);
          if (tipoVal !== 0) {
            const label = tipo === 'receita' ? 'Receitas' : tipo === 'custo_variavel' ? 'Custos Variáveis' : tipo === 'despesa_fixa' ? 'Despesas Fixas' : tipo === 'investimento' ? 'Investimentos' : 'Financeiro';
            const n0Conta = contas.find(c => c.nivel === 0 && c.tipo === tipo);
            detalhe.push({ nome: label, valor: tipoVal, pct: faturamento ? (Math.abs(tipoVal) / Math.abs(faturamento)) * 100 : 0, contaId: n0Conta?.id ?? '' });
          }
        });
      }
    } else if (ind.tipo_fonte === 'subgrupo') {
      const contaIds: string[] = (ind as any).conta_ids && Array.isArray((ind as any).conta_ids) && (ind as any).conta_ids.length > 0
        ? (ind as any).conta_ids
        : ind.conta_id ? [ind.conta_id] : [];
      
      if (contaIds.length > 0) {
        let total = 0;
        let hasAny = false;
        for (const cid of contaIds) {
          const conta = contas.find(c => c.id === cid);
          if (!conta) continue;

          if (conta.nivel === 1) {
            // N1: sum all N2 children
            const children = contas.filter(c => c.conta_pai_id === cid && c.nivel === 2);
            children.forEach(c => {
              const v = valoresMap[c.id];
              if (v != null) {
                hasAny = true;
                total += v;
                detalhe.push({ nome: c.nome.replace(/^\([+-]\)\s*/, ''), valor: v, pct: faturamento ? (Math.abs(v) / Math.abs(faturamento)) * 100 : 0, contaId: c.id });
              }
            });
          } else if (conta.nivel === 2) {
            // N2: sum directly
            const v = valoresMap[cid];
            if (v != null) {
              hasAny = true;
              total += v;
              detalhe.push({ nome: conta.nome.replace(/^\([+-]\)\s*/, ''), valor: v, pct: faturamento ? (Math.abs(v) / Math.abs(faturamento)) * 100 : 0, contaId: conta.id });
            }
          }
        }
        valor = hasAny ? total : null;
      } else {
        // Legacy fallback for CMV/CMO without conta_ids
        if (ind.nome === 'CMV') {
          valor = sumLeafByTipo(contas, valoresMap, 'custo_variavel');
          leafs.filter(c => c.tipo === 'custo_variavel').forEach(c => {
            const v = valoresMap[c.id];
            if (v != null) detalhe.push({ nome: c.nome.replace(/^\([+-]\)\s*/, ''), valor: v, pct: faturamento ? (Math.abs(v) / Math.abs(faturamento)) * 100 : 0, contaId: c.id });
          });
        } else if (ind.nome === 'CMO') {
          const pessoalSubs = contas.filter(c => c.nivel === 1 && CMO_KEYWORDS.some(kw => c.nome.toLowerCase().includes(kw)));
          let total = 0;
          let hasAny = false;
          pessoalSubs.forEach(sub => {
            const children = contas.filter(c => c.conta_pai_id === sub.id && c.nivel === 2);
            children.forEach(c => {
              const v = valoresMap[c.id];
              if (v != null) {
                hasAny = true;
                total += v;
                detalhe.push({ nome: c.nome.replace(/^\([+-]\)\s*/, ''), valor: v, pct: faturamento ? (Math.abs(v) / Math.abs(faturamento)) * 100 : 0, contaId: c.id });
              }
            });
          });
          valor = hasAny ? total : null;
        }
      }
    }

    const pct = valor != null && faturamento ? (Math.abs(valor) / Math.abs(faturamento)) * 100 : null;

    // For totalizadores with 'maior_melhor', pct can be negative (e.g. negative GC)
    // Use signed pct for status check
    let signedPct = pct;
    if (ind.tipo_fonte === 'totalizador' && valor != null && faturamento) {
      signedPct = (valor / Math.abs(faturamento)) * 100;
    }

    const status = getStatus(ind.direcao === 'maior_melhor' ? signedPct : pct, ind);
    const pontos = status === 'verde' ? 100 : status === 'ambar' ? 50 : 0;

    return { indicador: ind, pct, valor, faturamento, status, pontos, detalhe };
  });
}

function getStatus(pct: number | null, ind: KpiIndicador): 'verde' | 'ambar' | 'vermelho' {
  if (pct == null) return 'vermelho';
  if (ind.direcao === 'menor_melhor') {
    if (pct < ind.limite_verde) return 'verde';
    if (pct < ind.limite_ambar) return 'ambar';
    return 'vermelho';
  } else {
    if (pct > ind.limite_verde) return 'verde';
    if (pct > ind.limite_ambar) return 'ambar';
    return 'vermelho';
  }
}

export function calcScore(items: IndicadorCalculado[]): number {
  const ativos = items.filter(i => i.indicador.ativo);
  if (ativos.length === 0) return 0;
  const total = ativos.reduce((sum, i) => sum + i.pontos, 0);
  return Math.round(total / ativos.length);
}

export function getLast6Months(competencia: string): string[] {
  const d = new Date(competencia + 'T00:00:00');
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(m.toISOString().split('T')[0]);
  }
  return months;
}
