// ── Mini-Diagnóstico Financeiro GPI — Cálculos ──

export interface DiagnosticoInputs {
  // Step 1
  nome_empresa: string;
  responsavel_nome: string;
  email: string;
  cnpj: string;
  segmento: string;
  faturamento: number | null;
  faturamento_nao_sabe: boolean;
  // Step 2
  cmv: number | null;
  cmv_nao_sabe: boolean;
  impostos: number | null;
  impostos_nao_sabe: boolean;
  taxas_cartao_modo: 'valor' | 'percentual';
  taxas_cartao: number | null;
  taxas_cartao_pct: number | null;
  taxas_cartao_nao_sabe: boolean;
  // Step 3
  despesas_admin: number | null;
  despesas_admin_nao_sabe: boolean;
  num_funcionarios: number;
  salarios: number | null; salarios_nao_sabe: boolean;
  inss_irrf: number | null; inss_irrf_nao_sabe: boolean;
  fgts: number | null; fgts_nao_sabe: boolean;
  ferias: number | null; ferias_nao_sabe: boolean;
  decimo_rescisoes: number | null; decimo_rescisoes_nao_sabe: boolean;
  manutencao: number | null; manutencao_nao_sabe: boolean;
  despesas_diversas: number | null; despesas_diversas_nao_sabe: boolean;
  // Step 4
  marketing: number | null; marketing_nao_sabe: boolean;
  capex: number | null; capex_nao_sabe: boolean;
  retiradas: number | null; retiradas_nao_sabe: boolean;
  parcelas: number | null; parcelas_nao_sabe: boolean;
  // Step 5
  fornecedores: number | null; fornecedores_nao_sabe: boolean;
  impostos_atrasados: number | null; impostos_atrasados_nao_sabe: boolean;
  emprestimos_saldo: number | null; emprestimos_saldo_nao_sabe: boolean;
  outras_dividas: number | null; outras_dividas_nao_sabe: boolean;
}

export interface DreResult {
  faturamento: number | null;
  cmv: number | null;
  impostos: number | null;
  taxas_cartao: number | null;
  total_custos_variaveis: number | null;
  margem_contribuicao: number | null;
  mc_pct: number | null;
  despesas_admin: number | null;
  folha_total: number | null;
  folha_detalhe: {
    salarios: number | null;
    inss_irrf: number | null;
    fgts: number | null;
    ferias: number | null;
    decimo_rescisoes: number | null;
  };
  manutencao: number | null;
  despesas_diversas: number | null;
  total_despesas_operacionais: number | null;
  lucro_operacional: number | null;
  lucro_op_pct: number | null;
  marketing: number | null;
  capex: number | null;
  retiradas: number | null;
  parcelas: number | null;
  geracao_caixa: number | null;
  gc_pct: number | null;
  // KPIs
  cmv_pct: number | null;
  cmo_pct: number | null;
  custo_per_capita: number | null;
  mc_por_funcionario: number | null;
  indice_cobertura: number | null;
  // PE
  pe_valor: number | null;
  margem_seguranca: number | null;
  // Retiradas
  retiradas_pct_fat: number | null;
  retiradas_pct_gc: number | null;
  // Endividamento
  total_dividas: number | null;
  endividamento_pct: number | null;
  // Score
  score: number;
  penalidades: string[];
  campos_null: number;
}

