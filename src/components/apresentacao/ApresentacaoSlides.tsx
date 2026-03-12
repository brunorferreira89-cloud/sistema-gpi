import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { X, ChevronLeft, ChevronRight, Loader2, FileText, MessageCircle } from 'lucide-react';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas, sumLeafByTipo, calcIndicador } from '@/lib/dre-indicadores';
import { fetchMergedIndicadores, calcularIndicadores, calcScore } from '@/lib/kpi-indicadores-utils';
import { mesSeguinte, fmtCompetencia, calcStatus as torreCalcStatus } from '@/lib/torre-utils';
import { jsPDF } from 'jspdf';
import gpiLogo from '@/assets/gpi-logo-light.png';

interface Props {
  clienteId: string;
  competencia: string;
  onExit: () => void;
}

const TOTAL_SLIDES = 6;

// ─── Styling constants ───
const NAVY_BG = 'radial-gradient(ellipse at 50% 30%, #0A1628 0%, #060D1A 60%, #0D1B35 100%)';
const CARD_BG = 'rgba(255,255,255,0.04)';
const CARD_BORDER = 'rgba(255,255,255,0.08)';
const TXT = 'rgba(255,255,255,0.85)';
const TXT_SEC = 'rgba(255,255,255,0.45)';
const PRIMARY = '#1A3CFF';
const CYAN = '#0099E6';
const GREEN = '#00C97A';
const AMBER = '#D97706';
const RED = '#DC2626';

const TYPE_COLORS: Record<string, string> = {
  receita: PRIMARY,
  custo_variavel: RED,
  despesa_fixa: AMBER,
  investimento: CYAN,
  financeiro: '#8A9BBC',
};
const TYPE_LABELS: Record<string, string> = {
  receita: 'RECEITAS',
  custo_variavel: 'CUSTOS OPERACIONAIS',
  despesa_fixa: 'DESPESAS FIXAS',
  investimento: 'INVESTIMENTOS',
  financeiro: 'FINANCIAMENTOS',
};

