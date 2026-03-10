import { supabase } from '@/integrations/supabase/client';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas, calcIndicador, sumLeafByTipo } from '@/lib/dre-indicadores';

export interface KpiData {
  faturamento: number;
  faturamento_meta: number;
  mc_valor: number;
  mc_pct: number;
  mc_meta: number;
  cmv_valor: number;
  cmv_pct: number;
  cmv_meta: number;
  cmo_valor: number;
  cmo_pct: number;
  cmo_meta: number;
  gc_valor: number;
  gc_pct: number;
  gc_meta: number;
  despesas_fixas: number;
  retiradas: number;
  retiradas_pct_fat: number;
  retiradas_pct_gc: number;
  pe_valor: number;
  margem_seguranca: number;
  hasData: boolean;
  sparkHistory: Record<string, number[]>;
}

export async function fetchKpiData(clienteId: string, competencia: string): Promise<KpiData> {
  // Fetch all contas
  const { data: contasRaw } = await supabase
    .from('plano_de_contas')
    .select('id, nome, tipo, nivel, is_total, ordem')
    .eq('cliente_id', clienteId)
    .order('ordem');

  if (!contasRaw?.length) {
    return emptyKpi();
  }

  const contas = contasRaw as unknown as ContaRow[];
  const leafContas = getLeafContas(contas);
  const contaIds = contas.map((c) => c.id);

  // Fetch values for selected competencia
  const { data: valores } = await supabase
    .from('valores_mensais')
    .select('conta_id, valor_realizado, valor_meta')
    .in('conta_id', contaIds)
    .eq('competencia', competencia);

  // Fetch last 4 months for spark lines
  const months = getLast4Months(competencia);
  const { data: sparkValores } = await supabase
    .from('valores_mensais')
    .select('conta_id, competencia, valor_realizado')
    .in('conta_id', contaIds)
    .in('competencia', months);

  // Build realized and meta maps
  const realizadoMap: Record<string, number | null> = {};
  const metaMap: Record<string, number | null> = {};
  (valores || []).forEach((v) => {
    realizadoMap[v.conta_id] = v.valor_realizado;
    metaMap[v.conta_id] = v.valor_meta;
  });

  // Use leaf-based calculations
  const fatReal = sumLeafByTipo(contas, realizadoMap, 'receita');
  const fatMeta = sumLeafByTipo(contas, metaMap, 'receita');
  const mcReal = calcIndicador(contas, realizadoMap, ['receita', 'custo_variavel']);
  const mcMeta = calcIndicador(contas, metaMap, ['receita', 'custo_variavel']);
  const cmvReal = sumLeafByTipo(contas, realizadoMap, 'custo_variavel');
  const cmvMeta = sumLeafByTipo(contas, metaMap, 'custo_variavel');
  const dfReal = sumLeafByTipo(contas, realizadoMap, 'despesa_fixa');

  // CMO: look for personnel-related leaf accounts within despesa_fixa
  const cmoKeywords = ['pessoal', 'salário', 'salario', 'folha', 'cmo', 'mão de obra', 'mao de obra', 'pró-labore', 'pro-labore'];
  const cmoContas = leafContas.filter(
    (c) => c.tipo === 'despesa_fixa' && cmoKeywords.some((kw) => c.nome.toLowerCase().includes(kw))
  );
  let cmoReal = 0, cmoMeta = 0;
  cmoContas.forEach((c) => {
    cmoReal += Math.abs(realizadoMap[c.id] || 0);
    cmoMeta += Math.abs(metaMap[c.id] || 0);
  });

  // GC = Resultado de Caixa (all 5 types)
  const gcReal = calcIndicador(contas, realizadoMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);
  const gcMeta = calcIndicador(contas, metaMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);

  // Retiradas: look for withdrawal keywords in leaf accounts
  const retKeywords = ['retirada', 'sócio', 'socio', 'pró-labore', 'pro-labore', 'distribuição', 'distribuicao'];
  const retContas = leafContas.filter(
    (c) => retKeywords.some((kw) => c.nome.toLowerCase().includes(kw))
  );
  let retReal = 0;
  retContas.forEach((c) => { retReal += Math.abs(realizadoMap[c.id] || 0); });

  const fatVal = fatReal || 1;
  const mc_pct = fatReal ? (mcReal / fatReal) * 100 : 0;
  const cmv_pct = fatReal ? (cmvReal / fatReal) * 100 : 0;
  const cmo_pct = fatReal ? (cmoReal / fatReal) * 100 : 0;
  const gc_pct = fatReal ? (gcReal / fatReal) * 100 : 0;
  const pe = mc_pct > 0 ? dfReal / (mc_pct / 100) : 0;
  const ms = fatReal > 0 && pe > 0 ? ((fatReal - pe) / fatReal) * 100 : 0;

  const hasData = (valores || []).length > 0;

  // Spark lines: build per-month maps using leaf logic
  const getSparkForTypes = (tipos: string[]) =>
    months.map((m) => {
      const monthMap: Record<string, number | null> = {};
      (sparkValores || []).filter((sv: any) => sv.competencia === m).forEach((sv: any) => {
        monthMap[sv.conta_id] = sv.valor_realizado;
      });
      return calcIndicador(contas, monthMap, tipos);
    });

  return {
    faturamento: fatReal,
    faturamento_meta: fatMeta,
    mc_valor: mcReal,
    mc_pct,
    mc_meta: mcMeta,
    cmv_valor: cmvReal,
    cmv_pct,
    cmv_meta: cmvMeta,
    cmo_valor: cmoReal,
    cmo_pct,
    cmo_meta: cmoMeta,
    gc_valor: gcReal,
    gc_pct,
    gc_meta: gcMeta,
    despesas_fixas: dfReal,
    retiradas: retReal,
    retiradas_pct_fat: fatReal ? (retReal / fatReal) * 100 : 0,
    retiradas_pct_gc: gcReal ? (retReal / Math.abs(gcReal)) * 100 : 0,
    pe_valor: pe,
    margem_seguranca: ms,
    hasData,
    sparkHistory: {
      faturamento: getSparkForTypes(['receita']),
      mc: getSparkForTypes(['receita', 'custo_variavel']),
      cmv: months.map((m) => {
        const monthMap: Record<string, number | null> = {};
        (sparkValores || []).filter((sv: any) => sv.competencia === m).forEach((sv: any) => {
          monthMap[sv.conta_id] = sv.valor_realizado;
        });
        return Math.abs(sumLeafByTipo(contas, monthMap, 'custo_variavel'));
      }),
      cmo: months.map(() => cmoReal), // simplified
      gc: getSparkForTypes(['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']),
    },
  };
}

function emptyKpi(): KpiData {
  return {
    faturamento: 0, faturamento_meta: 0,
    mc_valor: 0, mc_pct: 0, mc_meta: 0,
    cmv_valor: 0, cmv_pct: 0, cmv_meta: 0,
    cmo_valor: 0, cmo_pct: 0, cmo_meta: 0,
    gc_valor: 0, gc_pct: 0, gc_meta: 0,
    despesas_fixas: 0, retiradas: 0,
    retiradas_pct_fat: 0, retiradas_pct_gc: 0,
    pe_valor: 0, margem_seguranca: 0,
    hasData: false,
    sparkHistory: { faturamento: [], mc: [], cmv: [], cmo: [], gc: [] },
  };
}

function getLast4Months(competencia: string): string[] {
  const d = new Date(competencia + 'T00:00:00');
  const months: string[] = [];
  for (let i = 3; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    months.push(m.toISOString().split('T')[0]);
  }
  return months;
}
