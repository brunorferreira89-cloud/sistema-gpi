import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
import { type KpiIndicador, type IndicadorCalculado, getFormula } from '@/lib/kpi-indicadores-utils';

interface AnaliseResult {
  titulo: string | null;
  contexto: string | null;
  analise: string | null;
  alerta: string | null;
  acao: string | null;
  gerado_em?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  kpiCalc: IndicadorCalculado;
  competencia: string;
  clienteId: string;
}

const STATUS_LABEL: Record<string, { text: string; bg: string; color: string }> = {
  verde: { text: 'OK', bg: 'rgba(0,168,107,0.12)', color: '#00A86B' },
  ambar: { text: 'Atenção', bg: 'rgba(217,119,6,0.12)', color: '#D97706' },
  vermelho: { text: 'Crítico', bg: 'rgba(220,38,38,0.12)', color: '#DC2626' },
};

const KPI_DEFINITIONS: Record<string, { definicao: string }> = {
  CMV: { definicao: 'Representa o custo direto dos insumos e mercadorias consumidos na operação. Quanto menor, maior a eficiência operacional.' },
  CMO: { definicao: 'Representa o peso da folha de pagamento e encargos sobre o faturamento. Controlar esse indicador é fundamental para a sustentabilidade do negócio.' },
  MC: { definicao: 'Quanto sobra das receitas após pagar todos os custos variáveis. É o valor disponível para cobrir despesas fixas e gerar lucro.' },
  RO: { definicao: 'Resultado após pagar custos variáveis e despesas fixas. Indica se a operação é lucrativa antes de investimentos e financiamentos.' },
  GC: { definicao: 'A sobra real de caixa após todas as saídas — o indicador mais importante da saúde financeira do negócio.' },
};

const fmtCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

