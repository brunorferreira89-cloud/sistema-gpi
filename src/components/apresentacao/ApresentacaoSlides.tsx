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
  receita: PRIMARY, custo_variavel: RED, despesa_fixa: AMBER, investimento: CYAN, financeiro: '#8A9BBC',
};
const TYPE_LABELS: Record<string, string> = {
  receita: 'RECEITAS', custo_variavel: 'CUSTOS OPERACIONAIS', despesa_fixa: 'DESPESAS FIXAS',
  investimento: 'INVESTIMENTOS', financeiro: 'FINANCIAMENTOS',
};

const fmtR = (v: number) => `R$ ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const fmtP = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

export default function ApresentacaoSlides({ clienteId, competencia, onExit }: Props) {
  const { user, profile } = useAuth();
  const [slide, setSlide] = useState(1);
  const [transitioning, setTransitioning] = useState(false);
  const [apresentacaoId, setApresentacaoId] = useState<string | null>(null);

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

      try {
        const inds = await fetchMergedIndicadores(clienteId);
        const calcs = calcularIndicadores(inds, contasData || [], vm);
        setKpiCalcs(calcs);
        setScore(calcScore(calcs));
      } catch { /* */ }

      const { data: anData } = await supabase.from('analises_ia').select('*').eq('cliente_id', clienteId).eq('competencia', competencia);
      setAnalises(anData || []);

      const { data: prepRes } = await supabase.from('apresentacao_preparacao').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle();
      setPrepData(prepRes);

      const nextComp = mesSeguinte(competencia);
      const { data: metasData } = await supabase.from('torre_metas').select('*').eq('cliente_id', clienteId).eq('competencia', nextComp);
      setTorreMetas(metasData || []);

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
    setTimeout(() => setTransitioning(false), 150);
    setSlide(n);
    if (apresentacaoId) {
      supabase.from('apresentacoes').update({ slide_atual: n }).eq('id', apresentacaoId);
    }
  }, [slide, apresentacaoId]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goTo(slide + 1); }
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
        nome: sg.nome, valor: sgVal,
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
      let metaTotal = 0; let hasMeta = false;
      leafs.forEach(c => {
        const m = torreMetas.find((tm: any) => tm.conta_id === c.id);
        if (m && m.meta_valor !== null) {
          hasMeta = true;
          metaTotal += m.meta_tipo === 'pct' ? (valMap[c.id] || 0) * (1 + m.meta_valor / 100) : m.meta_valor;
        } else { metaTotal += valMap[c.id] || 0; }
      });
      const varPct = realizado ? ((metaTotal - realizado) / Math.abs(realizado)) * 100 : 0;
      const cats = leafs.map(c => {
        const m = torreMetas.find((tm: any) => tm.conta_id === c.id);
        const r = valMap[c.id] || 0;
        let proj = r;
        if (m && m.meta_valor !== null) { proj = m.meta_tipo === 'pct' ? r * (1 + m.meta_valor / 100) : m.meta_valor; }
        const catVar = r ? ((proj - r) / Math.abs(r)) * 100 : 0;
        return { nome: c.nome, realizado: r, meta: proj, varPct: catVar };
      }).filter(c => Math.abs(c.varPct) > 0.1).sort((a, b) => Math.abs(b.varPct) - Math.abs(a.varPct)).slice(0, 3);
      const status = torreCalcStatus(realizado, hasMeta ? metaTotal : null, tg.isReceita);
      return { ...tg, realizado, metaTotal: hasMeta ? metaTotal : null, varPct, cats, hasMeta, status };
    });
  }, [contas, valMap, torreMetas]);

  const gcProjetado = useMemo(() => {
    const fatMeta = torreGroups[0].metaTotal ?? torreGroups[0].realizado;
    const custosMeta = torreGroups[1].metaTotal ?? torreGroups[1].realizado;
    const despMeta = torreGroups[2].metaTotal ?? torreGroups[2].realizado;
    const invMeta = torreGroups[3].metaTotal ?? torreGroups[3].realizado;
    return fatMeta + custosMeta + despMeta + invMeta;
  }, [torreGroups]);

  const gcProjetadoPct = useMemo(() => {
    const fatMeta = torreGroups[0].metaTotal ?? torreGroups[0].realizado;
    return fatMeta ? (gcProjetado / Math.abs(fatMeta)) * 100 : 0;
  }, [gcProjetado, torreGroups]);

  const mesLabelLong = useMemo(() => {
    const d = new Date(competencia + 'T00:00:00');
    const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${meses[d.getMonth()]} de ${d.getFullYear()}`;
  }, [competencia]);

  const mesShort = useMemo(() => {
    const d = new Date(competencia + 'T00:00:00');
    const m = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    return `${m[d.getMonth()]}/${d.getFullYear()}`;
  }, [competencia]);

  const todayFormatted = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  const statusColor = (s: string) => s === 'verde' || s === 'ok' ? GREEN : s === 'ambar' || s === 'atencao' ? AMBER : RED;
  const statusLabel = (s: string) => s === 'verde' || s === 'ok' ? '✓ ok' : s === 'ambar' || s === 'atencao' ? '⚠ atenção' : '✕ crítico';

  // ─── SLIDE 1 — ABERTURA ───
  const renderSlide1 = () => {
    const items = [
      { el: <img src={gpiLogo} alt="GPI" className="h-14 w-auto" />, delay: 0 },
      { el: <div className="w-48 h-[2px] mx-auto" style={{ background: `linear-gradient(90deg, ${PRIMARY}, ${CYAN})` }} />, delay: 70 },
      { el: <span className="text-[11px] tracking-[0.25em] uppercase font-mono" style={{ color: CYAN }}>Relatório de Inteligência Financeira</span>, delay: 140 },
      { el: <h1 className="text-[48px] font-extrabold text-center leading-tight" style={{ color: '#fff' }}>{cliente?.razao_social || cliente?.nome_empresa}</h1>, delay: 210 },
      { el: <span className="text-sm font-mono" style={{ color: 'rgba(255,255,255,0.35)' }}>{cliente?.cnpj || ''}</span>, delay: 280 },
      { el: <div className="w-32 h-px" style={{ background: CARD_BORDER }} />, delay: 350 },
      { el: <span className="text-base" style={{ color: 'rgba(255,255,255,0.6)' }}>{mesLabelLong}</span>, delay: 420 },
      { el: <span className="text-sm" style={{ color: TXT_SEC }}>Consultor: {profile?.nome || 'Consultor GPI'}</span>, delay: 490 },
      { el: <span className="text-xs" style={{ color: 'rgba(255,255,255,0.25)' }}>{todayFormatted}</span>, delay: 560 },
    ];
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        {items.map((item, i) => (
          <div key={i} style={{ opacity: 0, animation: `slideUp 0.6s ease forwards ${item.delay}ms` }}>{item.el}</div>
        ))}
      </div>
    );
  };

  // ─── SLIDE 2 — NÚMEROS & SAÚDE ───
  const renderSlide2 = () => {
    const dreCards = groupData.slice(0, 5); // 5 DRE groups
    const mcPct = fat ? (totalizadores.mc / Math.abs(fat)) * 100 : 0;
    const roPct = fat ? (totalizadores.ro / Math.abs(fat)) * 100 : 0;

    return (
      <div className="h-full flex flex-col p-8 gap-5 overflow-auto">
        <h2 className="text-xs font-bold tracking-[0.2em] uppercase font-mono" style={{ color: PRIMARY }}>Números do Período</h2>

        {/* 5-column DRE cards */}
        <div className="grid grid-cols-5 gap-3">
          {dreCards.map((g, i) => {
            const expanded = expandedCards.has(g.tipo);
            const avColor = g.tipo === 'receita' ? TXT : g.avPct > 40 ? RED : TXT_SEC;
            return (
              <div
                key={g.tipo}
                className="rounded-xl cursor-pointer transition-all hover:scale-[1.02]"
                style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, opacity: 0, animation: `slideUp 0.5s ease forwards ${i * 80}ms` }}
                onClick={() => setExpandedCards(prev => { const n = new Set(prev); n.has(g.tipo) ? n.delete(g.tipo) : n.add(g.tipo); return n; })}
              >
                <div className="p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: g.color }} />
                    <span className="text-[10px] font-bold tracking-wider font-mono" style={{ color: TXT_SEC }}>{g.label}</span>
                  </div>
                  <span className="text-[22px] font-extrabold font-mono block" style={{ color: '#fff' }}>{fmtR(g.val)}</span>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm font-mono" style={{ color: avColor }}>AV {g.avPct.toFixed(1)}%</span>
                    {g.varPct !== 0 && <span className="text-[10px] font-mono" style={{ color: g.varPct >= 0 ? GREEN : RED }}>{fmtP(g.varPct)}</span>}
                  </div>
                </div>
                {expanded && (
                  <div className="px-4 pb-4 border-t" style={{ borderColor: CARD_BORDER }}>
                    {g.subgrupos.map(sg => (
                      <div key={sg.nome} className="mt-2">
                        <div className="flex justify-between text-[10px] mb-1" style={{ color: TXT_SEC }}>
                          <span className="truncate flex-1">{sg.nome}</span>
                          <span className="font-mono ml-2">{fmtR(sg.valor)}</span>
                        </div>
                        {sg.categorias.slice(0, 4).map(cat => {
                          const pctBar = g.val ? (Math.abs(cat.valor) / Math.abs(g.val)) * 100 : 0;
                          return (
                            <div key={cat.nome} className="flex items-center gap-1.5 mb-0.5">
                              <span className="text-[9px] w-[90px] truncate" style={{ color: TXT_SEC }}>{cat.nome}</span>
                              <div className="flex-1 h-[3px] rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                                <div className="h-full rounded-full" style={{ width: `${Math.min(pctBar, 100)}%`, background: g.color, transition: 'width 1s cubic-bezier(0.16,1,0.3,1)' }} />
                              </div>
                              <span className="text-[9px] font-mono w-[60px] text-right" style={{ color: TXT_SEC }}>{fmtR(cat.valor)}</span>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Saúde Financeira */}
        <div className="rounded-xl p-4" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
          <div className="flex items-center gap-3 mb-4">
            <h3 className="text-xs font-bold tracking-wider font-mono" style={{ color: TXT }}>SAÚDE FINANCEIRA</h3>
            <span className="text-sm font-mono font-bold px-2 py-0.5 rounded" style={{ color: score >= 70 ? GREEN : score >= 40 ? AMBER : RED, background: score >= 70 ? 'rgba(0,201,122,0.12)' : score >= 40 ? 'rgba(217,119,6,0.12)' : 'rgba(220,38,38,0.12)' }}>
              {score}/100 · {score >= 70 ? 'Saudável' : score >= 40 ? 'Atenção' : 'Crítico'}
            </span>
          </div>
          <div className="grid grid-cols-5 gap-3">
            {kpiCalcs.filter(k => k.indicador.ativo).slice(0, 5).map((k, i) => (
              <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${CARD_BORDER}` }}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: statusColor(k.status) }} />
                <span className="text-[11px] flex-1 truncate" style={{ color: TXT_SEC }}>{k.indicador.nome}</span>
                <span className="text-xs font-mono font-bold" style={{ color: TXT }}>{k.pct?.toFixed(1) ?? '—'}%</span>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ color: statusColor(k.status), background: `${statusColor(k.status)}18` }}>
                  {statusLabel(k.status)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  // ─── SLIDE 3 — O QUE ACONTECEU ───
  const slide3Indicators = ['Faturamento', 'Custos Operacionais', 'Margem de Contribuição', 'Despesas Fixas', 'Resultado Operacional', 'Geração de Caixa'];

  const renderSlide3 = () => (
    <div className="h-full flex flex-col p-8 gap-5 overflow-auto">
      <h2 className="text-xs font-bold tracking-[0.2em] uppercase font-mono" style={{ color: PRIMARY }}>
        O que aconteceu em {mesShort.split('/')[0]}
      </h2>
      <div className="grid grid-cols-3 grid-rows-2 gap-4 flex-1">
        {slide3Indicators.map((indName, i) => {
          const an = analises.find((a: any) => a.indicador === indName);
          const expanded = expandedCards.has(`s3-${indName}`);
          let val = 0;
          if (indName === 'Faturamento') val = fat;
          else if (indName === 'Custos Operacionais') val = groupData.find(g => g.tipo === 'custo_variavel')?.val || 0;
          else if (indName === 'Despesas Fixas') val = groupData.find(g => g.tipo === 'despesa_fixa')?.val || 0;
          else if (indName === 'Margem de Contribuição') val = totalizadores.mc;
          else if (indName === 'Resultado Operacional') val = totalizadores.ro;
          else if (indName === 'Geração de Caixa') val = totalizadores.gc;

          const icons: Record<string, string> = {
            'Faturamento': '📈', 'Custos Operacionais': '💰', 'Margem de Contribuição': '📊',
            'Despesas Fixas': '🏢', 'Resultado Operacional': '⚙️', 'Geração de Caixa': '🎯',
          };

          return (
            <div
              key={indName}
              className="rounded-xl cursor-pointer transition-all hover:scale-[1.01] flex flex-col"
              style={{
                background: CARD_BG,
                border: an?.acao ? `1px solid rgba(220,38,38,0.3)` : `1px solid ${CARD_BORDER}`,
                opacity: 0, animation: `slideUp 0.5s ease forwards ${i * 80}ms`,
              }}
              onClick={() => setExpandedCards(prev => { const n = new Set(prev); const k = `s3-${indName}`; n.has(k) ? n.delete(k) : n.add(k); return n; })}
            >
              <div className="p-4 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{icons[indName]}</span>
                    <span className="text-xs font-bold font-mono" style={{ color: TXT }}>{indName}</span>
                  </div>
                  {an?.acao && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(220,38,38,0.15)', color: RED }}>⚠ Alerta</span>
                  )}
                  {!an && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(217,119,6,0.12)', color: AMBER }}>Pendente</span>
                  )}
                </div>
                {an ? (
                  <>
                    <p className="text-xs font-bold mb-1" style={{ color: TXT }}>{an.titulo}</p>
                    <p className={`text-[11px] leading-relaxed ${!expanded ? 'line-clamp-3' : ''}`} style={{ color: TXT_SEC }}>
                      {an.analise}
                    </p>
                    {expanded && an.acao && (
                      <p className="text-[11px] font-medium mt-2" style={{ color: CYAN }}>→ {an.acao}</p>
                    )}
                  </>
                ) : (
                  <p className="text-[11px]" style={{ color: TXT_SEC }}>Análise não gerada</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  // ─── SLIDE 4 — ANÁLISE CONSULTIVA ───
  const renderSlide4 = () => {
    const campos = [
      { key: 'diagnostico', icon: '🔍', label: 'O que os números dizem' },
      { key: 'objetivos', icon: '🎯', label: 'O que queremos alcançar' },
      { key: 'riscos', icon: '⚡', label: 'Riscos se não agirmos' },
      { key: 'proximos_passos', icon: '✅', label: 'O que fazer esta semana' },
    ];
    const hasContent = campos.some(c => prepData?.[c.key]);

    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header strip */}
        <div className="px-8 py-4" style={{ background: 'rgba(26,60,255,0.12)', borderBottom: `2px solid ${PRIMARY}` }}>
          <h2 className="text-xs font-bold tracking-[0.2em] uppercase font-mono" style={{ color: PRIMARY }}>
            Análise Consultiva · {mesShort}
          </h2>
        </div>

        {hasContent ? (
          <div className="grid grid-cols-2 grid-rows-2 gap-4 flex-1 p-6 min-h-0">
            {campos.map((c, i) => {
              const val = prepData?.[c.key];
              const isReviewed = !!prepData?.editado_em;
              const isIA = !!prepData?.gerado_em && !prepData?.editado_em;
              return (
                <div
                  key={c.key}
                  className="rounded-xl flex flex-col overflow-hidden"
                  style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, opacity: 0, animation: `slideUp 0.5s ease forwards ${i * 80}ms` }}
                >
                  <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${CARD_BORDER}` }}>
                    <span className="text-base">{c.icon}</span>
                    <span className="text-xs font-bold font-mono flex-1" style={{ color: TXT }}>{c.label}</span>
                    {isReviewed && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,201,122,0.12)', color: GREEN }}>✓ Revisado</span>
                    )}
                    {isIA && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(26,60,255,0.12)', color: PRIMARY }}>✨ IA</span>
                    )}
                  </div>
                  <div className="flex-1 overflow-auto px-4 py-3">
                    <p className="text-[12px] leading-[1.7] whitespace-pre-wrap" style={{ color: TXT_SEC }}>
                      {val || 'Conteúdo não gerado'}
                    </p>
                  </div>
                </div>
              );
            })}
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

  // ─── SLIDE 5 — TORRE AO VIVO ───
  const renderSlide5 = () => {
    const dreGroups = ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'];
    const torreRows = dreGroups.map(tipo => {
      const leafs = getLeafContas(contas).filter(c => c.tipo === tipo);
      const realizado = leafs.reduce((s, c) => s + (valMap[c.id] || 0), 0);
      let metaTotal = 0; let hasMeta = false;
      leafs.forEach(c => {
        const m = torreMetas.find((tm: any) => tm.conta_id === c.id);
        if (m && m.meta_valor !== null) {
          hasMeta = true;
          metaTotal += m.meta_tipo === 'pct' ? (valMap[c.id] || 0) * (1 + m.meta_valor / 100) : m.meta_valor;
        } else { metaTotal += valMap[c.id] || 0; }
      });
      const isRec = tipo === 'receita';
      const status = torreCalcStatus(realizado, hasMeta ? metaTotal : null, isRec);
      return { tipo, label: TYPE_LABELS[tipo], realizado, meta: hasMeta ? metaTotal : null, status };
    });

    const statusBg = (s: string) => s === 'ok' ? 'rgba(0,201,122,0.06)' : s === 'atencao' ? 'rgba(217,119,6,0.06)' : s === 'critico' ? 'rgba(220,38,38,0.06)' : 'transparent';
    const statusIcon = (s: string) => s === 'ok' ? '✅' : s === 'critico' ? '❌' : s === 'atencao' ? '⚠️' : '—';

    return (
      <div className="h-full flex flex-col p-8 gap-5 overflow-auto">
        <div className="flex items-center gap-3">
          <h2 className="text-xs font-bold tracking-[0.2em] uppercase font-mono" style={{ color: PRIMARY }}>
            Torre de Controle · {mesShort} — Metas vs Realizado
          </h2>
          <span className="text-[9px] font-mono px-2 py-0.5 rounded" style={{ background: 'rgba(255,255,255,0.06)', color: TXT_SEC }}>SOMENTE LEITURA</span>
        </div>

        {/* Legend */}
        <div className="flex gap-4">
          {[
            { icon: '✅', label: 'Atingiu meta', color: GREEN },
            { icon: '❌', label: 'Abaixo da meta', color: RED },
            { icon: '—', label: 'Sem meta', color: TXT_SEC },
          ].map(l => (
            <div key={l.label} className="flex items-center gap-1.5 text-[10px] font-mono" style={{ color: l.color }}>
              <span>{l.icon}</span> {l.label}
            </div>
          ))}
        </div>

        <div className="rounded-xl overflow-hidden flex-1" style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}` }}>
          <table className="w-full text-xs font-mono">
            <thead>
              <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                <th className="text-left p-4 font-bold tracking-wider" style={{ color: TXT_SEC }}>CONTA DRE</th>
                <th className="text-right p-4 font-bold tracking-wider" style={{ color: TXT_SEC }}>REALIZADO</th>
                <th className="text-right p-4 font-bold tracking-wider" style={{ color: PRIMARY }}>META</th>
                <th className="text-center p-4 font-bold tracking-wider" style={{ color: TXT_SEC }}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {torreRows.map((r, i) => (
                <tr key={r.tipo} style={{ borderTop: `1px solid ${CARD_BORDER}`, background: statusBg(r.status), opacity: 0, animation: `slideUp 0.4s ease forwards ${i * 60}ms` }}>
                  <td className="p-4 font-bold" style={{ color: TXT }}>{r.label}</td>
                  <td className="p-4 text-right" style={{ color: TXT }}>{fmtR(r.realizado)}</td>
                  <td className="p-4 text-right" style={{ color: r.meta !== null ? PRIMARY : TXT_SEC }}>{r.meta !== null ? fmtR(r.meta) : '—'}</td>
                  <td className="p-4 text-center text-sm">{statusIcon(r.status)}</td>
                </tr>
              ))}
              {[
                { label: '= MARGEM DE CONTRIBUIÇÃO', val: totalizadores.mc },
                { label: '= RESULTADO OPERACIONAL', val: totalizadores.ro },
                { label: '= GERAÇÃO DE CAIXA', val: totalizadores.gc },
              ].map(t => (
                <tr key={t.label} style={{ borderTop: `1px solid ${CARD_BORDER}`, background: 'rgba(13,27,53,0.5)' }}>
                  <td className="p-4 font-bold" style={{ color: TXT }}>{t.label}</td>
                  <td className="p-4 text-right font-bold" style={{ color: t.val >= 0 ? GREEN : RED }}>{fmtR(t.val)}</td>
                  <td className="p-4 text-right" style={{ color: TXT_SEC }}>—</td>
                  <td className="p-4" />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── SLIDE 6 — PLANO DE VOO ───
  const renderSlide6 = () => {
    const gcAtual = totalizadores.gc;
    const gcAtualPct = fat ? (gcAtual / Math.abs(fat)) * 100 : 0;
    const checkpoints = prepData?.checkpoints_json as Record<string, string> | null;
    const gcColor = gcAtualPct >= 10 ? GREEN : gcAtualPct >= 0 ? AMBER : RED;

    const cpData = [
      { n: 1, ...torreGroups[0], cpKey: 'faturamento', cx: 280, cy: 240 },
      { n: 2, ...torreGroups[1], cpKey: 'custos', cx: 530, cy: 200 },
      { n: 3, ...torreGroups[2], cpKey: 'despesas', cx: 780, cy: 170 },
      { n: 4, ...torreGroups[3], cpKey: 'investimentos', cx: 1000, cy: 140 },
    ];
    const cardPositions = [{ left: '20%' }, { left: '40%' }, { left: '60%' }, { left: '80%' }];

    return (
      <div className="h-full flex flex-col relative overflow-hidden">
        {/* Stars */}
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className="absolute w-[2px] h-[2px] rounded-full" style={{
              left: `${5 + (i * 6.3) % 90}%`, top: `${3 + (i * 7.1) % 30}%`,
              background: 'rgba(255,255,255,0.3)', opacity: 0.4,
            }} />
          ))}
        </div>

        {/* Green horizon gradient */}
        <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(0,201,122,0.04), transparent)' }} />

        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-6 pb-2 z-10">
          <h2 className="text-xs font-bold tracking-[0.2em] uppercase font-mono" style={{ color: PRIMARY }}>
            Plano de Voo · Metas {nextCompLabel}
          </h2>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ background: 'rgba(0,201,122,0.08)', border: '1px solid rgba(0,201,122,0.25)' }}>
            <span className="text-[9px] font-bold tracking-wider font-mono" style={{ color: GREEN }}>GC PROJETADO</span>
            <span className="text-sm font-mono font-bold" style={{ color: GREEN }}>{fmtR(gcProjetado)} · {gcProjetadoPct.toFixed(1)}%</span>
          </div>
        </div>

        {/* Flight map */}
        <div className="flex-1 relative mx-8 mb-2" style={{ minHeight: 380 }}>
          {/* Checkpoint cards */}
          {cpData.map((cp, i) => {
            const varColor = cp.isReceita ? (cp.varPct >= 0 ? GREEN : RED) : (cp.varPct <= 0 ? GREEN : RED);
            const msg = checkpoints?.[cp.cpKey] || (cp.varPct > 0 === cp.isReceita ? 'Meta alinhada com tendência' : 'Redução necessária para margem');
            return (
              <div
                key={cp.n}
                className="absolute top-0 w-[185px] rounded-xl p-3 z-10"
                style={{
                  left: cardPositions[i].left, transform: 'translateX(-50%)',
                  background: CARD_BG, border: `1px solid ${CARD_BORDER}`,
                  opacity: 0, animation: `slideUp 0.5s ease forwards ${300 + i * 120}ms`,
                }}
              >
                <div className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded mb-1.5 inline-block" style={{ border: `1px solid ${cp.color}`, color: cp.color }}>
                  CP-{cp.n} · {cp.label}
                </div>
                <div className="flex items-center gap-1 text-[10px] mb-1.5 font-mono">
                  <span style={{ color: TXT_SEC }}>{fmtR(cp.realizado)}</span>
                  <span style={{ color: TXT_SEC }}>→</span>
                  <span style={{ color: cp.color }}>{cp.metaTotal !== null ? fmtR(cp.metaTotal) : '—'}</span>
                  {cp.hasMeta && <span className="text-[9px] px-1 rounded" style={{ background: `${varColor}22`, color: varColor }}>{fmtP(cp.varPct)}</span>}
                </div>
                <div className="text-[9px] leading-[1.5] pl-2" style={{ color: 'rgba(255,255,255,0.4)', borderLeft: `2px solid ${cp.color}` }}>{msg}</div>
              </div>
            );
          })}

          {/* SVG Route */}
          <svg viewBox="0 0 1200 420" className="absolute bottom-0 left-0 w-full" style={{ height: 280 }} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="routeGrad6" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#FF3B3B" />
                <stop offset="50%" stopColor="#F59E0B" />
                <stop offset="100%" stopColor="#00C97A" />
              </linearGradient>
            </defs>
            {/* Shadow path */}
            <path d="M 80,310 C 160,310 190,260 280,240 S 430,205 530,200 S 680,175 780,170 S 900,145 1000,140 S 1080,110 1110,100" fill="none" stroke="rgba(0,201,122,0.06)" strokeWidth="14" />
            {/* Animated dashed path */}
            <path d="M 80,310 C 160,310 190,260 280,240 S 430,205 530,200 S 680,175 780,170 S 900,145 1000,140 S 1080,110 1110,100" fill="none" stroke="url(#routeGrad6)" strokeWidth="2.5" strokeDasharray="8 4">
              <animate attributeName="stroke-dashoffset" values="24;0" dur="1.5s" repeatCount="indefinite" />
            </path>

            {/* Start point */}
            <circle cx="80" cy="310" r="12" fill="rgba(255,59,59,0.12)" stroke="#FF3B3B" strokeWidth="1.5">
              <animate attributeName="r" values="10;14;10" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="80" cy="310" r="4" fill="#FF3B3B" />
            <text x="80" y="340" textAnchor="middle" fill={gcColor} fontSize="8" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">AGORA</text>
            <text x="80" y="355" textAnchor="middle" fill={gcColor} fontSize="9" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">GC {gcAtualPct.toFixed(1)}%</text>

            {/* Checkpoint nodes */}
            {cpData.map(cp => (
              <g key={cp.n}>
                <circle cx={cp.cx} cy={cp.cy} r="12" fill={`${cp.color}1A`} stroke={`${cp.color}66`} strokeWidth="1.5" />
                <circle cx={cp.cx} cy={cp.cy} r="5" fill={cp.color} />
                <line x1={cp.cx} y1={cp.cy - 12} x2={cp.cx} y2={cp.cy - 60} stroke={`${cp.color}40`} strokeDasharray="3 3" />
              </g>
            ))}

            {/* Destination */}
            <circle cx="1110" cy="100" r="28" fill="rgba(0,201,122,0.07)" stroke="rgba(0,201,122,0.20)" strokeWidth="1">
              <animate attributeName="r" values="26;30;26" dur="3s" repeatCount="indefinite" />
            </circle>
            <circle cx="1110" cy="100" r="8" fill={GREEN}>
              <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
            </circle>
            <text x="1110" y="145" textAnchor="middle" fill={GREEN} fontSize="8" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">GC PROJETADO</text>
            <text x="1110" y="160" textAnchor="middle" fill={GREEN} fontSize="9" fontFamily="'JetBrains Mono', monospace" fontWeight="bold">{gcProjetadoPct >= 0 ? '+' : ''}{gcProjetadoPct.toFixed(1)}% · {fmtR(gcProjetado)}</text>

            {/* Airplane */}
            <text fontSize="18" fill={PRIMARY} style={{ filter: `drop-shadow(0 0 6px ${PRIMARY})` }}>
              <animateMotion dur="8s" repeatCount="indefinite" rotate="auto" path="M 80,310 C 160,310 190,260 280,240 S 430,205 530,200 S 680,175 780,170 S 900,145 1000,140 S 1080,110 1110,100" />
              ✈
            </text>
          </svg>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 pb-4 z-10">
          <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: TXT_SEC }}>
            <span>FAT − CMV − CMO − INVEST = GC</span>
            <span className="ml-2 text-[9px]" style={{ color: 'rgba(255,255,255,0.3)' }}>🔔 alertas semanais automáticos</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleGeneratePDF} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium font-mono transition-colors hover:bg-white/10" style={{ color: TXT_SEC, border: '1px solid rgba(255,255,255,0.1)' }}>
              <FileText className="h-3.5 w-3.5" /> 📄 Gerar PDF
            </button>
            <button onClick={handleWhatsApp} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium font-mono transition-colors hover:bg-white/10" style={{ color: TXT_SEC, border: '1px solid rgba(255,255,255,0.1)' }}>
              <MessageCircle className="h-3.5 w-3.5" /> 💬 Enviar por WhatsApp
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── PDF Generation ───
  const handleGeneratePDF = async () => {
    const doc = new jsPDF('p', 'mm', 'a4');
    const empresaNome = cliente?.razao_social || cliente?.nome_empresa || 'Cliente';

    doc.setFontSize(18); doc.setTextColor(13, 27, 53);
    doc.text('GPI Inteligência Financeira', 20, 25);
    doc.setFontSize(12); doc.text(empresaNome, 20, 33);
    doc.setFontSize(10); doc.setTextColor(74, 94, 128);
    doc.text(`Competência: ${mesShort}`, 20, 40);
    doc.setDrawColor(200); doc.line(20, 44, 190, 44);

    doc.setFontSize(14); doc.setTextColor(13, 27, 53);
    doc.text('Onde Estamos', 20, 55);
    doc.setFontSize(10); doc.setTextColor(74, 94, 128);
    const gcVal = totalizadores.gc;
    const gcPct = fat ? (gcVal / Math.abs(fat)) * 100 : 0;
    doc.text(`Geração de Caixa: ${fmtR(gcVal)} (${gcPct.toFixed(1)}%)`, 20, 63);
    doc.text(`Faturamento: ${fmtR(fat)}`, 20, 70);
    doc.text(`Score de Saúde: ${score}/100`, 20, 77);

    doc.setFontSize(14); doc.setTextColor(13, 27, 53);
    doc.text(`Plano de Voo para ${nextCompLabel}`, 20, 92);

    let y = 100;
    doc.setFontSize(9); doc.setTextColor(74, 94, 128);
    doc.text('Grupo', 20, y); doc.text('Realizado', 90, y); doc.text('Meta', 130, y); doc.text('Variação', 165, y);
    y += 3; doc.line(20, y, 190, y); y += 6;
    doc.setTextColor(13, 27, 53);
    torreGroups.forEach(g => {
      doc.text(g.label, 20, y);
      doc.text(fmtR(g.realizado), 90, y);
      doc.text(g.metaTotal !== null ? fmtR(g.metaTotal) : '—', 130, y);
      doc.text(g.hasMeta ? fmtP(g.varPct) : '—', 165, y);
      y += 7;
    });
    y += 3; doc.setFontSize(10); doc.setTextColor(0, 150, 80);
    doc.text(`GC Projetado: ${fmtR(gcProjetado)} (${gcProjetadoPct.toFixed(1)}%)`, 20, y);

    if (prepData?.proximos_passos) {
      y += 15; doc.setFontSize(14); doc.setTextColor(13, 27, 53);
      doc.text('Próximos Passos', 20, y); y += 8;
      doc.setFontSize(9); doc.setTextColor(74, 94, 128);
      const lines = doc.splitTextToSize(prepData.proximos_passos, 170);
      doc.text(lines, 20, y);
    }

    doc.setFontSize(8); doc.setTextColor(150, 150, 150);
    doc.text(`Documento gerado pela GPI Inteligência Financeira · ${new Date().toLocaleDateString('pt-BR')}`, 20, 285);

    const acoes = torreGroups.map(g => ({ grupo: g.label, realizado: g.realizado, meta: g.metaTotal, varPct: g.varPct }));
    await supabase.from('caminho_a_seguir').upsert({
      cliente_id: clienteId, competencia, acoes, gerado_em: new Date().toISOString(), apresentacao_id: apresentacaoId,
    }, { onConflict: 'cliente_id,competencia' });

    const fileName = `GPI-CaminhoASeguir-${empresaNome.replace(/\s+/g, '')}-${mesShort.replace('/', '-')}.pdf`;
    doc.save(fileName);
  };

  const handleWhatsApp = () => {
    const wpp = cliente?.responsavel_whatsapp;
    if (!wpp) { alert('Nenhum WhatsApp cadastrado para este cliente.'); return; }
    const num = wpp.replace(/\D/g, '');
    const nome = cliente?.responsavel_nome || 'Cliente';
    const empresaNome = cliente?.razao_social || cliente?.nome_empresa || '';
    const gcVal = totalizadores.gc;
    const gcPct = fat ? (gcVal / Math.abs(fat)) * 100 : 0;
    const proximosPassos = (prepData?.proximos_passos || '').split('\n').slice(0, 2).join('\n');

    const msg = `Olá ${nome}! 👋\n\nSegue o resumo da nossa reunião de ${mesShort}:\n\n📊 *Resultados de ${mesShort}:*\n- Faturamento: ${fmtR(fat)}\n- Geração de Caixa: ${gcPct.toFixed(1)}% (${fmtR(gcVal)})\n\n🛫 *Plano de Voo para ${nextCompLabel}:*\n- Faturamento meta: ${torreGroups[0].metaTotal !== null ? fmtR(torreGroups[0].metaTotal) : '—'}\n- Custos meta: ${torreGroups[1].metaTotal !== null ? fmtR(torreGroups[1].metaTotal) : '—'}\n- Despesas meta: ${torreGroups[2].metaTotal !== null ? fmtR(torreGroups[2].metaTotal) : '—'}\n- GC projetado: ${gcProjetadoPct.toFixed(1)}% (${fmtR(gcProjetado)})\n\n📋 *Próximos passos:*\n${proximosPassos || 'A definir'}\n\nAcesse seu portal para acompanhar: ${window.location.origin}/cliente\n\nQualquer dúvida, estou à disposição! 🚀\n_GPI Inteligência Financeira_`;

    window.open(`https://wa.me/55${num}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: NAVY_BG }}>
        <Loader2 className="h-10 w-10 animate-spin" style={{ color: PRIMARY }} />
      </div>
    );
  }

  const slides = [renderSlide1, renderSlide2, renderSlide3, renderSlide4, renderSlide5, renderSlide6];

  return (
    <div className="fixed inset-0 z-[9999]" style={{ background: NAVY_BG, fontFamily: "'JetBrains Mono', monospace" }}>
      {/* HUD Grid */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{
        backgroundImage: 'linear-gradient(rgba(26,60,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(26,60,255,0.06) 1px, transparent 1px)',
        backgroundSize: '52px 52px',
        animation: 'gridPulse 4s ease-in-out infinite',
      }} />

      {/* Scanlines */}
      <div className="fixed inset-0 pointer-events-none z-[1]" style={{
        background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.06) 3px, rgba(0,0,0,0.06) 4px)',
      }} />

      {/* Transition flash */}
      {transitioning && (
        <div className="fixed inset-0 z-[10001] pointer-events-none" style={{
          background: `linear-gradient(135deg, ${PRIMARY}, ${CYAN})`,
          animation: 'flashTransition 150ms ease forwards',
        }} />
      )}

      {/* Exit button */}
      <button onClick={onExit} className="fixed top-4 right-4 z-[10002] p-2 rounded-lg transition-colors" style={{ color: TXT_SEC }} onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')} onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
        <X className="h-5 w-5" />
      </button>

      {/* Slide content */}
      <div className="h-[calc(100%-52px)] overflow-hidden relative z-[2]">
        {slides[slide - 1]()}
      </div>

      {/* Nav bar */}
      <div className="fixed bottom-0 left-0 right-0 h-[52px] flex items-center justify-center gap-4 z-[10002]" style={{ background: 'rgba(6,13,26,0.85)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <button onClick={() => goTo(slide - 1)} disabled={slide === 1} className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-mono disabled:opacity-30 transition-colors" style={{ color: TXT_SEC }} onMouseEnter={e => { if (slide > 1) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          <ChevronLeft className="h-3.5 w-3.5" /> Anterior
        </button>

        <div className="flex gap-2 items-center">
          {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i + 1)}
              className="w-2.5 h-2.5 rounded-full transition-all"
              style={{
                background: i + 1 === slide ? PRIMARY : 'rgba(255,255,255,0.2)',
                boxShadow: i + 1 === slide ? `0 0 8px ${PRIMARY}` : 'none',
                transform: i + 1 === slide ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        <span className="text-[10px] font-mono mx-2" style={{ color: TXT_SEC }}>{slide} / {TOTAL_SLIDES}</span>

        <button onClick={() => goTo(slide + 1)} disabled={slide === TOTAL_SLIDES} className="flex items-center gap-1 px-3 py-1 rounded text-[11px] font-mono disabled:opacity-30 transition-colors" style={{ color: TXT_SEC }} onMouseEnter={e => { if (slide < TOTAL_SLIDES) e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }} onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
          Próximo <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <style>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes flashTransition {
          0% { opacity: 0; }
          40% { opacity: 0.15; }
          100% { opacity: 0; }
        }
        @keyframes gridPulse {
          0%, 100% { opacity: 0.7; }
          50% { opacity: 1; }
        }
      `}</style>
    </div>
  );
}
