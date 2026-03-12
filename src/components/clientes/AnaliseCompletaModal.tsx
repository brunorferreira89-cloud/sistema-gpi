import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { nomeExibido } from '@/lib/clientes-utils';
import { fmtCompetencia } from '@/lib/torre-utils';
import { buildIndicadorPayload } from '@/lib/analise-completa-utils';
import type { ContaRow } from '@/lib/plano-contas-utils';

/* ── types ── */
interface Cliente {
  id: string;
  nome_empresa: string;
  razao_social?: string | null;
}

interface AnaliseCompletaModalProps {
  open: boolean;
  onClose: () => void;
  cliente: Cliente;
  competencia: string;
  indicadorInicial?: string;
}

interface AnaliseRecord {
  indicador: string;
  titulo: string | null;
  contexto?: string | null;
  analise: string | null;
  alerta: string | null;
  acao: string | null;
  gerado_em: string | null;
}

/* ── constants ── */
const INDICADORES = [
  { nome: 'Faturamento', abrev: 'Fat.' },
  { nome: 'Custos Operacionais', abrev: 'Custos' },
  { nome: 'Margem de Contribuição', abrev: 'MC' },
  { nome: 'Despesas Fixas', abrev: 'Desp.' },
  { nome: 'Resultado Operacional', abrev: 'RO' },
  { nome: 'Ativ. Investimento', abrev: 'Investimento' },
  { nome: 'Ativ. Financiamento', abrev: 'Financiamento' },
  { nome: 'Resultado após Invest.', abrev: 'R.Invest.' },
  { nome: 'Geração de Caixa', abrev: 'GC' },
  { nome: 'Ponto de Equilíbrio', abrev: 'P.Equilíbrio' },
];

const C = {
  primary: '#1A3CFF', pLo: 'rgba(26,60,255,0.06)', pMd: 'rgba(26,60,255,0.14)',
  green: '#00A86B', greenBg: 'rgba(0,168,107,0.08)',
  amber: '#D97706', amberBg: 'rgba(217,119,6,0.08)',
  txt: '#0D1B35', txtSec: '#4A5E80', txtMuted: '#8A9BBC',
  border: '#DDE4F0', bg: '#F0F4FA',
};

const slugify = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

/* ── Campo component ── */
function Campo({ label, icon, texto, destaque = false }: { label: string; icon: string; texto?: string | null; destaque?: boolean }) {
  if (!texto) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: C.txtMuted, marginBottom: 4 }}>
        {icon} {label.toUpperCase()}
      </div>
      <div style={{
        fontSize: 13, lineHeight: 1.7, color: destaque ? C.primary : C.txtSec,
        fontWeight: destaque ? 500 : 400,
        background: destaque ? 'rgba(26,60,255,0.04)' : 'transparent',
        borderLeft: destaque ? `3px solid ${C.primary}` : 'none',
        padding: destaque ? '8px 12px' : 0,
        borderRadius: destaque ? 4 : 0,
      }}>
        {texto}
      </div>
    </div>
  );
}

