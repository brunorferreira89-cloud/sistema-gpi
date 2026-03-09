import { supabase } from '@/integrations/supabase/client';

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
  const { data: contas } = await supabase
    .from('plano_de_contas')
    .select('id, nome, tipo, nivel, is_total, ordem')
    .eq('cliente_id', clienteId)
    .order('ordem');

  if (!contas?.length) {
    return emptyKpi();
  }

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

  const valMap = new Map((valores || []).map((v) => [v.conta_id, v]));

  const findConta = (keywords: string[]) =>
    contas.find((c: any) => keywords.some((kw) => c.nome.toLowerCase().includes(kw)));

  const getVal = (keywords: string[]) => {
    const conta = findConta(keywords);
    if (!conta) return { realizado: 0, meta: 0, id: '' };
    const v = valMap.get(conta.id);
    return { realizado: v?.valor_realizado || 0, meta: v?.valor_meta || 0, id: conta.id };
  };

  const getSparkForConta = (contaId: string) =>
    months.map((m) => {
      const v = (sparkValores || []).find((sv: any) => sv.conta_id === contaId && sv.competencia === m);
      return v?.valor_realizado || 0;
    });

  const fat = getVal(['faturamento bruto', 'receita bruta']);
  const mc = getVal(['margem de contribui']);
  const cmv = getVal(['cmv', 'custo da mercadoria', 'custo variável', 'custo variavel']);
  const cmo = getVal(['cmo', 'custo de mão', 'folha', 'pessoal']);
  const gc = getVal(['geração de caixa', 'geracao de caixa']);
  const df = getVal(['despesas fixas', 'despesa fixa total']);
  const ret = getVal(['retirada', 'sócio', 'socio', 'pró-labore', 'pro-labore']);

  const fatVal = fat.realizado || 1;
  const mc_pct = fatVal ? (mc.realizado / fatVal) * 100 : 0;
  const cmv_pct = fatVal ? (Math.abs(cmv.realizado) / fatVal) * 100 : 0;
  const cmo_pct = fatVal ? (Math.abs(cmo.realizado) / fatVal) * 100 : 0;
  const gc_pct = fatVal ? (gc.realizado / fatVal) * 100 : 0;
  const pe = mc_pct > 0 ? Math.abs(df.realizado) / (mc_pct / 100) : 0;
  const ms = fatVal > 0 && pe > 0 ? ((fat.realizado - pe) / fat.realizado) * 100 : 0;

  const hasData = (valores || []).length > 0;

  return {
    faturamento: fat.realizado,
    faturamento_meta: fat.meta,
    mc_valor: mc.realizado,
    mc_pct,
    mc_meta: mc.meta,
    cmv_valor: Math.abs(cmv.realizado),
    cmv_pct,
    cmv_meta: cmv.meta,
    cmo_valor: Math.abs(cmo.realizado),
    cmo_pct,
    cmo_meta: cmo.meta,
    gc_valor: gc.realizado,
    gc_pct,
    gc_meta: gc.meta,
    despesas_fixas: Math.abs(df.realizado),
    retiradas: Math.abs(ret.realizado),
    retiradas_pct_fat: fatVal ? (Math.abs(ret.realizado) / fatVal) * 100 : 0,
    retiradas_pct_gc: gc.realizado ? (Math.abs(ret.realizado) / Math.abs(gc.realizado)) * 100 : 0,
    pe_valor: pe,
    margem_seguranca: ms,
    hasData,
    sparkHistory: {
      faturamento: getSparkForConta(fat.id),
      mc: getSparkForConta(mc.id),
      cmv: getSparkForConta(cmv.id),
      cmo: getSparkForConta(cmo.id),
      gc: getSparkForConta(gc.id),
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