export function calcularDRE(inputs: DiagnosticoInputs): DreResult {
  const fat = inputs.faturamento;
  const cmv = inputs.cmv_nao_sabe ? null : inputs.cmv;
  const impostos = inputs.impostos_nao_sabe ? null : inputs.impostos;

  let taxas: number | null;
  if (inputs.taxas_cartao_nao_sabe) {
    taxas = null;
  } else if (inputs.taxas_cartao_modo === 'percentual' && inputs.taxas_cartao_pct != null && fat != null) {
    taxas = (inputs.taxas_cartao_pct / 100) * fat;
  } else {
    taxas = inputs.taxas_cartao;
  }

  const custos_arr = [cmv, impostos, taxas];
  const total_cv = custos_arr.some(v => v != null) ? custos_arr.reduce((s, v) => s + (v || 0), 0) : null;

  const mc = fat != null && total_cv != null ? fat - total_cv : null;
  const mc_pct = fat && mc != null ? (mc / fat) * 100 : null;

  // Step 3
  const da = inputs.despesas_admin_nao_sabe ? null : inputs.despesas_admin;
  const sal = inputs.salarios_nao_sabe ? null : inputs.salarios;
  const inss = inputs.inss_irrf_nao_sabe ? null : inputs.inss_irrf;
  const fgts = inputs.fgts_nao_sabe ? null : inputs.fgts;
  const ferias = inputs.ferias_nao_sabe ? null : inputs.ferias;
  const decimo = inputs.decimo_rescisoes_nao_sabe ? null : inputs.decimo_rescisoes;
  const folha_parts = [sal, inss, fgts, ferias, decimo];
  const folha_total = folha_parts.some(v => v != null) ? folha_parts.reduce((s, v) => s + (v || 0), 0) : null;
  const mnt = inputs.manutencao_nao_sabe ? null : inputs.manutencao;
  const dd = inputs.despesas_diversas_nao_sabe ? null : inputs.despesas_diversas;

  const desp_arr = [da, folha_total, mnt, dd];
  const total_do = desp_arr.some(v => v != null) ? desp_arr.reduce((s, v) => s + (v || 0), 0) : null;

  const lucro_op = mc != null && total_do != null ? mc - total_do : null;
  const lucro_op_pct = fat && lucro_op != null ? (lucro_op / fat) * 100 : null;

  // Step 4
  const mkt = inputs.marketing_nao_sabe ? null : inputs.marketing;
  const capex = inputs.capex_nao_sabe ? null : inputs.capex;
  const ret = inputs.retiradas_nao_sabe ? null : inputs.retiradas;
  const parc = inputs.parcelas_nao_sabe ? null : inputs.parcelas;

  const inv_arr = [mkt, capex, ret, parc];
  const total_inv = inv_arr.some(v => v != null) ? inv_arr.reduce((s, v) => s + (v || 0), 0) : null;

  const gc = lucro_op != null && total_inv != null ? lucro_op - total_inv : null;
  const gc_pct = fat && gc != null ? (gc / fat) * 100 : null;

  // KPIs
  const cmv_pct = fat && cmv != null ? (cmv / fat) * 100 : null;
  const cmo_pct = fat && folha_total != null ? (folha_total / fat) * 100 : null;

  // PE
  const pe = mc_pct && mc_pct > 0 && total_do != null ? total_do / (mc_pct / 100) : null;
  const ms = fat && pe != null ? ((fat - pe) / fat) * 100 : null;

  // Retiradas
  const ret_pct_fat = fat && ret != null ? (ret / fat) * 100 : null;
  const ret_pct_gc = gc != null && gc > 0 && ret != null ? (ret / gc) * 100 : null;

  // Step 5 — Endividamento
  const forn = inputs.fornecedores_nao_sabe ? null : inputs.fornecedores;
  const imp_at = inputs.impostos_atrasados_nao_sabe ? null : inputs.impostos_atrasados;
  const emp_saldo = inputs.emprestimos_saldo_nao_sabe ? null : inputs.emprestimos_saldo;
  const out_div = inputs.outras_dividas_nao_sabe ? null : inputs.outras_dividas;

  const div_arr = [forn, imp_at, emp_saldo, out_div];
  const total_dividas = div_arr.some(v => v != null) ? div_arr.reduce((s, v) => s + (v || 0), 0) : null;
  const endiv_pct = fat && total_dividas != null ? (total_dividas / (fat * 12)) * 100 : null;

  // Score & penalidades
  const { score, penalidades, campos_null } = calcularScore(inputs, {
    mc_pct, cmv_pct, cmo_pct, gc_pct, ret_pct_fat, ret_pct_gc, endiv_pct, ms,
  });

  return {
    faturamento: fat,
    cmv, impostos, taxas_cartao: taxas,
    total_custos_variaveis: total_cv,
    margem_contribuicao: mc, mc_pct,
    despesas_admin: da,
    folha_total,
    folha_detalhe: { salarios: sal, inss_irrf: inss, fgts, ferias, decimo_rescisoes: decimo },
    manutencao: mnt, despesas_diversas: dd,
    total_despesas_operacionais: total_do,
    lucro_operacional: lucro_op, lucro_op_pct,
    marketing: mkt, capex, retiradas: ret, parcelas: parc,
    geracao_caixa: gc, gc_pct,
    cmv_pct, cmo_pct,
    pe_valor: pe, margem_seguranca: ms,
    retiradas_pct_fat: ret_pct_fat, retiradas_pct_gc: ret_pct_gc,
    total_dividas, endividamento_pct: endiv_pct,
    score, penalidades, campos_null,
  };
}

