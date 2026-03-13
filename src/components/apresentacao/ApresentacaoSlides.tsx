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
  const [torreMetas, setTorreMetas] = useState<any[]>([]);
  const [nextCompValMap, setNextCompValMap] = useState<Record<string, number | null>>({});

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

      // Torre metas for next month
      const nextComp = mesSeguinte(competencia);
      const { data: metasData } = await supabase.from('torre_metas').select('*').eq('cliente_id', clienteId).eq('competencia', nextComp);
      setTorreMetas(metasData || []);

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

  const nextComp = useMemo(() => mesSeguinte(competencia), [competencia]);
  const nextCompLabel = useMemo(() => fmtCompetencia(nextComp), [nextComp]);

  // Torre: group sums with metas for next month
  const torreGroups = useMemo(() => {
    const tipoGroups = [
      { key: 'faturamento', tipo: 'receita', label: 'Faturamento', color: '#7CB8FF', isReceita: true },
      { key: 'custos', tipo: 'custo_variavel', label: 'Custos Operacionais', color: '#FF8989', isReceita: false },
      { key: 'despesas', tipo: 'despesa_fixa', label: 'Despesas Fixas', color: '#FCD34D', isReceita: false },
      { key: 'investimentos', tipo: 'investimento', label: 'Investimentos', color: '#7DD3FC', isReceita: false },
    ];
    return tipoGroups.map(tg => {
      const leafs = getLeafContas(contas).filter(c => c.tipo === tg.tipo);
      const realizado = leafs.reduce((s, c) => s + (valMap[c.id] || 0), 0);
      // Sum metas for leafs of this type
      let metaTotal = 0;
      let hasMeta = false;
      leafs.forEach(c => {
        const m = torreMetas.find((tm: any) => tm.conta_id === c.id);
        if (m && m.meta_valor !== null) {
          hasMeta = true;
          // pct meta: projected = realizado * (1 + pct/100)
          if (m.meta_tipo === 'pct') {
            metaTotal += (valMap[c.id] || 0) * (1 + m.meta_valor / 100);
          } else {
            metaTotal += m.meta_valor;
          }
        } else {
          metaTotal += valMap[c.id] || 0; // no meta = keep same
        }
      });
      const varPct = realizado ? ((metaTotal - realizado) / Math.abs(realizado)) * 100 : 0;
      // top 3 cats by variation
      const cats = leafs.map(c => {
        const m = torreMetas.find((tm: any) => tm.conta_id === c.id);
        const r = valMap[c.id] || 0;
        let proj = r;
        if (m && m.meta_valor !== null) {
          proj = m.meta_tipo === 'pct' ? r * (1 + m.meta_valor / 100) : m.meta_valor;
        }
        const catVar = r ? ((proj - r) / Math.abs(r)) * 100 : 0;
        return { nome: c.nome, realizado: r, meta: proj, varPct: catVar };
      }).filter(c => Math.abs(c.varPct) > 0.1).sort((a, b) => Math.abs(b.varPct) - Math.abs(a.varPct)).slice(0, 3);

      // status for torre table
      const status = torreCalcStatus(realizado, hasMeta ? metaTotal : null, tg.isReceita);

      return { ...tg, realizado, metaTotal: hasMeta ? metaTotal : null, varPct, cats, hasMeta, status };
    });
  }, [contas, valMap, torreMetas]);

  const gcProjetado = useMemo(() => {
    const fatMeta = torreGroups[0].metaTotal ?? torreGroups[0].realizado;
    const custosMeta = torreGroups[1].metaTotal ?? torreGroups[1].realizado;
    const despMeta = torreGroups[2].metaTotal ?? torreGroups[2].realizado;
    const invMeta = torreGroups[3].metaTotal ?? torreGroups[3].realizado;
    return fatMeta + custosMeta + despMeta + invMeta; // custos/desp/inv are negative
  }, [torreGroups]);

  const gcProjetadoPct = useMemo(() => {
    const fatMeta = torreGroups[0].metaTotal ?? torreGroups[0].realizado;
    return fatMeta ? (gcProjetado / Math.abs(fatMeta)) * 100 : 0;
  }, [gcProjetado, torreGroups]);

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

  // ─── SLIDE 5 — Torre de Controle ao Vivo ───
  const renderSlide5 = () => {
    const dreGroups = ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'];
    const torreRows = dreGroups.map(tipo => {
      const leafs = getLeafContas(contas).filter(c => c.tipo === tipo);
      const realizado = leafs.reduce((s, c) => s + (valMap[c.id] || 0), 0);
      let metaTotal = 0;
      let hasMeta = false;
      leafs.forEach(c => {
        const m = torreMetas.find((tm: any) => tm.conta_id === c.id);
        if (m && m.meta_valor !== null) {
          hasMeta = true;
          metaTotal += m.meta_tipo === 'pct' ? (valMap[c.id] || 0) * (1 + m.meta_valor / 100) : m.meta_valor;
        } else {
          metaTotal += valMap[c.id] || 0;
        }
      });
      const isRec = tipo === 'receita';
      const status = torreCalcStatus(realizado, hasMeta ? metaTotal : null, isRec);
      return { tipo, label: TYPE_LABELS[tipo], realizado, meta: hasMeta ? metaTotal : null, status };
    });

    const okCount = torreRows.filter(r => r.status === 'ok').length;
    const atenCount = torreRows.filter(r => r.status === 'atencao').length;
    const critCount = torreRows.filter(r => r.status === 'critico').length;

    const statusBg = (s: string) => s === 'ok' ? 'rgba(0,201,122,0.12)' : s === 'atencao' ? 'rgba(217,119,6,0.12)' : s === 'critico' ? 'rgba(220,38,38,0.12)' : 'transparent';

    return (
      <div className="h-full flex flex-col p-8 gap-4 overflow-auto">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-xl font-bold" style={{ color: TXT }}>Torre de Controle · {nextCompLabel}</h2>
          <span className="text-[9px] px-2 py-0.5 rounded font-bold tracking-wider" style={{ background: 'rgba(26,60,255,0.15)', color: PRIMARY }}>OPERACIONAL</span>
          <span className="text-[9px] px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: TXT_SEC }}>SOMENTE LEITURA</span>
        </div>

        <div className="flex gap-3 mb-2">
          {[
            { label: 'NO PLANO', count: okCount, color: GREEN },
            { label: 'ATENÇÃO', count: atenCount, color: AMBER },
            { label: 'DESVIO CRÍTICO', count: critCount, color: RED },
          ].map(c => (
            <div key={c.label} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
              <div className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
              <span className="text-[10px] font-bold tracking-wider" style={{ color: TXT_SEC }}>{c.label}</span>
              <span className="text-sm font-mono font-bold" style={{ color: TXT }}>{c.count}</span>
            </div>
          ))}
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg ml-auto" style={{ background: 'rgba(0,201,122,0.08)', border: '1px solid rgba(0,201,122,0.2)' }}>
            <span className="text-[10px] font-bold" style={{ color: GREEN }}>GC PROJETADO</span>
            <span className="text-sm font-mono font-bold" style={{ color: GREEN }}>{fmtR(gcProjetado)} · {gcProjetadoPct.toFixed(1)}%</span>
          </div>
        </div>

        <div className="rounded-xl overflow-hidden flex-1" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th className="text-left p-3 font-bold tracking-wider" style={{ color: TXT_SEC }}>CONTA DRE</th>
                <th className="text-right p-3 font-bold tracking-wider" style={{ color: TXT_SEC }}>REALIZADO {mesShort}</th>
                <th className="text-right p-3 font-bold tracking-wider" style={{ color: 'rgba(26,60,255,0.8)' }}>META {nextCompLabel}</th>
                <th className="text-center p-3 font-bold tracking-wider" style={{ color: TXT_SEC }}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {torreRows.map((r, i) => (
                <tr key={r.tipo} style={{ borderTop: `1px solid ${CARD_BORDER}`, background: statusBg(r.status), opacity: 0, animation: `fadeSlideUp 0.4s ease forwards ${i * 60}ms` }}>
                  <td className="p-3 font-bold" style={{ color: TXT }}>{r.label}</td>
                  <td className="p-3 text-right font-mono" style={{ color: TXT }}>{fmtR(r.realizado)}</td>
                  <td className="p-3 text-right font-mono" style={{ color: r.meta !== null ? PRIMARY : TXT_SEC }}>{r.meta !== null ? fmtR(r.meta) : '—'}</td>
                  <td className="p-3 text-center">
                    <div className="w-3 h-3 rounded-full mx-auto" style={{ background: statusColor(r.status) }} />
                  </td>
                </tr>
              ))}
              {[
                { label: '= MARGEM DE CONTRIBUIÇÃO', val: totalizadores.mc },
                { label: '= RESULTADO OPERACIONAL', val: totalizadores.ro },
                { label: '= GERAÇÃO DE CAIXA', val: totalizadores.gc },
              ].map((t) => (
                <tr key={t.label} style={{ borderTop: `1px solid ${CARD_BORDER}`, background: 'rgba(13,27,53,0.6)' }}>
                  <td className="p-3 font-bold text-xs" style={{ color: TXT }}>{t.label}</td>
                  <td className="p-3 text-right font-mono font-bold" style={{ color: t.val >= 0 ? GREEN : RED }}>{fmtR(t.val)}</td>
                  <td className="p-3 text-right font-mono" style={{ color: TXT_SEC }}>—</td>
                  <td className="p-3" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── SLIDE 6 — Plano de Voo ───
  const renderSlide6 = () => {
    const gcAtual = totalizadores.gc;
    const gcAtualPct = fat ? (gcAtual / Math.abs(fat)) * 100 : 0;
    const checkpoints = prepData?.checkpoints_json as Record<string, string> | null;

    const cpData = [
      { n: 1, ...torreGroups[0], cpKey: 'faturamento', cx: 280, cy: 200 },
      { n: 2, ...torreGroups[1], cpKey: 'custos', cx: 530, cy: 155 },
      { n: 3, ...torreGroups[2], cpKey: 'despesas', cx: 780, cy: 155 },
      { n: 4, ...torreGroups[3], cpKey: 'investimentos', cx: 1000, cy: 160 },
    ];

    const gcColor = gcAtualPct >= 10 ? GREEN : gcAtualPct >= 0 ? AMBER : RED;

    const cardPositions = [
      { left: '18%' }, { left: '39%' }, { left: '60%' }, { left: '78%' },
    ];

    return (
      <div className="h-full flex flex-col relative overflow-hidden">
        {/* Stars */}
        <div className="absolute inset-0 pointer-events-none">
          {[
            { x: '5%', y: '8%' }, { x: '12%', y: '22%' }, { x: '25%', y: '5%' }, { x: '35%', y: '15%' },
            { x: '55%', y: '3%' }, { x: '65%', y: '12%' }, { x: '78%', y: '8%' }, { x: '88%', y: '18%' },
            { x: '92%', y: '5%' }, { x: '45%', y: '25%' }, { x: '8%', y: '35%' }, { x: '72%', y: '22%' },
          ].map((s, i) => (
            <div key={i} className="absolute w-[2px] h-[2px] rounded-full" style={{ left: s.x, top: s.y, background: 'rgba(255,255,255,0.3)' }} />
          ))}
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-6 pb-2 z-10">
          <div>
            <span className="text-[9px] tracking-wider font-mono" style={{ color: TXT_SEC }}>Slide 6 · Plano de Voo</span>
            <h2 className="text-xl font-bold" style={{ color: TXT }}>Rota para {nextCompLabel}</h2>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(0,201,122,0.08)', border: '1px solid rgba(0,201,122,0.25)' }}>
            <span className="text-[9px] font-bold tracking-wider" style={{ color: GREEN }}>ALTITUDE ALVO</span>
            <span className="text-sm font-mono font-bold" style={{ color: GREEN }}>GC ≥ {gcProjetadoPct >= 0 ? '+' : ''}{gcProjetadoPct.toFixed(1)}% · {fmtR(gcProjetado)}</span>
          </div>
        </div>

        {/* Flight map area */}
        <div className="flex-1 relative mx-8 mb-2" style={{ minHeight: 380 }}>
          {/* Checkpoint cards */}
          {cpData.map((cp, i) => {
            const varColor = cp.isReceita
              ? (cp.varPct >= 0 ? GREEN : RED)
              : (cp.varPct <= 0 ? GREEN : RED);
            const msg = checkpoints?.[cp.cpKey] || (cp.varPct > 0 === cp.isReceita ? 'Meta alinhada com a tendência de crescimento' : 'Redução necessária para preservar margem');
            return (
              <div
                key={cp.n}
                className="absolute top-0 w-[190px] rounded-xl p-3 transition-all hover:-translate-y-0.5 hover:scale-[1.02] z-10"
                style={{
                  left: cardPositions[i].left,
                  transform: 'translateX(-50%)',
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid rgba(255,255,255,0.08)`,
                  opacity: 0,
                  animation: `fadeSlideUp 0.5s ease forwards ${300 + i * 120}ms`,
                }}
              >
                <div className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded mb-1.5 inline-block" style={{ border: `1px solid ${cp.color}`, color: cp.color }}>
                  CP-{cp.n} · {cp.label}
                </div>
                <div className="flex items-center gap-1 text-[10px] mb-1.5">
                  <span style={{ color: TXT_SEC }}>{mesShort.split('/')[0]?.toLowerCase()}</span>
                  <span className="font-mono" style={{ color: TXT_SEC }}>{fmtR(cp.realizado)}</span>
                  <span style={{ color: TXT_SEC }}>→</span>
                  <span style={{ color: cp.color }}>meta</span>
                  <span className="font-mono" style={{ color: cp.color }}>{cp.metaTotal !== null ? fmtR(cp.metaTotal) : '—'}</span>
                  {cp.hasMeta && <span className="font-mono text-[9px] px-1 rounded" style={{ background: `${varColor}22`, color: varColor }}>{fmtP(cp.varPct)}</span>}
                </div>
                <div className="text-[9.5px] leading-[1.55] pl-2" style={{ color: 'rgba(255,255,255,0.46)', borderLeft: `2px solid ${cp.color}` }}>
                  {msg}
                </div>
                {cp.cats.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {cp.cats.map(cat => {
                      const pillColor = cp.isReceita ? (cat.varPct >= 0 ? GREEN : RED) : (cat.varPct <= 0 ? GREEN : RED);
                      return (
                        <span key={cat.nome} className="text-[8px] font-mono px-1 py-0.5 rounded" style={{ background: `${pillColor}18`, color: pillColor }}>
                          {cat.nome.substring(0, 12)} {fmtP(cat.varPct)}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* SVG Route */}
          <svg viewBox="0 0 1200 420" className="absolute bottom-0 left-0 w-full" style={{ height: 280 }} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FF3B3B" />
                <stop offset="50%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#00C97A" />
              </linearGradient>
            </defs>
            {/* Altitude lines */}
            {[140, 230, 320].map((y, i) => (
              <g key={y}>
                <line x1="40" y1={y} x2="1160" y2={y} stroke="rgba(255,255,255,0.04)" strokeDasharray="4 8" />
                <text x="10" y={y + 3} fill="rgba(255,255,255,0.15)" fontSize="8" fontFamily="monospace">ALT{i === 0 ? '+3' : i === 1 ? '±0' : '−3'}</text>
              </g>
            ))}
            {/* Path shadow */}
            <path d="M 80,310 C 160,310 190,260 280,200 S 430,160 530,155 S 680,155 780,155 S 900,145 1000,160 S 1080,130 1110,100" fill="none" stroke="rgba(0,201,122,0.08)" strokeWidth="12" />
            {/* Path */}
            <path d="M 80,310 C 160,310 190,260 280,200 S 430,160 530,155 S 680,155 780,155 S 900,145 1000,160 S 1080,130 1110,100" fill="none" stroke="url(#routeGrad)" strokeWidth="2.5" strokeDasharray="8 4">
              <animate attributeName="stroke-dashoffset" values="24;0" dur="1.5s" repeatCount="indefinite" />
            </path>

            {/* Start point */}
            <circle cx="80" cy="310" r="10" fill="rgba(255,59,59,0.15)" stroke="#FF3B3B" strokeWidth="1.5" />
            <circle cx="80" cy="310" r="4" fill="#FF3B3B" />
            <text x="80" y="340" textAnchor="middle" fill={gcColor} fontSize="8" fontFamily="monospace" fontWeight="bold">PARTIDA</text>
            <text x="80" y="352" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="monospace">{mesShort}</text>
            <text x="80" y="364" textAnchor="middle" fill={gcColor} fontSize="9" fontFamily="monospace" fontWeight="bold">GC {gcAtualPct.toFixed(1)}%</text>

            {/* Checkpoint nodes */}
            {cpData.map(cp => (
              <g key={cp.n}>
                <circle cx={cp.cx} cy={cp.cy} r="12" fill={`${cp.color}1A`} stroke={`${cp.color}66`} strokeWidth="1.5" />
                <circle cx={cp.cx} cy={cp.cy} r="5" fill={cp.color} />
                <line x1={cp.cx} y1={cp.cy - 12} x2={cp.cx} y2={cp.cy - 60} stroke={`${cp.color}40`} strokeDasharray="3 3" />
                <text x={cp.cx} y={cp.cy + 25} textAnchor="middle" fill={cp.color} fontSize="8" fontFamily="monospace">CP-{cp.n}</text>
              </g>
            ))}

            {/* Destination */}
            <circle cx="1110" cy="100" r="28" fill="rgba(0,201,122,0.07)" stroke="rgba(0,201,122,0.20)" strokeWidth="1">
              <animate attributeName="r" values="26;30;26" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="1110" cy="100" r="18" fill="none" stroke="rgba(0,201,122,0.15)" strokeWidth="1">
              <animate attributeName="r" values="18;22;18" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="1110" cy="100" r="8" fill={GREEN}>
              <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
            </circle>
            <text x="1110" y="145" textAnchor="middle" fill={GREEN} fontSize="8" fontFamily="monospace" fontWeight="bold">DESTINO</text>
            <text x="1110" y="157" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="7" fontFamily="monospace">{nextCompLabel}</text>
            <text x="1110" y="169" textAnchor="middle" fill={GREEN} fontSize="9" fontFamily="monospace" fontWeight="bold">GC {gcProjetadoPct >= 0 ? '+' : ''}{gcProjetadoPct.toFixed(1)}%</text>

            {/* Airplane */}
            <text fontSize="18">
              <animateMotion dur="8s" repeatCount="indefinite" path="M 80,310 C 160,310 190,260 280,200 S 430,160 530,155 S 680,155 780,155 S 900,145 1000,160 S 1080,130 1110,100" />
              ✈
            </text>
          </svg>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 pb-3 z-10">
          <div className="flex items-center gap-1 text-[10px] font-mono flex-wrap" style={{ color: TXT_SEC }}>
            {torreGroups.map((g, i) => (
              <span key={g.key}>
                {i > 0 && <span style={{ color: TXT_SEC }}> − </span>}
                <span style={{ color: g.color }}>{fmtR(g.metaTotal ?? g.realizado)}</span>
              </span>
            ))}
            <span style={{ color: TXT_SEC }}> = </span>
            <span className="px-1.5 py-0.5 rounded font-bold" style={{ background: 'rgba(0,201,122,0.15)', color: GREEN }}>
              {fmtR(gcProjetado)} · {gcProjetadoPct.toFixed(1)}%
            </span>
          </div>
          <span className="text-[9px] font-mono" style={{ color: 'rgba(255,255,255,0.30)' }}>🔔 Estas metas alimentam alertas semanais automáticos</span>
        </div>
      </div>
    );
  };

  // ─── PDF Generation ───
  const handleGeneratePDF = async () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const empresaNome = cliente?.razao_social || cliente?.nome_empresa || 'Cliente';

    doc.setFontSize(18);
    doc.setTextColor(13, 27, 53);
    doc.text('GPI Inteligência Financeira', 20, 25);
    doc.setFontSize(12);
    doc.text(empresaNome, 20, 33);
    doc.setFontSize(10);
    doc.setTextColor(74, 94, 128);
    doc.text(`Competência: ${mesShort}`, 20, 40);
    doc.setDrawColor(200);
    doc.line(20, 44, 190, 44);

    doc.setFontSize(14);
    doc.setTextColor(13, 27, 53);
    doc.text('Onde Estamos', 20, 55);
    doc.setFontSize(10);
    doc.setTextColor(74, 94, 128);
    const gcVal = totalizadores.gc;
    const gcPct = fat ? (gcVal / Math.abs(fat)) * 100 : 0;
    doc.text(`Geração de Caixa: ${fmtR(gcVal)} (${gcPct.toFixed(1)}%)`, 20, 63);
    doc.text(`Faturamento: ${fmtR(fat)}`, 20, 70);
    doc.text(`Score de Saúde: ${score}/100`, 20, 77);

    doc.setFontSize(14);
    doc.setTextColor(13, 27, 53);
    doc.text(`Plano de Voo para ${nextCompLabel}`, 20, 92);

    let y = 100;
    doc.setFontSize(9);
    doc.setTextColor(74, 94, 128);
    doc.text('Grupo', 20, y);
    doc.text('Realizado', 90, y);
    doc.text('Meta', 130, y);
    doc.text('Variação', 165, y);
    y += 3;
    doc.line(20, y, 190, y);
    y += 6;

    doc.setTextColor(13, 27, 53);
    torreGroups.forEach(g => {
      doc.text(g.label, 20, y);
      doc.text(fmtR(g.realizado), 90, y);
      doc.text(g.metaTotal !== null ? fmtR(g.metaTotal) : '—', 130, y);
      doc.text(g.hasMeta ? fmtP(g.varPct) : '—', 165, y);
      y += 7;
    });

    y += 3;
    doc.setFontSize(10);
    doc.setTextColor(0, 150, 80);
    doc.text(`GC Projetado: ${fmtR(gcProjetado)} (${gcProjetadoPct.toFixed(1)}%)`, 20, y);

    if (prepData?.proximos_passos) {
      y += 15;
      doc.setFontSize(14);
      doc.setTextColor(13, 27, 53);
      doc.text('Próximos Passos', 20, y);
      y += 8;
      doc.setFontSize(9);
      doc.setTextColor(74, 94, 128);
      const lines = doc.splitTextToSize(prepData.proximos_passos, 170);
      doc.text(lines, 20, y);
    }

    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(`Documento gerado pela GPI Inteligência Financeira · ${new Date().toLocaleDateString('pt-BR')}`, 20, 285);

    const acoes = torreGroups.map(g => ({
      grupo: g.label,
      realizado: g.realizado,
      meta: g.metaTotal,
      varPct: g.varPct,
    }));
    await supabase.from('caminho_a_seguir').upsert({
      cliente_id: clienteId,
      competencia,
      acoes,
      gerado_em: new Date().toISOString(),
      apresentacao_id: apresentacaoId,
    }, { onConflict: 'cliente_id,competencia' });

    const fileName = `GPI-CaminhoASeguir-${empresaNome.replace(/\s+/g, '')}-${mesShort.replace('/', '-')}.pdf`;
    doc.save(fileName);
  };

  // ─── WhatsApp ───
  const handleWhatsApp = () => {
    const wpp = cliente?.responsavel_whatsapp;
    if (!wpp) {
      alert('Nenhum WhatsApp cadastrado para este cliente.');
      return;
    }
    const num = wpp.replace(/\D/g, '');
    const nome = cliente?.responsavel_nome || 'Cliente';
    const empresaNome = cliente?.razao_social || cliente?.nome_empresa || '';
    const gcVal = totalizadores.gc;
    const gcPct = fat ? (gcVal / Math.abs(fat)) * 100 : 0;
    const proximosPassos = (prepData?.proximos_passos || '').split('\n').slice(0, 2).join('\n');

    const msg = `Olá ${nome}! 👋

Segue o resumo da nossa reunião de ${mesShort}:

📊 *Resultados de ${mesShort}:*
- Faturamento: ${fmtR(fat)}
- Geração de Caixa: ${gcPct.toFixed(1)}% (${fmtR(gcVal)})

🛫 *Plano de Voo para ${nextCompLabel}:*
- Faturamento meta: ${torreGroups[0].metaTotal !== null ? fmtR(torreGroups[0].metaTotal) : '—'}
- Custos meta: ${torreGroups[1].metaTotal !== null ? fmtR(torreGroups[1].metaTotal) : '—'}
- Despesas meta: ${torreGroups[2].metaTotal !== null ? fmtR(torreGroups[2].metaTotal) : '—'}
- GC projetado: ${gcProjetadoPct.toFixed(1)}% (${fmtR(gcProjetado)})

📋 *Próximos passos:*
${proximosPassos || 'A definir'}

Acesse seu portal para acompanhar: https://sistema-gpi.lovable.app/cliente

Qualquer dúvida, estou à disposição! 🚀
_GPI Inteligência Financeira_`;

    window.open(`https://wa.me/55${num}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const slides = [
    renderSlide1,
    renderSlide2,
    renderSlide3,
    renderSlide4,
    renderSlide5,
    renderSlide6,
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

        {/* PDF + WhatsApp buttons */}
        <div className="absolute right-4 flex items-center gap-2">
          <button onClick={handleGeneratePDF} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors hover:bg-white/10" style={{ color: TXT_SEC, border: '1px solid rgba(255,255,255,0.1)' }}>
            <FileText className="h-3.5 w-3.5" /> Gerar PDF
          </button>
          <button onClick={handleWhatsApp} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors hover:bg-white/10" style={{ color: TXT_SEC, border: '1px solid rgba(255,255,255,0.1)' }}>
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </button>
        </div>
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