const fmtR = (v: number) => `R$ ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const fmtP = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

export default function ApresentacaoSlides({ clienteId, competencia, onExit }: Props) {
  const { user, profile } = useAuth();
  const [slide, setSlide] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const [apresentacaoId, setApresentacaoId] = useState<string | null>(null);

  // Data states
  const [cliente, setCliente] = useState<any>(null);
  const [contas, setContas] = useState<any[]>([]);
  const [valMap, setValMap] = useState<Record<string, number | null>>({});
  const [prevValMap, setPrevValMap] = useState<Record<string, number | null>>({});
  const [kpiCalcs, setKpiCalcs] = useState<any[]>([]);
  const [score, setScore] = useState(0);
  const [analises, setAnalises] = useState<any[]>([]);
  const [prepData, setPrepData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());

  // Load all data
  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: cli } = await supabase.from('clientes').select('*').eq('id', clienteId).single();
      setCliente(cli);

      const { data: contasRaw } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      const contasData = (contasRaw || []) as ContaRow[];
      setContas(contasData);

      const ids = contasData.map(c => c.id);
      const { data: valores } = await supabase.from('valores_mensais').select('conta_id, valor_realizado, competencia').in('conta_id', ids);
      const vm: Record<string, number | null> = {};
      (valores || []).filter((v: any) => v.competencia === competencia).forEach((v: any) => { vm[v.conta_id] = v.valor_realizado; });
      setValMap(vm);

      const prevDate = new Date(competencia + 'T00:00:00');
      prevDate.setMonth(prevDate.getMonth() - 1);
      const prevComp = prevDate.toISOString().split('T')[0];
      const pvm: Record<string, number | null> = {};
      (valores || []).filter((v: any) => v.competencia === prevComp).forEach((v: any) => { pvm[v.conta_id] = v.valor_realizado; });
      setPrevValMap(pvm);

      // KPIs
      try {
        const inds = await fetchMergedIndicadores(clienteId);
        const calcs = calcularIndicadores(inds, contasData || [], vm);
        setKpiCalcs(calcs);
        setScore(calcScore(calcs));
      } catch { /* */ }

      // Analises IA
      const { data: anData } = await supabase.from('analises_ia').select('*').eq('cliente_id', clienteId).eq('competencia', competencia);
      setAnalises(anData || []);

      // Prep
      const { data: prepRes } = await supabase.from('apresentacao_preparacao').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle();
      setPrepData(prepRes);

      // Create/update apresentacao record
      const { data: existing } = await supabase.from('apresentacoes').select('id').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle();
      if (existing) {
        await supabase.from('apresentacoes').update({ slide_atual: 1, iniciada_em: new Date().toISOString(), consultor_id: user?.id }).eq('id', existing.id);
        setApresentacaoId(existing.id);
      } else {
        const { data: newA } = await supabase.from('apresentacoes').insert({ cliente_id: clienteId, competencia, consultor_id: user?.id, iniciada_em: new Date().toISOString(), slide_atual: 1 }).select('id').single();
        setApresentacaoId(newA?.id || null);
      }

      setLoading(false);
    }
    load();
  }, [clienteId, competencia, user?.id]);

  const goTo = useCallback((n: number) => {
    if (n < 1 || n > TOTAL_SLIDES || n === slide) return;
    setTransitioning(true);
    setTimeout(() => setTransitioning(false), 220);
    setSlide(n);
    if (apresentacaoId) {
      supabase.from('apresentacoes').update({ slide_atual: n }).eq('id', apresentacaoId);
    }
  }, [slide, apresentacaoId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(slide + 1);
      else if (e.key === 'ArrowLeft') goTo(slide - 1);
      else if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [goTo, onExit, slide]);

  // Computed data
  const fat = useMemo(() => sumLeafByTipo(contas, valMap, 'receita'), [contas, valMap]);
  const prevFat = useMemo(() => sumLeafByTipo(contas, prevValMap, 'receita'), [contas, prevValMap]);

  const tipos = ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'];
  const groupData = useMemo(() => tipos.map(tipo => {
    const val = sumLeafByTipo(contas, valMap, tipo);
    const prevVal = sumLeafByTipo(contas, prevValMap, tipo);
    const subgrupos = contas.filter(c => c.nivel === 1 && c.tipo === tipo).map(sg => {
      const cats = contas.filter(c => c.conta_pai_id === sg.id && c.nivel === 2);
      const sgVal = cats.reduce((s: number, c: any) => s + (valMap[c.id] || 0), 0);
      return {
        nome: sg.nome,
        valor: sgVal,
        categorias: cats.map((c: any) => ({ nome: c.nome, valor: valMap[c.id] || 0 })).filter(c => c.valor !== 0).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
      };
    }).filter(sg => sg.valor !== 0);
    const varPct = prevVal ? ((val - prevVal) / Math.abs(prevVal)) * 100 : 0;
    const avPct = fat ? (Math.abs(val) / Math.abs(fat)) * 100 : 0;
    return { tipo, label: TYPE_LABELS[tipo], color: TYPE_COLORS[tipo], val, prevVal, varPct, avPct, subgrupos };
  }), [contas, valMap, prevValMap, fat]);

  const totalizadores = useMemo(() => {
    const mc = calcIndicador(contas, valMap, ['receita', 'custo_variavel']);
    const ro = calcIndicador(contas, valMap, ['receita', 'custo_variavel', 'despesa_fixa']);
    const rai = calcIndicador(contas, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento']);
    const gc = calcIndicador(contas, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);
    return { mc, ro, rai, gc };
  }, [contas, valMap]);

  const mesLabel = (() => {
    const d = new Date(competencia + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();
  })();

  const mesShort = (() => {
    const d = new Date(competencia + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase().replace('.', '');
  })();

  const todayFormatted = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: NAVY_BG }}>
        <Loader2 className="h-10 w-10 animate-spin" style={{ color: PRIMARY }} />
      </div>
    );
  }

  const statusColor = (s: string) => s === 'verde' ? GREEN : s === 'ambar' ? AMBER : RED;

  // ─── SLIDE RENDERS ───
  const renderSlide1 = () => (
    <div className="flex flex-col items-center justify-center h-full gap-5">
      {[
        <img key="logo" src={gpiLogo} alt="GPI" className="h-12 w-auto animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ opacity: 0, animationDelay: '0ms' }} />,
        <span key="label" className="text-[10px] tracking-[0.3em] uppercase animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ color: TXT_SEC, opacity: 0, animationDelay: '100ms' }}>INTELIGÊNCIA FINANCEIRA</span>,
        <div key="sep1" className="w-32 h-px animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ background: CARD_BORDER, opacity: 0, animationDelay: '200ms' }} />,
        <h1 key="nome" className="text-3xl font-extrabold text-center animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ color: TXT, opacity: 0, animationDelay: '300ms' }}>{cliente?.razao_social || cliente?.nome_empresa}</h1>,
        <span key="cnpj" className="text-xs font-mono animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ color: 'rgba(255,255,255,0.3)', opacity: 0, animationDelay: '400ms' }}>{cliente?.cnpj || ''}</span>,
        <span key="comp" className="text-lg font-bold animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ color: CYAN, opacity: 0, animationDelay: '500ms' }}>{mesLabel}</span>,
        <div key="sep2" className="w-32 h-px animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ background: CARD_BORDER, opacity: 0, animationDelay: '600ms' }} />,
        <span key="titulo" className="text-sm animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ color: TXT_SEC, opacity: 0, animationDelay: '700ms' }}>Reunião Mensal de Inteligência Financeira</span>,
        <span key="consultor" className="text-sm animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ color: TXT_SEC, opacity: 0, animationDelay: '800ms' }}>Consultor: {profile?.nome || 'Consultor GPI'}</span>,
        <span key="data" className="text-xs animate-[fadeSlideUp_0.6s_ease_forwards]" style={{ color: 'rgba(255,255,255,0.3)', opacity: 0, animationDelay: '900ms' }}>{todayFormatted}</span>,
      ]}
    </div>
  );

  const renderSlide2 = () => (
    <div className="h-full flex flex-col p-8 gap-4 overflow-auto">
      <h2 className="text-xl font-bold" style={{ color: TXT }}>Números & Saúde Financeira · {mesShort}</h2>
      <div className="flex gap-6 flex-1 min-h-0">
        {/* Left: 5 group cards */}
        <div className="flex-[65] space-y-3 overflow-auto pr-2">
          {groupData.map((g, gi) => (
            <div key={g.tipo} className="rounded-xl p-4" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, opacity: 0, animation: `fadeSlideUp 0.5s ease forwards ${gi * 80}ms` }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                  <span className="text-xs font-bold tracking-wider" style={{ color: TXT }}>{g.label}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold" style={{ color: TXT }}>{fmtR(g.val)}</span>
                  <span className="text-xs font-mono" style={{ color: g.varPct >= 0 ? GREEN : RED }}>{fmtP(g.varPct)}</span>
                  <span className="text-[10px]" style={{ color: TXT_SEC }}>AV {g.avPct.toFixed(1)}%</span>
                </div>
              </div>
              {/* Subgroups */}
              {g.subgrupos.map(sg => (
                <div key={sg.nome} className="ml-3 mb-2">
                  <div className="flex justify-between text-[11px] mb-1" style={{ color: TXT_SEC }}>
                    <span>{sg.nome}</span>
                    <span className="font-mono">{fmtR(sg.valor)}</span>
                  </div>
                  {sg.categorias.slice(0, 5).map(cat => {
                    const pctBar = g.val ? (Math.abs(cat.valor) / Math.abs(g.val)) * 100 : 0;
                    const avCat = fat ? (Math.abs(cat.valor) / Math.abs(fat)) * 100 : 0;
                    return (
                      <div key={cat.nome} className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] w-[140px] truncate" style={{ color: TXT_SEC }}>{cat.nome}</span>
                        <div className="flex-1 h-[3px] rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
                          <div className="h-full rounded-full transition-all duration-[1100ms]" style={{ width: `${Math.min(pctBar, 100)}%`, background: g.color, transitionTimingFunction: 'cubic-bezier(0.16,1,0.3,1)' }} />
                        </div>
                        <span className="text-[10px] font-mono w-[80px] text-right" style={{ color: TXT_SEC }}>{fmtR(cat.valor)}</span>
                        <span className="text-[9px] w-[40px] text-right" style={{ color: TXT_SEC }}>{avCat.toFixed(1)}%</span>
                      </div>
                    );
                  })}
                  {sg.categorias.length > 5 && (
                    <div className="text-[10px] ml-1" style={{ color: TXT_SEC }}>
                      Outros {fmtR(sg.categorias.slice(5).reduce((s, c) => s + Math.abs(c.valor), 0))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Right: health semaphore */}
        <div className="flex-[35] rounded-xl p-4" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
          <h3 className="text-xs font-bold tracking-wider mb-4" style={{ color: TXT }}>SEMÁFORO DE SAÚDE</h3>
          <div className="space-y-3">
            {kpiCalcs.filter(k => k.indicador.ativo).map((k, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: statusColor(k.status) }} />
                <span className="text-xs flex-1" style={{ color: TXT_SEC }}>{k.indicador.nome}</span>
                <span className="text-xs font-mono" style={{ color: TXT }}>{k.pct?.toFixed(1) ?? '—'}%</span>
              </div>
            ))}
            <div className="border-t pt-3 mt-3" style={{ borderColor: CARD_BORDER }}>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ background: score >= 70 ? GREEN : score >= 40 ? AMBER : RED }} />
                <span className="text-xs flex-1 font-bold" style={{ color: TXT }}>Score Geral</span>
                <span className="text-sm font-mono font-bold" style={{ color: TXT }}>{score}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const slide3Indicators = ['Faturamento', 'Custos Operacionais', 'Margem de Contribuição', 'Despesas Fixas', 'Resultado Operacional', 'Geração de Caixa'];

  const renderSlide3 = () => (
    <div className="h-full flex flex-col p-8 gap-4 overflow-auto">
      <h2 className="text-xl font-bold" style={{ color: TXT }}>O que aconteceu · {mesShort}</h2>
      <div className="grid grid-cols-3 gap-4 flex-1">
        {slide3Indicators.map((indName, i) => {
          const an = analises.find((a: any) => a.indicador === indName);
          const expanded = expandedCards.has(indName);
          // Find value
          const gd = groupData.find(g => TYPE_LABELS[g.tipo] === indName.toUpperCase()) || groupData.find(g => g.label.toLowerCase().includes(indName.toLowerCase().split(' ')[0]));
          let val = 0, varPct = 0;
          if (indName === 'Faturamento') { val = fat; varPct = prevFat ? ((fat - prevFat) / Math.abs(prevFat)) * 100 : 0; }
          else if (indName === 'Custos Operacionais') { const g = groupData.find(g => g.tipo === 'custo_variavel'); val = g?.val || 0; varPct = g?.varPct || 0; }
          else if (indName === 'Despesas Fixas') { const g = groupData.find(g => g.tipo === 'despesa_fixa'); val = g?.val || 0; varPct = g?.varPct || 0; }
          else if (indName === 'Margem de Contribuição') { val = totalizadores.mc; }
          else if (indName === 'Resultado Operacional') { val = totalizadores.ro; }
          else if (indName === 'Geração de Caixa') { val = totalizadores.gc; }

          return (
            <div
              key={indName}
              className="rounded-xl p-4 cursor-pointer transition-all"
              style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, opacity: 0, animation: `fadeSlideUp 0.5s ease forwards ${i * 80}ms` }}
              onClick={() => setExpandedCards(prev => {
                const n = new Set(prev);
                n.has(indName) ? n.delete(indName) : n.add(indName);
                return n;
              })}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold" style={{ color: TXT }}>{indName}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: an ? 'rgba(0,201,122,0.15)' : 'rgba(217,119,6,0.15)', color: an ? GREEN : AMBER }}>
                  {an ? '✅ Analisado' : '⏳ Pendente'}
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-bold" style={{ color: TXT }}>{fmtR(val)}</span>
                {varPct !== 0 && <span className="text-[10px] font-mono" style={{ color: varPct > 0 ? GREEN : RED }}>{fmtP(varPct)}</span>}
              </div>
              {expanded && an && (
                <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: CARD_BORDER }}>
                  <p className="text-xs font-bold" style={{ color: TXT }}>{an.titulo}</p>
                  {an.alerta && (
                    <div className="text-[11px] p-2 rounded" style={{ background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', color: 'rgba(255,255,255,0.8)' }}>
                      ⚠️ {an.alerta}
                    </div>
                  )}
                  <p className="text-[11px] leading-relaxed" style={{ color: TXT_SEC }}>{an.analise}</p>
                  {an.acao && <p className="text-[11px] font-medium" style={{ color: CYAN }}>→ {an.acao}</p>}
                </div>
              )}
              {expanded && !an && (
                <div className="mt-3 text-center border-t pt-3" style={{ borderColor: CARD_BORDER }}>
                  <span className="text-[11px]" style={{ color: TXT_SEC }}>Análise não disponível</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderSlide4 = () => {
    const campos = [
      { key: 'diagnostico', icon: '🔍', label: 'Diagnóstico' },
      { key: 'objetivos', icon: '🎯', label: 'Objetivos' },
      { key: 'riscos', icon: '⚠️', label: 'Riscos' },
      { key: 'proximos_passos', icon: '✅', label: 'Próximos Passos' },
    ];
    const hasContent = campos.some(c => prepData?.[c.key]);

    return (
      <div className="h-full flex flex-col p-8 gap-4 overflow-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold" style={{ color: TXT }}>Análise Consultiva · {mesShort}</h2>
          {prepData?.editado_em && (
            <span className="text-[10px] px-2 py-1 rounded" style={{ background: 'rgba(217,119,6,0.15)', color: AMBER }}>Revisado pelo consultor</span>
          )}
        </div>
        {hasContent ? (
          <div className="grid grid-cols-2 gap-4 flex-1">
            {campos.map((c, i) => (
              <div key={c.key} className="rounded-xl p-5" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, opacity: 0, animation: `fadeSlideUp 0.5s ease forwards ${i * 80}ms` }}>
                <h3 className="text-sm font-bold mb-3" style={{ color: TXT }}>{c.icon} {c.label}</h3>
                <p className="text-[13px] leading-[1.6] whitespace-pre-wrap" style={{ color: TXT_SEC }}>
                  {prepData?.[c.key] || 'Análise não gerada — use a tela Preparar Apresentação'}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="rounded-xl p-8 text-center" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
              <p className="text-sm mb-4" style={{ color: TXT_SEC }}>Nenhuma análise consultiva gerada para este mês.</p>
              <button onClick={onExit} className="text-sm font-medium px-4 py-2 rounded-lg" style={{ background: PRIMARY, color: '#fff' }}>
                Voltar para Preparar Apresentação
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPlaceholder = (title: string) => (
    <div className="h-full flex items-center justify-center">
      <div className="rounded-xl p-8 text-center" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
        <span className="text-3xl mb-3 block">🚧</span>
        <p className="text-sm" style={{ color: TXT_SEC }}>Em breve — {title}</p>
      </div>
    </div>
  );

  const slides = [
    renderSlide1,
    renderSlide2,
    renderSlide3,
    renderSlide4,
    () => renderPlaceholder('Torre ao Vivo'),
    () => renderPlaceholder('Plano de Voo'),
  ];

  return (
    <div className="fixed inset-0 z-[9999]" style={{ background: NAVY_BG }}>
      {/* Scanlines */}
      <div className="fixed inset-0 pointer-events-none z-[10000]" style={{ background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.015) 2px, rgba(255,255,255,0.015) 4px)' }} />

      {/* Transition flash */}
      {transitioning && (
        <div className="fixed inset-0 z-[10001] pointer-events-none" style={{ background: `linear-gradient(135deg, ${PRIMARY}, ${CYAN})`, opacity: 0.18, transition: 'opacity 220ms', animation: 'fadeOut 220ms ease forwards' }} />
      )}

      {/* Exit button */}
      <button onClick={onExit} className="fixed top-4 right-4 z-[10002] p-2 rounded-lg hover:bg-white/10 transition-colors" style={{ color: TXT_SEC }}>
        <X className="h-5 w-5" />
      </button>

      {/* Slide content */}
      <div className="h-[calc(100%-48px)] overflow-hidden">
        {slides[slide - 1]()}
      </div>

      {/* Nav bar */}
      <div className="fixed bottom-0 left-0 right-0 h-12 flex items-center justify-center gap-4 z-[10002]" style={{ background: 'rgba(6,13,26,0.8)' }}>
        <button onClick={() => goTo(slide - 1)} disabled={slide === 1} className="p-1 rounded disabled:opacity-30" style={{ color: TXT_SEC }}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex gap-1.5">
          {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
            <button key={i} onClick={() => goTo(i + 1)} className="w-2 h-2 rounded-full transition-all" style={{ background: i + 1 === slide ? PRIMARY : 'rgba(255,255,255,0.2)' }} />
          ))}
        </div>
        <span className="text-[10px] font-mono mx-2" style={{ color: TXT_SEC }}>{slide} / {TOTAL_SLIDES}</span>
        <button onClick={() => goTo(slide + 1)} disabled={slide === TOTAL_SLIDES} className="p-1 rounded disabled:opacity-30" style={{ color: TXT_SEC }}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <style>{`
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeOut {
          from { opacity: 0.18; }
          to { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