/* ── Skeleton section ── */
function SkeletonSection({ index }: { index: number }) {
  return (
    <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}` }}>
      <div style={{
        width: 180, height: 14, borderRadius: 4, marginBottom: 12,
        background: 'linear-gradient(90deg, #F0F4FA 25%, #E8EEF8 50%, #F0F4FA 75%)',
        backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
      }} />
      <div style={{
        width: '90%', height: 10, borderRadius: 3, marginBottom: 8,
        background: 'linear-gradient(90deg, #F0F4FA 25%, #E8EEF8 50%, #F0F4FA 75%)',
        backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
        animationDelay: `${index * 0.05}s`,
      }} />
      <div style={{
        width: '60%', height: 10, borderRadius: 3,
        background: 'linear-gradient(90deg, #F0F4FA 25%, #E8EEF8 50%, #F0F4FA 75%)',
        backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite',
        animationDelay: `${index * 0.05 + 0.1}s`,
      }} />
    </div>
  );
}

/* ── Main component ── */
export function AnaliseCompletaModal({ open, onClose, cliente, competencia, indicadorInicial }: AnaliseCompletaModalProps) {
  const [analises, setAnalises] = useState<Record<string, AnaliseRecord>>({});
  const [loadingInit, setLoadingInit] = useState(true);
  const [gerandoIndicadores, setGerandoIndicadores] = useState<string[]>([]);
  const [indicadorAtivo, setIndicadorAtivo] = useState(INDICADORES[0].nome);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Load contas + valores for real payload
  const [contas, setContas] = useState<ContaRow[]>([]);
  const [valoresAnuais, setValoresAnuais] = useState<{ conta_id: string; competencia: string; valor_realizado: number | null }[]>([]);

  // Load all cached analyses + financial data on open
  useEffect(() => {
    if (!open) return;
    setLoadingInit(true);
    setAnalises({});

    const load = async () => {
      try {
        // Fetch analyses, contas, and valores in parallel
        const [analRes, contasRes] = await Promise.all([
          supabase.from('analises_ia' as any).select('*').eq('cliente_id', cliente.id).eq('competencia', competencia),
          supabase.from('plano_de_contas').select('*').eq('cliente_id', cliente.id).order('ordem'),
        ]);

        const contasData = (contasRes.data || []) as ContaRow[];
        setContas(contasData);

        // Fetch valores for all contas
        const contaIds = contasData.map(c => c.id);
        let allValores: any[] = [];
        if (contaIds.length > 0) {
          const { data: valData } = await supabase
            .from('valores_mensais')
            .select('conta_id, competencia, valor_realizado')
            .in('conta_id', contaIds);
          allValores = valData || [];
        }
        setValoresAnuais(allValores);

        const map: Record<string, AnaliseRecord> = {};
        if (analRes.data) {
          for (const row of analRes.data as any[]) {
            map[row.indicador] = {
              indicador: row.indicador,
              titulo: row.titulo,
              analise: row.analise,
              alerta: row.alerta || null,
              acao: row.acao,
              gerado_em: row.gerado_em,
            };
          }
        }
        setAnalises(map);
      } catch (e) {
        console.error('Erro ao carregar análises:', e);
      } finally {
        setLoadingInit(false);
      }
    };
    load();
  }, [open, cliente.id, competencia]);

  // Scroll to indicadorInicial after loading
  useEffect(() => {
    if (!loadingInit && indicadorInicial && open) {
      setTimeout(() => {
        const el = document.getElementById(`indicador-${slugify(indicadorInicial)}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }, [loadingInit, indicadorInicial, open]);

  // IntersectionObserver for active chip
  useEffect(() => {
    if (loadingInit || !open) return;
    const container = scrollRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const ind = entry.target.getAttribute('data-indicador');
            if (ind) setIndicadorAtivo(ind);
          }
        }
      },
      { root: container, threshold: 0.3 }
    );

    Object.values(sectionRefs.current).forEach(el => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [loadingInit, open, analises]);

  const mesReferenciaLabel = useMemo(() => {
    const d = new Date(competencia + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  }, [competencia]);

  const gerarAnalise = useCallback(async (nomeIndicador: string) => {
    setGerandoIndicadores(prev => [...prev, nomeIndicador]);
    try {
      // Build real payload from financial data
      const payload = buildIndicadorPayload(nomeIndicador, contas, valoresAnuais, competencia, mesReferenciaLabel);

      const body = payload
        ? {
            indicador: nomeIndicador,
            cliente_id: cliente.id,
            competencia,
            mes_referencia: mesReferenciaLabel,
            valor_atual: payload.valor_atual,
            valor_absoluto: payload.valor_absoluto,
            faturamento: payload.faturamento,
            status: payload.status,
            limite_verde: payload.limite_verde,
            limite_ambar: payload.limite_ambar,
            direcao: payload.direcao,
            historico: payload.historico,
            formula: payload.formula,
            composicao: payload.composicao,
          }
        : {
            indicador: nomeIndicador,
            cliente_id: cliente.id,
            competencia,
            mes_referencia: mesReferenciaLabel,
            valor_atual: 0, valor_absoluto: 0, faturamento: 0,
            status: 'verde', limite_verde: 0, limite_ambar: 0,
            direcao: 'maior_melhor', historico: [], formula: '', composicao: [],
          };

      const { data: result, error } = await supabase.functions.invoke('analisar-indicador', { body });
      if (error) throw error;
      const now = new Date().toISOString();

      const record: AnaliseRecord = {
        indicador: nomeIndicador,
        titulo: result?.titulo || '',
        analise: result?.analise || '',
        alerta: result?.alerta || null,
        acao: result?.acao || '',
        gerado_em: now,
      };
      setAnalises(prev => ({ ...prev, [nomeIndicador]: record }));

      // Save to cache
      await supabase.from('analises_ia' as any).upsert(
        {
          cliente_id: cliente.id,
          indicador: nomeIndicador,
          competencia,
          titulo: record.titulo || '',
          analise: record.analise || '',
          acao: record.acao || '',
          gerado_em: now,
        } as any,
        { onConflict: 'cliente_id,indicador,competencia' }
      );
    } catch (e) {
      console.error('Erro ao gerar análise:', e);
    } finally {
      setGerandoIndicadores(prev => prev.filter(n => n !== nomeIndicador));
    }
  }, [cliente.id, competencia, contas, valoresAnuais, mesReferenciaLabel]);

  const scrollToIndicador = (nome: string) => {
    const el = document.getElementById(`indicador-${slugify(nome)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (!open) return null;

  const comAnalise = INDICADORES.filter(i => analises[i.nome]?.analise).length;
  const pendentes = INDICADORES.length - comAnalise;

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(13,27,53,0.45)' }} />

      {/* Modal container */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, pointerEvents: 'none',
      }}>
        <div style={{
          background: '#FFFFFF', borderRadius: 16,
          width: '100%', maxWidth: 720, maxHeight: '90vh',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 24px 80px rgba(13,27,53,0.18), 0 0 0 1px rgba(196,207,234,0.5)',
          overflow: 'hidden', pointerEvents: 'auto',
          animation: 'modalEnter 0.22s cubic-bezier(0.16,1,0.3,1) forwards',
          fontFamily: "'DM Sans', system-ui",
        }}>
          {/* Header */}
          <div style={{
            padding: '18px 24px',
            background: 'linear-gradient(135deg, #FFFFFF 0%, #EEF4FF 100%)',
            borderBottom: `1px solid ${C.border}`,
            position: 'relative', flexShrink: 0,
          }}>
            <button onClick={onClose} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: C.txtMuted, padding: 4 }}>
              <X style={{ width: 18, height: 18 }} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 13 }}>◎</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: C.primary, letterSpacing: '0.18em' }}>ANÁLISE COMPLETA · IA</span>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: 0 }}>Painel de Análise</h3>
            <p style={{ fontSize: 11, color: C.txtMuted, margin: '4px 0 0' }}>
              {nomeExibido(cliente).toUpperCase()} · {fmtCompetencia(competencia)}
            </p>
            {!loadingInit && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: C.txtMuted, background: C.bg, padding: '2px 8px', borderRadius: 4 }}>
                  {INDICADORES.length} indicadores
                </span>
                {comAnalise > 0 && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.green, background: C.greenBg, padding: '2px 8px', borderRadius: 4 }}>
                    {comAnalise} com análise
                  </span>
                )}
                {pendentes > 0 && (
                  <span style={{ fontSize: 9, fontWeight: 700, color: C.amber, background: C.amberBg, padding: '2px 8px', borderRadius: 4 }}>
                    {pendentes} pendentes
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Quick index */}
          {!loadingInit && (
            <div style={{
              padding: '10px 24px',
              background: 'rgba(26,60,255,0.03)',
              borderBottom: `1px solid ${C.border}`,
              display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            }}>
              {INDICADORES.map(ind => {
                const tem = !!analises[ind.nome]?.analise;
                const isActive = indicadorAtivo === ind.nome;
                return (
                  <button
                    key={ind.nome}
                    onClick={() => scrollToIndicador(ind.nome)}
                    style={{
                      fontSize: 10, fontWeight: 600,
                      padding: '3px 10px', borderRadius: 4,
                      border: `1px solid ${isActive ? C.pMd : C.border}`,
                      background: isActive ? C.pMd : C.bg,
                      color: isActive ? C.primary : C.txtSec,
                      cursor: 'pointer',
                      fontFamily: "'DM Sans', system-ui",
                      transition: 'all 0.15s',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <span style={{ fontSize: 8, color: tem ? C.green : C.amber }}>●</span>
                    {ind.abrev}
                  </button>
                );
              })}
            </div>
          )}

          {/* Scroll area */}
          <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto' }}>
            {loadingInit ? (
              INDICADORES.map((_, i) => <SkeletonSection key={i} index={i} />)
            ) : (
              INDICADORES.map(ind => {
                const analise = analises[ind.nome];
                const temAnalise = !!analise?.analise;
                const gerando = gerandoIndicadores.includes(ind.nome);

                return (
                  <div
                    key={ind.nome}
                    id={`indicador-${slugify(ind.nome)}`}
                    data-indicador={ind.nome}
                    ref={el => { sectionRefs.current[ind.nome] = el; }}
                    style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}` }}
                  >
                    {/* Section header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                      <div style={{ width: 3, height: 18, borderRadius: 2, background: temAnalise ? C.green : C.amber }} />
                      <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>{ind.nome}</span>
                      {temAnalise ? (
                        <span style={{ fontSize: 8, fontWeight: 700, color: C.green, background: C.greenBg, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.06em' }}>
                          ✓ ANALISADO
                        </span>
                      ) : (
                        <span style={{ fontSize: 8, fontWeight: 700, color: C.amber, background: C.amberBg, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.06em' }}>
                          ○ PENDENTE
                        </span>
                      )}
                      {analise?.gerado_em && (
                        <span style={{ fontSize: 10, color: C.txtMuted }}>
                          {new Date(analise.gerado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                        </span>
                      )}
                    </div>

                    {/* Content */}
                    <div style={{ paddingLeft: 11 }}>
                      {temAnalise ? (
                        <>
                          {analise.titulo && (
                            <div style={{ fontSize: 15, fontWeight: 600, color: C.txt, marginBottom: 10 }}>
                              {analise.titulo}
                            </div>
                          )}
                          {analise.alerta && (
                            <div style={{
                              background: 'rgba(220,38,38,0.04)', borderLeft: '3px solid #DC2626',
                              padding: '8px 12px', fontSize: 12, color: '#DC2626', marginBottom: 12,
                              borderRadius: '0 4px 4px 0',
                            }}>
                              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', marginBottom: 2 }}>⚠ ALERTA</div>
                              {analise.alerta}
                            </div>
                          )}
                          <Campo label="Contexto" icon="📋" texto={(analise as any).contexto} />
                          <Campo label="Análise" icon="🔍" texto={analise.analise} />
                          <Campo label="Ação recomendada" icon="→" texto={analise.acao} destaque />
                          <div style={{ marginTop: 8 }}>
                            <button
                              onClick={() => gerarAnalise(ind.nome)}
                              disabled={gerando}
                              style={{
                                padding: '5px 12px', borderRadius: 5, border: `1px solid ${C.border}`,
                                background: gerando ? C.bg : '#FFFFFF', color: C.txtSec,
                                fontSize: 10, fontWeight: 600, cursor: gerando ? 'not-allowed' : 'pointer',
                                fontFamily: "'DM Sans', system-ui",
                                display: 'inline-flex', alignItems: 'center', gap: 5,
                                transition: 'all 0.15s',
                              }}
                            >
                              {gerando ? '⏳ Regenerando...' : '🔄 Regerar análise'}
                            </button>
                          </div>
                        </>
                      ) : gerando ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 0' }}>
                          <div style={{ width: 20, height: 20, border: `2px solid ${C.border}`, borderTopColor: C.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                          <span style={{ fontSize: 12, color: C.txtSec }}>O Claude está analisando {ind.nome}...</span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0' }}>
                          <span style={{ fontSize: 20, color: C.txtMuted, opacity: 0.4 }}>○</span>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 12, color: C.txtSec }}>Análise ainda não gerada para este indicador.</div>
                            <div style={{ fontSize: 11, color: C.txtMuted }}>Clique para gerar com o Claude.</div>
                          </div>
                          <button
                            onClick={() => gerarAnalise(ind.nome)}
                            style={{
                              padding: '7px 16px', borderRadius: 6, border: 'none', cursor: 'pointer',
                              background: C.primary, color: '#FFFFFF',
                              fontSize: 11, fontWeight: 700, fontFamily: "'DM Sans', system-ui",
                              display: 'flex', alignItems: 'center', gap: 6,
                              transition: 'all 0.15s', flexShrink: 0,
                            }}
                          >
                            ✨ Gerar
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes modalEnter { from{opacity:0;transform:scale(0.96) translateY(8px)} to{opacity:1;transform:scale(1) translateY(0)} }
        @keyframes spin { to{transform:rotate(360deg)} }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
    </>
  );
}