function calcularScore(
  inputs: DiagnosticoInputs,
  kpis: {
    mc_pct: number | null; cmv_pct: number | null; cmo_pct: number | null;
    gc_pct: number | null; ret_pct_fat: number | null; ret_pct_gc: number | null;
    endiv_pct: number | null; ms: number | null;
  }
) {
  let score = 100;
  const penalidades: string[] = [];

  // Count null fields (checkboxes "Não sabe")
  const naoSabeFields = [
    inputs.faturamento_nao_sabe, inputs.cmv_nao_sabe, inputs.impostos_nao_sabe,
    inputs.taxas_cartao_nao_sabe, inputs.despesas_admin_nao_sabe,
    inputs.salarios_nao_sabe, inputs.inss_irrf_nao_sabe, inputs.fgts_nao_sabe,
    inputs.ferias_nao_sabe, inputs.decimo_rescisoes_nao_sabe,
    inputs.manutencao_nao_sabe, inputs.despesas_diversas_nao_sabe,
    inputs.marketing_nao_sabe, inputs.capex_nao_sabe,
    inputs.retiradas_nao_sabe, inputs.parcelas_nao_sabe,
    inputs.fornecedores_nao_sabe, inputs.impostos_atrasados_nao_sabe,
    inputs.emprestimos_saldo_nao_sabe, inputs.outras_dividas_nao_sabe,
  ];
  const campos_null = naoSabeFields.filter(Boolean).length;

  if (campos_null >= 8) {
    score -= 20;
    penalidades.push('Muitos campos sem informação (visibilidade crítica)');
  } else if (campos_null >= 4) {
    score -= 10;
    penalidades.push('Diversos campos sem informação');
  }

  // MC
  if (kpis.mc_pct != null) {
    if (kpis.mc_pct < 30) { score -= 25; penalidades.push('MC% abaixo de 30% — margem crítica'); }
    else if (kpis.mc_pct < 40) { score -= 15; penalidades.push('MC% entre 30–40% — margem abaixo do ideal'); }
  }

  // CMV
  if (kpis.cmv_pct != null) {
    if (kpis.cmv_pct > 42) { score -= 15; penalidades.push('CMV acima de 42% — custo de mercadoria elevado'); }
    else if (kpis.cmv_pct > 38) { score -= 5; penalidades.push('CMV entre 38–42% — atenção ao custo'); }
  }

  // CMO
  if (kpis.cmo_pct != null) {
    if (kpis.cmo_pct > 30) { score -= 15; penalidades.push('CMO acima de 30% — custo de pessoal elevado'); }
    else if (kpis.cmo_pct > 25) { score -= 5; penalidades.push('CMO entre 25–30% — atenção ao custo de pessoal'); }
  }

  // GC
  if (kpis.gc_pct != null) {
    if (kpis.gc_pct < 0) { score -= 20; penalidades.push('Geração de Caixa negativa — empresa consumindo caixa'); }
    else if (kpis.gc_pct < 7) { score -= 10; penalidades.push('GC% abaixo de 7% — geração de caixa insuficiente'); }
  }

  // Retiradas
  if (kpis.ret_pct_gc != null && kpis.ret_pct_gc > 50) {
    score -= 10; penalidades.push('Retiradas acima de 50% da Geração de Caixa');
  }
  if (kpis.ret_pct_fat != null && kpis.ret_pct_fat > 5) {
    score -= 5; penalidades.push('Retiradas acima de 5% do faturamento');
  }

  // Endividamento
  if (kpis.endiv_pct != null) {
    if (kpis.endiv_pct > 50) { score -= 15; penalidades.push('Endividamento acima de 50% — risco elevado'); }
    else if (kpis.endiv_pct > 30) { score -= 5; penalidades.push('Endividamento entre 30–50% — atenção'); }
  }

  return { score: Math.max(0, Math.min(100, score)), penalidades, campos_null };
}