const fmtMonth = (comp: string) => {
  const d = new Date(comp + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
};

interface DrillItem {
  id: string;
  nome: string;
  valor: number;
}

export function KpiDetalheModal({ open, onClose, kpiCalc, competencia, clienteId }: Props) {
  const [analise, setAnalise] = useState<AnaliseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasCheckedCache, setHasCheckedCache] = useState(false);

  // Drill-down state
  const [drillStack, setDrillStack] = useState<DrillItem[]>([]);
  const [slideDir, setSlideDir] = useState<'in' | 'out'>('in');
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null);

  const ind = kpiCalc.indicador;
  const statusCfg = STATUS_LABEL[kpiCalc.status] || STATUS_LABEL.vermelho;
  const formula = getFormula(ind);
  const def = KPI_DEFINITIONS[ind.nome] || { definicao: ind.descricao || `Indicador ${ind.nome} calculado sobre o faturamento.` };

  // Drill-down queries
  const { data: todasContas = [] } = useQuery({
    queryKey: ['plano-contas-drill', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plano_de_contas')
        .select('id, nome, nivel, conta_pai_id, ordem, tipo')
        .eq('cliente_id', clienteId!)
        .order('ordem', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: open && !!clienteId,
  });

  const { data: valoresDrill = [] } = useQuery({
    queryKey: ['valores-drill', clienteId, competencia],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('valores_mensais')
        .select('conta_id, valor_realizado')
        .eq('competencia', competencia)
        .in('conta_id', todasContas.map(c => c.id));
      if (error) throw error;
      return data;
    },
    enabled: open && todasContas.length > 0,
  });

  const getValor = (contaId: string) =>
    valoresDrill.find(v => v.conta_id === contaId)?.valor_realizado ?? 0;

  const getFilhas = (paiId: string) =>
    todasContas
      .filter(c => c.conta_pai_id === paiId)
      .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));

  const hasFilhas = (contaId: string) =>
    todasContas.some(c => c.conta_pai_id === contaId);

  // Get root-level subgrupos for the COMPOSIÇÃO section
  const getComposicaoRaiz = (): { id: string; nome: string; valor: number; temFilhas: boolean }[] => {
    // For subgrupo KPIs, use conta_ids to find the relevant N1 entries
    const contaIds: string[] = (ind as any).conta_ids && Array.isArray((ind as any).conta_ids) && (ind as any).conta_ids.length > 0
      ? (ind as any).conta_ids
      : ind.conta_id ? [ind.conta_id] : [];

    if (ind.tipo_fonte === 'subgrupo' && contaIds.length > 0) {
      // Collect N1 subgrupos that are selected or parents of selected
      const n1Set = new Set<string>();
      for (const cid of contaIds) {
        const conta = todasContas.find(c => c.id === cid);
        if (!conta) continue;
        if (conta.nivel === 1) {
          n1Set.add(cid);
        } else if (conta.nivel === 2 && conta.conta_pai_id) {
          n1Set.add(conta.conta_pai_id);
        }
      }
      return Array.from(n1Set).map(id => {
        const conta = todasContas.find(c => c.id === id)!;
        const children = getFilhas(id);
        const val = children.reduce((s, c) => s + getValor(c.id), 0);
        return { id, nome: conta.nome.replace(/^\([+-]\)\s*/, ''), valor: val, temFilhas: children.length > 0 };
      }).sort((a, b) => {
        const ca = todasContas.find(c => c.id === a.id);
        const cb = todasContas.find(c => c.id === b.id);
        return ((ca?.ordem ?? 0) - (cb?.ordem ?? 0));
      });
    }

    // For totalizador KPIs, show N1 subgrupos grouped by tipo
    const TOTALIZADOR_TIPOS: Record<string, string[]> = {
      MC: ['receita', 'custo_variavel'],
      RO: ['receita', 'custo_variavel', 'despesa_fixa'],
      RAI: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'],
      GC: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'],
    };
    const tipos = ind.totalizador_key ? TOTALIZADOR_TIPOS[ind.totalizador_key] : null;
    if (!tipos) return [];

    return todasContas
      .filter(c => c.nivel === 1 && tipos.includes(c.tipo))
      .map(c => {
        const children = getFilhas(c.id);
        const val = children.reduce((s, ch) => s + getValor(ch.id), 0);
        return { id: c.id, nome: c.nome.replace(/^\([+-]\)\s*/, ''), valor: val, temFilhas: children.length > 0 };
      })
      .sort((a, b) => {
        const ca = todasContas.find(c => c.id === a.id);
        const cb = todasContas.find(c => c.id === b.id);
        return ((ca?.ordem ?? 0) - (cb?.ordem ?? 0));
      });
  };

  const avancar = (conta: DrillItem) => {
    setSlideDir('in');
    setDrillStack(prev => [...prev, conta]);
    setExpandedCatId(null);
  };

  const voltar = () => {
    setSlideDir('out');
    setDrillStack(prev => prev.slice(0, -1));
    setExpandedCatId(null);
  };

  const voltarRaiz = () => {
    setSlideDir('out');
    setDrillStack([]);
    setExpandedCatId(null);
  };

  // Reset when modal opens with new data
  useEffect(() => {
    if (open) {
      setAnalise(null);
      setHasCheckedCache(false);
      setDrillStack([]);
      setExpandedCatId(null);
    }
  }, [open, ind.id, competencia]);

  // Check cache
  useEffect(() => {
    if (!open || !clienteId || hasCheckedCache) return;
    setHasCheckedCache(true);
    (async () => {
      const { data } = await supabase
        .from('analises_ia')
        .select('*')
        .eq('cliente_id', clienteId)
        .eq('indicador', ind.nome)
        .eq('competencia', competencia)
        .maybeSingle();
      if (data) {
        setAnalise({
          titulo: data.titulo,
          contexto: null,
          analise: data.analise,
          alerta: null,
          acao: data.acao,
          gerado_em: data.gerado_em,
        });
      }
    })();
  }, [open, clienteId, ind.nome, competencia, hasCheckedCache]);

  const gerarAnalise = useCallback(async () => {
    if (!clienteId) return;
    setLoading(true);
    try {
      const componentesText = kpiCalc.detalhe.map(d => `${d.nome}: R$ ${Math.abs(d.valor).toLocaleString('pt-BR')} (${d.pct.toFixed(1)}% fat)`).join(', ');
      const instrucao = `Analise o KPI ${ind.nome} deste cliente. Valor atual: ${(kpiCalc.pct ?? 0).toFixed(1)}% · Benchmark GPI: ${ind.limite_verde}%. Status: ${kpiCalc.status === 'verde' ? 'ok' : kpiCalc.status === 'ambar' ? 'atenção' : 'crítico'}. Componentes: ${componentesText}. Forneça: diagnóstico do desvio (se houver), causa provável, e 2 ações concretas de melhoria.`;

      const historico = kpiCalc.detalhe.map(d => ({ mes: competencia, valor: d.pct }));

      const { data, error } = await supabase.functions.invoke('analisar-indicador', {
        body: {
          indicador: ind.nome,
          valor_atual: kpiCalc.pct ?? 0,
          valor_absoluto: Math.abs(kpiCalc.valor ?? 0),
          faturamento: kpiCalc.faturamento,
          mes_referencia: fmtMonth(competencia),
          status: kpiCalc.status,
          limite_verde: ind.limite_verde,
          limite_ambar: ind.limite_ambar,
          direcao: ind.direcao,
          historico,
          formula,
          composicao: kpiCalc.detalhe.map(d => ({ nome: d.nome, valor: d.valor, pct_faturamento: d.pct })),
          instrucao_especifica: instrucao,
        },
      });

      if (error) throw error;

      const result: AnaliseResult = {
        titulo: data?.titulo || null,
        contexto: data?.contexto || null,
        analise: data?.analise || null,
        alerta: data?.alerta || null,
        acao: data?.acao || null,
        gerado_em: new Date().toISOString(),
      };

      await supabase.from('analises_ia').insert({
        cliente_id: clienteId,
        indicador: ind.nome,
        competencia,
        titulo: result.titulo,
        analise: result.analise,
        acao: result.acao,
      }).then(() => {});

      setAnalise(result);
    } catch (err) {
      console.error('Erro ao gerar análise KPI:', err);
    } finally {
      setLoading(false);
    }
  }, [clienteId, ind, kpiCalc, competencia, formula]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const composicaoRaiz = getComposicaoRaiz();
  const totalRaiz = composicaoRaiz.reduce((s, c) => s + c.valor, 0);

  // Drill level 2 data
  const contaAtual = drillStack.length > 0 ? drillStack[drillStack.length - 1] : null;
  const filhasNivel2 = contaAtual ? getFilhas(contaAtual.id).map(f => ({ ...f, valor: getValor(f.id) })) : [];
  const totalNivel2 = filhasNivel2.reduce((s, f) => s + f.valor, 0);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(13,27,53,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalEnter { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: none; } }
        @keyframes slideInRight { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes slideInLeft { from { transform: translateX(-100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 600, maxHeight: '88vh',
          borderRadius: 16, overflow: 'hidden',
          background: '#FAFCFF',
          boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          animation: 'modalEnter 0.22s ease',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div style={{ background: '#0D1B35', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF' }}>{ind.nome}</span>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 8, background: statusCfg.bg, color: statusCfg.color }}>
                {(kpiCalc.pct ?? 0).toFixed(1)}% · {statusCfg.text}
              </span>
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 4, display: 'block' }}>{fmtMonth(competencia)}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 20, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: 24, flex: 1 }}>
          {/* Section 1 — Definition */}
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.15em', display: 'block', marginBottom: 8 }}>📐 DEFINIÇÃO</span>
            <p style={{ fontSize: 13, color: '#4A5E80', margin: '0 0 10px', lineHeight: 1.6 }}>{def.definicao}</p>
            <div style={{ background: '#E8EEF8', border: '1px solid #DDE4F0', borderRadius: 8, padding: '10px 14px', fontFamily: "'JetBrains Mono', monospace", fontSize: 12, color: '#0D1B35' }}>
              {formula}
            </div>
          </div>

          {/* Section 2 — Calculation */}
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.15em', display: 'block', marginBottom: 8 }}>🔢 CÁLCULO — {fmtMonth(competencia).toUpperCase()}</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginBottom: 12 }}>
              {kpiCalc.detalhe.map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F0F4FA' }}>
                  <span style={{ fontSize: 12, color: '#4A5E80' }}>{d.nome}</span>
                  <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#0D1B35', fontWeight: 500 }}>{fmtCurrency(Math.abs(d.valor))}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F0F4FA' }}>
                <span style={{ fontSize: 12, color: '#4A5E80' }}>Faturamento</span>
                <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#0D1B35', fontWeight: 500 }}>{fmtCurrency(Math.abs(kpiCalc.faturamento))}</span>
              </div>
            </div>
            {/* Result highlight */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: statusCfg.bg, borderRadius: 10, padding: '12px 16px' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0D1B35' }}>= {ind.nome}</span>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 22, fontWeight: 800, color: statusCfg.color, fontFamily: "'JetBrains Mono', monospace" }}>{(kpiCalc.pct ?? 0).toFixed(1)}%</span>
                <span style={{ fontSize: 12, color: '#4A5E80', marginLeft: 8 }}>({fmtCurrency(Math.abs(kpiCalc.valor ?? 0))})</span>
              </div>
            </div>
            {/* Benchmark line */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, fontSize: 12, color: '#4A5E80' }}>
              <svg width="8" height="8"><circle cx="4" cy="4" r="4" fill={statusCfg.color} /></svg>
              Benchmark GPI: {ind.direcao === 'menor_melhor' ? '<' : '>'}{ind.limite_verde}%
            </div>
          </div>

          {/* Section 2.5 — Composição with drill-down */}
          {composicaoRaiz.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              {/* Header / Breadcrumb */}
              {drillStack.length === 0 ? (
                <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.15em', display: 'block', marginBottom: 8 }}>📋 COMPOSIÇÃO</span>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                  <button
                    onClick={voltar}
                    style={{
                      width: 18, height: 18, borderRadius: 4,
                      background: '#F0F4FA', border: '1px solid #DDE4F0',
                      color: '#4A5E80', fontSize: 11, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: 0, lineHeight: 1,
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#1A3CFF')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#4A5E80')}
                  >
                    ←
                  </button>
                  <span
                    onClick={voltarRaiz}
                    style={{ fontSize: 10, color: '#8A9BBC', cursor: 'pointer', transition: 'color 0.15s' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#1A3CFF')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#8A9BBC')}
                  >
                    {ind.nome}
                  </span>
                  <span style={{ fontSize: 10, color: '#C4CFEA' }}>/</span>
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#0D1B35' }}>{contaAtual?.nome}</span>
                </div>
              )}

              {/* Animated content container */}
              <div
                key={drillStack.length}
                style={{
                  animation: `${slideDir === 'in' ? 'slideInRight' : 'slideInLeft'} 0.22s ease forwards`,
                  overflow: 'hidden',
                }}
              >
                {drillStack.length === 0 ? (
                  /* ── NÍVEL RAIZ ── */
                  <div style={{ background: '#FFFFFF', border: '1px solid #DDE4F0', borderRadius: 8, overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #DDE4F0' }}>
                          <th style={{ fontSize: 9, fontWeight: 700, color: '#8A9BBC', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left', padding: '8px 12px' }}>Conta</th>
                          <th style={{ fontSize: 9, fontWeight: 700, color: '#8A9BBC', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'right', padding: '8px 12px' }}>Valor</th>
                          <th style={{ fontSize: 9, fontWeight: 700, color: '#8A9BBC', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'right', padding: '8px 12px', width: 50 }}>%</th>
                          <th style={{ width: 20, padding: '8px 8px 8px 0' }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {composicaoRaiz.map((item) => {
                          const pct = totalRaiz ? (Math.abs(item.valor) / Math.abs(totalRaiz)) * 100 : 0;
                          return (
                            <tr
                              key={item.id}
                              onClick={() => item.temFilhas ? avancar({ id: item.id, nome: item.nome, valor: item.valor }) : undefined}
                              style={{
                                borderBottom: '1px solid #F0F4FA',
                                cursor: item.temFilhas ? 'pointer' : 'default',
                                transition: 'background 0.12s',
                              }}
                              onMouseEnter={e => { if (item.temFilhas) e.currentTarget.style.background = 'rgba(26,60,255,0.04)'; }}
                              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                            >
                              <td style={{ fontSize: 12, color: '#4A5E80', padding: '7px 12px' }}>{item.nome}</td>
                              <td style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: '#0D1B35', textAlign: 'right', padding: '7px 12px' }}>
                                {fmtCurrency(Math.abs(item.valor))}
                              </td>
                              <td style={{ fontSize: 11, color: '#8A9BBC', textAlign: 'right', padding: '7px 12px' }}>{pct.toFixed(1)}%</td>
                              <td style={{ padding: '7px 8px 7px 0', textAlign: 'center' }}>
                                {item.temFilhas && (
                                  <span
                                    style={{ fontSize: 10, color: '#C4CFEA', transition: 'color 0.12s' }}
                                    className="drill-chevron"
                                  >→</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {/* Total row */}
                        <tr style={{ borderTop: '1px solid #DDE4F0', background: '#F6F9FF' }}>
                          <td style={{ fontSize: 12, fontWeight: 700, color: '#0D1B35', padding: '8px 12px' }}>Total</td>
                          <td style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#0D1B35', textAlign: 'right', padding: '8px 12px' }}>
                            {fmtCurrency(Math.abs(totalRaiz))}
                          </td>
                          <td style={{ fontSize: 11, fontWeight: 700, color: '#8A9BBC', textAlign: 'right', padding: '8px 12px' }}>100%</td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* ── NÍVEL 2 ── */
                  <div style={{ background: '#FFFFFF', border: '1px solid #DDE4F0', borderRadius: 8, overflow: 'hidden' }}>
                    {filhasNivel2.length === 0 ? (
                      <div style={{ padding: 20, textAlign: 'center' }}>
                        <div style={{ fontSize: 16, marginBottom: 6 }}>📂</div>
                        <p style={{ fontSize: 12, color: '#8A9BBC', margin: 0 }}>Sem detalhamento disponível para esta conta.</p>
                      </div>
                    ) : (
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid #DDE4F0' }}>
                            <th style={{ fontSize: 9, fontWeight: 700, color: '#8A9BBC', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'left', padding: '8px 12px' }}>Conta</th>
                            <th style={{ fontSize: 9, fontWeight: 700, color: '#8A9BBC', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'right', padding: '8px 12px' }}>Valor</th>
                            <th style={{ fontSize: 9, fontWeight: 700, color: '#8A9BBC', letterSpacing: '0.08em', textTransform: 'uppercase', textAlign: 'right', padding: '8px 12px', width: 50 }}>%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filhasNivel2.map((f) => {
                            const pct = totalNivel2 ? (Math.abs(f.valor) / Math.abs(totalNivel2)) * 100 : 0;
                            const isExpanded = expandedCatId === f.id;
                            return (
                              <tr key={f.id} style={{ cursor: 'default' }}>
                                <td colSpan={3} style={{ padding: 0 }}>
                                  <div
                                    onClick={() => setExpandedCatId(isExpanded ? null : f.id)}
                                    style={{
                                      display: 'flex', alignItems: 'center', padding: '7px 12px',
                                      borderBottom: '1px solid #F0F4FA', cursor: 'pointer',
                                    }}
                                  >
                                    <span style={{ fontSize: 12, color: '#4A5E80', flex: 1 }}>{f.nome.replace(/^\([+-]\)\s*/, '')}</span>
                                    <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500, color: '#0D1B35', marginRight: 12 }}>
                                      {fmtCurrency(Math.abs(f.valor))}
                                    </span>
                                    <span style={{ fontSize: 11, color: '#8A9BBC', minWidth: 40, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                                  </div>
                                  {isExpanded && (
                                    <div style={{
                                      background: 'rgba(217,119,6,0.06)',
                                      borderLeft: '2px solid #D97706',
                                      borderRadius: '0 6px 6px 0',
                                      padding: '6px 10px',
                                      fontSize: 10.5,
                                      color: '#92400E',
                                      margin: '0 12px 6px 12px',
                                    }}>
                                      Esta é uma categoria — sem detalhamento disponível.
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {/* Total row */}
                          <tr style={{ borderTop: '1px solid #DDE4F0', background: '#F6F9FF' }}>
                            <td style={{ fontSize: 12, fontWeight: 700, color: '#0D1B35', padding: '8px 12px' }}>Total {contaAtual?.nome}</td>
                            <td style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#0D1B35', textAlign: 'right', padding: '8px 12px' }}>
                              {fmtCurrency(Math.abs(totalNivel2))}
                            </td>
                            <td style={{ fontSize: 11, fontWeight: 700, color: '#8A9BBC', textAlign: 'right', padding: '8px 12px' }}>100%</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Section 3 — Claude Analysis */}
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.15em', display: 'block', marginBottom: 8 }}>✨ ANÁLISE DO CONSULTOR GPI</span>

            {!analise && !loading && (
              <div style={{ background: '#F0F4FA', border: '1px solid #DDE4F0', borderRadius: 12, padding: '32px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✨</div>
                <p style={{ fontSize: 13, color: '#4A5E80', marginBottom: 16 }}>Análise não gerada para este mês</p>
                <button
                  onClick={gerarAnalise}
                  style={{
                    background: '#1A3CFF', color: '#FFFFFF', border: 'none', borderRadius: 8,
                    padding: '10px 24px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1430CC')}
                  onMouseLeave={e => (e.currentTarget.style.background = '#1A3CFF')}
                >
                  ✨ Gerar análise
                </button>
              </div>
            )}

            {loading && (
              <div style={{ background: '#F0F4FA', border: '1px solid #DDE4F0', borderRadius: 12, padding: '24px' }}>
                <Skeleton className="h-4 w-3/4 mb-3" />
                <Skeleton className="h-4 w-full mb-3" />
                <Skeleton className="h-4 w-5/6 mb-3" />
                <Skeleton className="h-4 w-2/3" />
                <p style={{ fontSize: 11, color: '#8A9BBC', marginTop: 12, textAlign: 'center' }}>Analisando indicadores...</p>
              </div>
            )}

            {analise && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {analise.titulo && (
                  <p style={{ fontSize: 14, fontWeight: 700, color: '#0D1B35', margin: 0 }}>{analise.titulo}</p>
                )}
                {analise.alerta && (
                  <div style={{ background: 'rgba(220,38,38,0.06)', borderLeft: '3px solid #DC2626', padding: 10, borderRadius: '0 8px 8px 0' }}>
                    <p style={{ fontSize: 13, color: '#DC2626', margin: 0 }}>{analise.alerta}</p>
                  </div>
                )}
                {analise.contexto && (
                  <p style={{ fontSize: 13, color: '#4A5E80', margin: 0, lineHeight: 1.6 }}>{analise.contexto}</p>
                )}
                {analise.analise && (
                  <p style={{ fontSize: 13, color: '#0D1B35', margin: 0, lineHeight: 1.6 }}>{analise.analise}</p>
                )}
                {analise.acao && (
                  <div style={{ background: 'rgba(0,168,107,0.06)', borderLeft: '3px solid #00A86B', padding: 10, borderRadius: '0 8px 8px 0' }}>
                    <p style={{ fontSize: 13, color: '#0D1B35', margin: 0 }}>{analise.acao}</p>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: '#00A86B', background: 'rgba(0,168,107,0.1)', padding: '2px 6px', borderRadius: 4 }}>✓ CACHE</span>
                  {analise.gerado_em && (
                    <span style={{ fontSize: 11, color: '#8A9BBC' }}>
                      {new Date(analise.gerado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
