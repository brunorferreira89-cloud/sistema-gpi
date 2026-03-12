import type { ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas } from '@/lib/dre-indicadores';
import { formatCurrency } from '@/lib/plano-contas-utils';

/* ── helpers reused from DreIndicadoresHeader ── */

function calcIndicatorValue(leafs: ContaRow[], valMap: Record<string, number | null>, tipos: string[]): number {
  let total = 0;
  for (const c of leafs) {
    if (!tipos.includes(c.tipo)) continue;
    const v = valMap[c.id];
    if (v != null) total += v;
  }
  return total;
}

function sumByTipo(leafs: ContaRow[], valMap: Record<string, number | null>, tipo: string): number {
  let total = 0;
  for (const c of leafs) {
    if (c.tipo !== tipo) continue;
    const v = valMap[c.id];
    if (v != null) total += v;
  }
  return total;
}

function getSubgroups(
  contas: ContaRow[], tipo: string,
  valMap: Record<string, number | null>,
  fat: number,
  prevMap?: Record<string, number | null>,
): any[] {
  const subs = contas.filter(c => c.tipo === tipo && c.nivel === 1);
  const result = subs.map(s => {
    const parent = contas.find(c => c.id === s.conta_pai_id && c.nivel === 0);
    const children = contas.filter(c => c.conta_pai_id === s.id && c.nivel === 2);
    let val = 0;
    let valPrev = 0;
    for (const ch of children) {
      const v = valMap[ch.id]; if (v != null) val += v;
      if (prevMap) { const vp = prevMap[ch.id]; if (vp != null) valPrev += vp; }
    }
    const filhas = children
      .map(ch => { const v = valMap[ch.id]; const valor = v != null ? v : 0; return { nome: ch.nome, valor, pct_faturamento: fat ? (Math.abs(valor) / fat) * 100 : 0 }; })
      .filter(f => f.valor !== 0)
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
      .slice(0, 5);

    const entry: any = { nome: s.nome, grupo: parent?.nome || tipo, nivel: 'subgrupo', valor: val, pct_faturamento: fat ? (val / fat) * 100 : 0, filhas };
    if (prevMap) {
      entry.valor_anterior = valPrev;
      entry.variacao_abs = val - valPrev;
      entry.variacao_pct = valPrev ? ((val - valPrev) / valPrev) * 100 : 0;
    }
    return entry;
  }).filter(s => s.valor !== 0);
  return result.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
}

function fmtC(v: number): string {
  return formatCurrency(Math.abs(v)).replace('R$\u00a0', 'R$ ').replace('R$  ', 'R$ ');
}

function fmtP(v: number): string {
  return v.toFixed(1).replace('.', ',') + '%';
}

function statusFromValue(value: number, thresholds: [number, number], direction: 'higher_better' | 'lower_better'): 'verde' | 'ambar' | 'vermelho' {
  const [low, high] = thresholds;
  if (direction === 'higher_better') {
    if (value > high) return 'verde';
    if (value >= low) return 'ambar';
    return 'vermelho';
  }
  if (value < low) return 'verde';
  if (value <= high) return 'ambar';
  return 'vermelho';
}

/* ── types ── */
export interface IndicadorPayload {
  indicador: string;
  valor_atual: number;
  valor_absoluto: number;
  faturamento: number;
  mes_referencia: string;
  status: string;
  limite_verde: number;
  limite_ambar: number;
  direcao: string;
  historico: { mes: string; valor: number }[];
  formula: string;
  composicao: any[];
}