export function getScoreLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: 'Saúde Financeira Adequada', color: '#00A86B' };
  if (score >= 40) return { label: 'Atenção — Pontos Críticos', color: '#D97706' };
  return { label: 'Risco Elevado — Ação Urgente', color: '#DC2626' };
}

export function getPitchTitle(inputs: DiagnosticoInputs, dre: DreResult): string {
  if (dre.gc_pct != null && dre.gc_pct < 10)
    return 'Seu negócio fatura — mas não está gerando caixa suficiente. A GPI resolve isso.';
  if (dre.retiradas_pct_gc != null && dre.retiradas_pct_gc > 50)
    return 'Você tem um negócio que fatura bem — mas está gerando caixa suficiente apenas para pagar o próprio sócio. A GPI resolve isso.';
  if (dre.cmv_pct != null && dre.cmv_pct > 38)
    return 'Seu negócio vende bem — mas está perdendo margem em cada compra sem perceber.';
  if (dre.campos_null >= 8)
    return 'Você não sabe o que não sabe. E isso está custando mais caro do que qualquer despesa que você conhece.';
  return 'Seus números mostram um negócio com potencial. A GPI garante que você continue crescendo com margem.';
}

export function fmtBRL(v: number | null | undefined): string {
  if (v == null) return 'N/I';
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null) return 'N/I';
  return `${v.toFixed(1)}%`;
}

export function emptyInputs(): DiagnosticoInputs {
  return {
    nome_empresa: '', responsavel_nome: '', email: '', cnpj: '', segmento: '', faturamento: null, faturamento_nao_sabe: false,
    cmv: null, cmv_nao_sabe: false, impostos: null, impostos_nao_sabe: false,
    taxas_cartao_modo: 'valor', taxas_cartao: null, taxas_cartao_pct: null, taxas_cartao_nao_sabe: false,
    despesas_admin: null, despesas_admin_nao_sabe: false, num_funcionarios: 0,
    salarios: null, salarios_nao_sabe: false, inss_irrf: null, inss_irrf_nao_sabe: false,
    fgts: null, fgts_nao_sabe: false, ferias: null, ferias_nao_sabe: false,
    decimo_rescisoes: null, decimo_rescisoes_nao_sabe: false,
    manutencao: null, manutencao_nao_sabe: false, despesas_diversas: null, despesas_diversas_nao_sabe: false,
    marketing: null, marketing_nao_sabe: false, capex: null, capex_nao_sabe: false,
    retiradas: null, retiradas_nao_sabe: false, parcelas: null, parcelas_nao_sabe: false,
    fornecedores: null, fornecedores_nao_sabe: false, impostos_atrasados: null, impostos_atrasados_nao_sabe: false,
    emprestimos_saldo: null, emprestimos_saldo_nao_sabe: false, outras_dividas: null, outras_dividas_nao_sabe: false,
  };
}