/* ── main builder ── */
export function buildIndicadorPayload(
  nomeIndicador: string,
  contas: ContaRow[],
  valoresAnuais: { conta_id: string; competencia: string; valor_realizado: number | null }[],
  competencia: string,
  mesReferencia: string,
): IndicadorPayload | null {
  const leafs = getLeafContas(contas);

  // Build per-month map
  const valoresMap: Record<string, Record<string, number | null>> = {};
  valoresAnuais.forEach(v => {
    if (!valoresMap[v.conta_id]) valoresMap[v.conta_id] = {};
    valoresMap[v.conta_id][v.competencia] = v.valor_realizado;
  });

  const getMonthMap = (comp: string): Record<string, number | null> => {
    const m: Record<string, number | null> = {};
    contas.forEach(c => { m[c.id] = valoresMap[c.id]?.[comp] ?? null; });
    return m;
  };

  // Find months with data
  const allMonths = [...new Set(valoresAnuais.filter(v => v.valor_realizado != null).map(v => v.competencia))].sort();
  const currentIdx = allMonths.indexOf(competencia);
  if (currentIdx < 0) return null;

  const currentMap = getMonthMap(competencia);
  const prevComp = currentIdx > 0 ? allMonths[currentIdx - 1] : null;
  const prevMap = prevComp ? getMonthMap(prevComp) : undefined;

  // Last 6 months up to current
  const last6 = allMonths.slice(0, currentIdx + 1).slice(-6);
  const last6Labels = last6.map(m => {
    const d = new Date(m + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  });

  // Core values
  const fat = calcIndicatorValue(leafs, currentMap, ['receita']);
  const custosVar = sumByTipo(leafs, currentMap, 'custo_variavel');
  const mc = calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel']);
  const despesasFixas = sumByTipo(leafs, currentMap, 'despesa_fixa');
  const ro = calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel', 'despesa_fixa']);
  const investimentos = sumByTipo(leafs, currentMap, 'investimento');
  const financeiro = sumByTipo(leafs, currentMap, 'financeiro');
  const rai = calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento']);
  const gc = calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);
  const mcDecimal = fat ? mc / fat : 0;
  const peMinimo = mcDecimal ? despesasFixas / mcDecimal : 0;

  const custosVarPct = fat ? (custosVar / fat) * 100 : 0;
  const mcPct = fat ? (mc / fat) * 100 : 0;
  const despFixasPct = fat ? (despesasFixas / fat) * 100 : 0;
  const roPct = fat ? (ro / fat) * 100 : 0;
  const investPct = fat ? (investimentos / fat) * 100 : 0;
  const financeiroPct = fat ? (financeiro / fat) * 100 : 0;
  const raiPct = fat ? (rai / fat) * 100 : 0;
  const gcPct = fat ? (gc / fat) * 100 : 0;

  // History builder
  const histValue = (tipos: string[], asPct: boolean) =>
    last6.map((m, i) => {
      const mm = getMonthMap(m);
      const f = calcIndicatorValue(leafs, mm, ['receita']);
      const v = asPct
        ? (f ? (calcIndicatorValue(leafs, mm, tipos) / f) * 100 : 0)
        : calcIndicatorValue(leafs, mm, tipos);
      return { mes: last6Labels[i], valor: v };
    });

  const histSum = (tipo: string) =>
    last6.map((m, i) => ({ mes: last6Labels[i], valor: sumByTipo(leafs, getMonthMap(m), tipo) }));

  const CONFIGS: Record<string, () => IndicadorPayload> = {
    'Faturamento': () => {
      const subs = getSubgroups(contas, 'receita', currentMap, fat, prevMap);
      return { indicador: 'Faturamento', valor_atual: 100, valor_absoluto: fat, faturamento: fat, mes_referencia: mesReferencia, status: 'verde', limite_verde: 0, limite_ambar: 0, direcao: 'maior_melhor', historico: histValue(['receita'], false), formula: `Faturamento = Soma Receitas = ${fmtC(fat)}`, composicao: subs };
    },
    'Custos Operacionais': () => {
      const subs = getSubgroups(contas, 'custo_variavel', currentMap, fat, prevMap);
      return { indicador: 'Custos Operacionais', valor_atual: custosVarPct, valor_absoluto: custosVar, faturamento: fat, mes_referencia: mesReferencia, status: statusFromValue(custosVarPct, [38, 50], 'lower_better'), limite_verde: 38, limite_ambar: 50, direcao: 'menor_melhor', historico: histSum('custo_variavel'), formula: `Custos Variáveis = ${fmtC(custosVar)} (${fmtP(custosVarPct)} do fat.)`, composicao: subs };
    },
    'Margem de Contribuição': () => {
      const recSubs = getSubgroups(contas, 'receita', currentMap, fat);
      const custoSubs = getSubgroups(contas, 'custo_variavel', currentMap, fat, prevMap);
      return { indicador: 'Margem de Contribuição', valor_atual: mcPct, valor_absoluto: mc, faturamento: fat, mes_referencia: mesReferencia, status: statusFromValue(mcPct, [30, 40], 'higher_better'), limite_verde: 40, limite_ambar: 30, direcao: 'maior_melhor', historico: histValue(['receita', 'custo_variavel'], true), formula: `MC = Fat ${fmtC(fat)} - Custos ${fmtC(custosVar)} = ${fmtC(mc)} (${fmtP(mcPct)})`, composicao: [...recSubs.map(s => ({ ...s, grupo: 'Receitas' })), ...custoSubs.map(s => ({ ...s, grupo: 'Custos Variáveis' }))] };
    },
    'Despesas Fixas': () => {
      const subs = getSubgroups(contas, 'despesa_fixa', currentMap, fat, prevMap);
      return { indicador: 'Despesas Fixas', valor_atual: despFixasPct, valor_absoluto: despesasFixas, faturamento: fat, mes_referencia: mesReferencia, status: statusFromValue(despFixasPct, [25, 35], 'lower_better'), limite_verde: 25, limite_ambar: 35, direcao: 'menor_melhor', historico: histSum('despesa_fixa'), formula: `Despesas Fixas = ${fmtC(despesasFixas)} (${fmtP(despFixasPct)} do fat.)`, composicao: subs };
    },
    'Resultado Operacional': () => {
      const despSubs = getSubgroups(contas, 'despesa_fixa', currentMap, fat, prevMap);
      return { indicador: 'Resultado Operacional', valor_atual: roPct, valor_absoluto: ro, faturamento: fat, mes_referencia: mesReferencia, status: statusFromValue(roPct, [5, 10], 'higher_better'), limite_verde: 10, limite_ambar: 5, direcao: 'maior_melhor', historico: histValue(['receita', 'custo_variavel', 'despesa_fixa'], true), formula: `RO = MC ${fmtC(mc)} - Desp.Fixas ${fmtC(despesasFixas)} = ${fmtC(ro)} (${fmtP(roPct)})`, composicao: [{ nome: 'Margem de Contribuição', grupo: 'MC', nivel: 'totalizador', valor: mc, pct_faturamento: mcPct }, ...despSubs.map(s => ({ ...s, grupo: 'Despesas Fixas' }))] };
    },
    'Ativ. Investimento': () => {
      const subs = getSubgroups(contas, 'investimento', currentMap, fat, prevMap);
      return { indicador: 'Ativ. Investimento', valor_atual: investPct, valor_absoluto: investimentos, faturamento: fat, mes_referencia: mesReferencia, status: 'verde', limite_verde: 0, limite_ambar: 0, direcao: 'maior_melhor', historico: histSum('investimento'), formula: `Investimentos = ${fmtC(investimentos)} (${fmtP(investPct)} do fat.)`, composicao: subs };
    },
    'Ativ. Financiamento': () => {
      const subs = getSubgroups(contas, 'financeiro', currentMap, fat, prevMap);
      return { indicador: 'Ativ. Financiamento', valor_atual: financeiroPct, valor_absoluto: financeiro, faturamento: fat, mes_referencia: mesReferencia, status: financeiro > 0 ? 'verde' : financeiro < 0 ? 'vermelho' : 'verde', limite_verde: 0, limite_ambar: 0, direcao: 'maior_melhor', historico: histSum('financeiro'), formula: `Financiamento = ${fmtC(financeiro)} (${fmtP(financeiroPct)} do fat.)`, composicao: subs };
    },
    'Resultado após Invest.': () => {
      return { indicador: 'Resultado após Invest.', valor_atual: raiPct, valor_absoluto: rai, faturamento: fat, mes_referencia: mesReferencia, status: statusFromValue(raiPct, [0, 5], 'higher_better'), limite_verde: 5, limite_ambar: 0, direcao: 'maior_melhor', historico: histValue(['receita', 'custo_variavel', 'despesa_fixa', 'investimento'], true), formula: `RAI = RO ${fmtC(ro)} - Invest. ${fmtC(investimentos)} = ${fmtC(rai)} (${fmtP(raiPct)})`, composicao: [{ nome: 'Resultado Operacional', grupo: 'RO', nivel: 'totalizador', valor: ro, pct_faturamento: roPct }, { nome: '(-) Investimentos', grupo: 'Investimento', nivel: 'totalizador', valor: investimentos, pct_faturamento: investPct }] };
    },
    'Geração de Caixa': () => {
      const recSubs = getSubgroups(contas, 'receita', currentMap, fat);
      const custoSubs = getSubgroups(contas, 'custo_variavel', currentMap, fat);
      const despSubs = getSubgroups(contas, 'despesa_fixa', currentMap, fat);
      const invSubs = getSubgroups(contas, 'investimento', currentMap, fat);
      const finSubs = getSubgroups(contas, 'financeiro', currentMap, fat);
      return { indicador: 'Geração de Caixa', valor_atual: gcPct, valor_absoluto: gc, faturamento: fat, mes_referencia: mesReferencia, status: statusFromValue(gcPct, [3, 10], 'higher_better'), limite_verde: 10, limite_ambar: 3, direcao: 'maior_melhor', historico: histValue(['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'], true), formula: `GC = Fat ${fmtC(fat)} - Custos ${fmtC(custosVar)} - Desp ${fmtC(despesasFixas)} - Invest ${fmtC(investimentos)} ± Fin ${fmtC(financeiro)} = ${fmtC(gc)} (${fmtP(gcPct)})`, composicao: [...recSubs.map(s => ({ ...s, grupo: 'Receitas' })), ...custoSubs.map(s => ({ ...s, grupo: 'Custos Variáveis' })), ...despSubs.map(s => ({ ...s, grupo: 'Despesas Fixas' })), ...invSubs.map(s => ({ ...s, grupo: 'Investimentos' })), ...finSubs.map(s => ({ ...s, grupo: 'Financeiro' }))] };
    },
    'Ponto de Equilíbrio': () => {
      const gapMinimo = fat - peMinimo;
      const despSubs = getSubgroups(contas, 'despesa_fixa', currentMap, fat);
      const histPE = last6.map((m, i) => {
        const mm = getMonthMap(m);
        const f = calcIndicatorValue(leafs, mm, ['receita']);
        const mcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel']);
        const df = sumByTipo(leafs, mm, 'despesa_fixa');
        const mcD = f ? mcV / f : 0;
        return { mes: last6Labels[i], valor: mcD ? df / mcD : 0 };
      });
      return { indicador: 'Ponto de Equilíbrio', valor_atual: peMinimo ? (fat / peMinimo) * 100 : 0, valor_absoluto: peMinimo, faturamento: fat, mes_referencia: mesReferencia, status: gapMinimo >= 0 ? 'verde' : 'vermelho', limite_verde: 100, limite_ambar: 90, direcao: 'maior_melhor', historico: histPE, formula: `PE = Desp.Fixas ${fmtC(despesasFixas)} ÷ MC% ${fmtP(mcPct)} = ${fmtC(peMinimo)}\nGap: Fat ${fmtC(fat)} - PE ${fmtC(peMinimo)} = ${fmtC(gapMinimo)}`, composicao: [{ nome: 'Faturamento', grupo: 'Referência', nivel: 'totalizador', valor: fat, pct_faturamento: 100 }, { nome: 'MC%', grupo: 'Referência', nivel: 'totalizador', valor: mcPct, pct_faturamento: 0 }, ...despSubs.map(s => ({ ...s, grupo: 'Despesas Fixas' }))] };
    },
  };

  const builder = CONFIGS[nomeIndicador];
  return builder ? builder() : null;
}
