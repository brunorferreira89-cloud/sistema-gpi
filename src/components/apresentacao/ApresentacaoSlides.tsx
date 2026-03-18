import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { X, ChevronLeft, ChevronRight, Loader2, FileText, MessageCircle } from 'lucide-react';
import { formatCurrency } from '@/lib/plano-contas-utils';
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

// TOTAL_SLIDES is now dynamic — see `slideEntries` below

/* ── Design tokens ── */
const C = {
  navy: '#060D1A', mid: '#0A1628', deep: '#0D1B35',
  blue: '#1A3CFF', cyan: '#0099E6', ice: '#38BFFF',
  green: '#00C97A', red: '#FF3B3B', amber: '#F59E0B',
  txt: 'rgba(255,255,255,0.85)', txtSec: 'rgba(255,255,255,0.45)',
  cardBg: 'rgba(255,255,255,0.04)', cardBorder: 'rgba(255,255,255,0.08)',
};

const SLIDE_BG = `radial-gradient(ellipse 120% 80% at 50% 110%,rgba(26,60,255,.10) 0%,transparent 60%),linear-gradient(175deg,${C.navy} 0%,${C.mid} 40%,${C.deep} 70%,${C.navy} 100%)`;

const TYPE_COLORS: Record<string, string> = {
  receita: C.blue, custo_variavel: C.red, despesa_fixa: C.amber,
  investimento: '#7DD3FC', financeiro: C.green,
};
const TYPE_LABELS: Record<string, string> = {
  receita: 'FATURAMENTO', custo_variavel: 'CUSTOS OP.', despesa_fixa: 'DESPESAS FIXAS',
  investimento: 'INVESTIMENTOS', financeiro: 'FINANCIAMENTOS',
};

const fmtR = (v: number) => `R$ ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
const fmtP = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
const statusColor = (s: string) => s === 'verde' || s === 'ok' ? C.green : s === 'ambar' || s === 'atencao' ? C.amber : C.red;
const statusLabel = (s: string) => s === 'verde' || s === 'ok' ? 'OK' : s === 'ambar' || s === 'atencao' ? 'ATENÇÃO' : 'CRÍTICO';

/* ──────────────────────────────────────── */
export default function ApresentacaoSlides({ clienteId, competencia, onExit }: Props) {
  const { user, profile } = useAuth();
  const [slide, setSlide] = useState(1);
  const [entering, setEntering] = useState(true);
  const [flash, setFlash] = useState(false);
  const [apresentacaoId, setApresentacaoId] = useState<string | null>(null);

  const [cliente, setCliente] = useState<any>(null);
  const [contas, setContas] = useState<ContaRow[]>([]);
  const [valMap, setValMap] = useState<Record<string, number | null>>({});
  const [prevValMap, setPrevValMap] = useState<Record<string, number | null>>({});
  const [kpiCalcs, setKpiCalcs] = useState<any[]>([]);
  const [score, setScore] = useState(0);
  const [analises, setAnalises] = useState<any[]>([]);
  const [prepData, setPrepData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [torreMetas, setTorreMetas] = useState<any[]>([]);

  /* ── Data loading ── */
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
      const prevComp = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-01`;
      const pvm: Record<string, number | null> = {};
      (valores || []).filter((v: any) => v.competencia === prevComp).forEach((v: any) => { pvm[v.conta_id] = v.valor_realizado; });
      setPrevValMap(pvm);

      try {
        const inds = await fetchMergedIndicadores(clienteId);
        const calcs = calcularIndicadores(inds, contasData, vm);
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

      // Upsert apresentacao
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

  /* ── Navigation ── */
  const goTo = useCallback((n: number) => {
    if (n < 1 || n > TOTAL_SLIDES || n === slide) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    setEntering(false);
    setTimeout(() => {
      setSlide(n);
      setEntering(true);
    }, 90);
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

  /* ── Computed data ── */
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

  const prevMesShort = useMemo(() => {
    const d = new Date(competencia + 'T00:00:00');
    d.setMonth(d.getMonth() - 1);
    const m = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    return `${m[d.getMonth()]}/${d.getFullYear()}`;
  }, [competencia]);

  const todayFormatted = new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });

  const toggleCard = (key: string) => setExpandedCards(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  /* ── Anim item helper ── */
  const AI = ({ children, i = 0, className = '' }: { children: React.ReactNode; i?: number; className?: string }) => (
    <div className={`anim-item ${className}`} style={entering ? { animation: `slideIn .55s cubic-bezier(.16,1,.3,1) ${i * 0.07}s both` } : { opacity: 1 }}>
      {children}
    </div>
  );

  /* ── Slide header ── */
  const SlideHeader = ({ num, eyebrow, title, right }: { num: number; eyebrow: string; title: string; right?: React.ReactNode }) => (
    <AI i={0} className="flex items-center justify-between px-10 pt-6 pb-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-[2px] h-5 rounded" style={{ background: C.blue }} />
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: C.blue }} />
          <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.cyan, fontFamily: "'JetBrains Mono',monospace" }}>
            Slide {num} · {eyebrow}
          </span>
        </div>
        <h2 className="text-lg font-bold" style={{ color: '#fff' }}>{title}</h2>
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </AI>
  );

  /* ═══════════════════════════ SLIDE 1 — ABERTURA ═══════════════════════════ */
  const renderSlide1 = () => {
    const particles = [
      { text: '+R$12.4k', color: C.green, left: '12%', top: '18%', delay: '0s' },
      { text: 'CMV↑101%', color: C.red, left: '78%', top: '22%', delay: '1.2s' },
      { text: 'GC −0.1%', color: C.amber, left: '85%', top: '65%', delay: '2.4s' },
      { text: 'MC +3.2%', color: C.green, left: '8%', top: '72%', delay: '3.5s' },
      { text: '−R$8.7k', color: C.red, left: '92%', top: '42%', delay: '4.8s' },
      { text: 'RO↑2.1%', color: C.cyan, left: '18%', top: '48%', delay: '6s' },
      { text: '+R$5.9k', color: C.green, left: '65%', top: '78%', delay: '7.2s' },
    ];

    return (
      <div className="h-full relative flex items-center justify-center overflow-hidden">
        {/* Radar rings bottom-left */}
        <svg className="absolute -bottom-40 -left-40 w-[500px] h-[500px] pointer-events-none" style={{ opacity: 0.07 }}>
          <g style={{ animation: 'radarSpin 12s linear infinite', transformOrigin: '250px 250px' }}>
            {[80, 140, 200, 260].map(r => (
              <circle key={r} cx="250" cy="250" r={r} fill="none" stroke="white" strokeWidth="1" />
            ))}
          </g>
        </svg>

        {/* Radar sweep right */}
        <svg className="absolute -right-10 top-1/2 -translate-y-1/2 w-[320px] h-[320px] pointer-events-none" style={{ opacity: 0.07 }}>
          {[60, 100, 140].map(r => (
            <circle key={r} cx="160" cy="160" r={r} fill="none" stroke="white" strokeWidth="0.5" />
          ))}
          <line x1="160" y1="20" x2="160" y2="300" stroke="white" strokeWidth="0.3" />
          <line x1="20" y1="160" x2="300" y2="160" stroke="white" strokeWidth="0.3" />
          <g style={{ animation: 'radarSpin 3s linear infinite', transformOrigin: '160px 160px' }}>
            <line x1="160" y1="160" x2="160" y2="20" stroke="white" strokeWidth="1" opacity="0.6" />
            <path d="M 160 160 L 150 25 A 140 140 0 0 1 160 20 Z" fill="rgba(255,255,255,0.15)" />
          </g>
        </svg>

        {/* Floating particles */}
        {particles.map((p, i) => (
          <span
            key={i}
            className="absolute pointer-events-none"
            style={{
              left: p.left, top: p.top,
              color: p.color, opacity: 0.5,
              fontSize: '11px', fontFamily: "'JetBrains Mono',monospace",
              animation: `floatUp 9s ease-in-out infinite`, animationDelay: p.delay,
            }}
          >
            {p.text}
          </span>
        ))}

        {/* Central content */}
        <div className="relative z-10 flex flex-col items-center gap-5 max-w-[700px]">
          <AI i={0}>
            <div className="inline-flex items-center gap-2 rounded-full px-[14px] py-[6px]"
              style={{ border: '1px solid rgba(26,60,255,.35)', background: 'rgba(26,60,255,.12)' }}>
              <span className="w-2 h-2 rounded-full" style={{ background: C.blue, animation: 'pulse 2s infinite' }} />
              <span className="text-[11px] uppercase tracking-wider" style={{ color: C.ice, fontFamily: "'JetBrains Mono',monospace" }}>
                Relatório de Inteligência Financeira
              </span>
            </div>
          </AI>
          <AI i={1}>
            <h1 className="text-[64px] font-extrabold text-center leading-none text-white">
              {cliente?.razao_social || cliente?.nome_empresa}
            </h1>
          </AI>
          <AI i={2}>
            <p className="text-[15px]" style={{ color: 'rgba(255,255,255,.45)' }}>
              Reunião Mensal / {mesLabelLong}
            </p>
          </AI>
          <AI i={3}>
            <div className="h-px w-[280px] my-1" style={{ background: `linear-gradient(90deg,transparent,${C.blue},${C.cyan},transparent)` }} />
          </AI>
          <AI i={4}>
            <div className="flex items-center gap-0">
              {[
                { label: 'Consultor', value: profile?.nome || 'Consultor GPI' },
                { label: 'Data', value: todayFormatted },
                { label: 'Competência', value: mesShort },
              ].map((m, i) => (
                <div key={i} className="flex flex-col items-center px-5" style={i > 0 ? { borderLeft: '1px solid rgba(255,255,255,.12)' } : {}}>
                  <span className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(255,255,255,.35)', fontFamily: "'JetBrains Mono',monospace" }}>{m.label}</span>
                  <span className="text-[13px] mt-0.5" style={{ color: 'rgba(255,255,255,.75)', fontFamily: "'JetBrains Mono',monospace" }}>{m.value}</span>
                </div>
              ))}
            </div>
          </AI>
        </div>
      </div>
    );
  };

  /* ═══════════════════════════ SLIDE 2 — NÚMEROS & SAÚDE ═══════════════════════════ */
  const renderSlide2 = () => {
    const kpisAtivos = kpiCalcs.filter(k => k.indicador.ativo);
    const scoreC = score >= 70 ? C.green : score >= 40 ? C.amber : C.red;
    const scoreL = score >= 70 ? 'Saudável' : score >= 40 ? 'Atenção' : 'Crítico';

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <SlideHeader num={2} eyebrow="Visão Geral" title="Números & Saúde Financeira"
          right={
            <div className="flex items-center gap-3">
              <span className="text-[14px]" style={{ color: 'rgba(26,60,255,.6)', fontFamily: "'JetBrains Mono',monospace" }}>{mesShort}</span>
              <span className="text-[10px]" style={{ color: 'rgba(255,255,255,.28)' }}>{cliente?.razao_social || cliente?.nome_empresa}</span>
            </div>
          }
        />

        <div className="flex-1 overflow-auto px-10 pb-6 space-y-5">
          {/* Section title */}
          <AI i={1}>
            <p className="text-[11px] uppercase tracking-widest" style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>Resultados do mês</p>
          </AI>

          {/* 5 DRE cards */}
          <div className="grid grid-cols-5 gap-3">
            {groupData.map((g, i) => {
              const expanded = expandedCards.has(g.tipo);
              const maxCatVal = Math.max(...g.subgrupos.flatMap(sg => sg.categorias.map(c => Math.abs(c.valor))), 1);
              return (
                <AI key={g.tipo} i={i + 2}>
                  <div
                    className="rounded-xl cursor-pointer transition-all hover:scale-[1.01]"
                    style={{ background: C.cardBg, border: `1px solid ${C.cardBorder}` }}
                    onClick={() => toggleCard(g.tipo)}
                  >
                    <div className="h-1 rounded-t-xl" style={{ background: g.color }} />
                    <div className="p-4">
                      <span className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>{g.label}</span>
                      <span className="text-[24px] font-extrabold block" style={{ color: '#fff', fontFamily: "'JetBrains Mono',monospace" }}>{fmtR(g.val)}</span>
                      <span className="text-[11px] block mt-0.5" style={{ color: C.txtSec }}>AV {g.avPct.toFixed(1)}%</span>
                      {g.varPct !== 0 && (
                        <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-bold rounded-full px-2 py-0.5"
                          style={{ color: g.varPct >= 0 ? C.green : C.red, background: g.varPct >= 0 ? 'rgba(0,201,122,.1)' : 'rgba(255,59,59,.1)' }}>
                          {g.varPct >= 0 ? '▲' : '▼'} {Math.abs(g.varPct).toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {expanded && (
                      <div className="px-4 pb-4 border-t" style={{ borderColor: C.cardBorder }}>
                        {g.val === 0 && g.tipo === 'financeiro' ? (
                          <div className="flex items-center gap-2 py-3">
                            <span className="text-sm">✓</span>
                            <span className="text-[11px]" style={{ color: C.green }}>Nenhuma dívida ou financiamento ativo</span>
                          </div>
                        ) : (
                          g.subgrupos.map(sg => (
                            <div key={sg.nome} className="mt-2">
                              <div className="flex justify-between text-[10px] mb-1">
                                <span className="truncate flex-1" style={{ color: C.txtSec }}>{sg.nome}</span>
                                <span className="ml-2" style={{ color: C.txt, fontFamily: "'JetBrains Mono',monospace" }}>{fmtR(sg.valor)}</span>
                              </div>
                              <div className="h-px mb-1" style={{ background: C.cardBorder }} />
                              {sg.categorias.slice(0, 5).map(cat => {
                                const pctBar = maxCatVal ? (Math.abs(cat.valor) / maxCatVal) * 100 : 0;
                                return (
                                  <div key={cat.nome} className="flex items-center gap-1.5 mb-0.5">
                                    <span className="text-[9px] w-[80px] truncate" style={{ color: C.txtSec }}>{cat.nome}</span>
                                    <div className="flex-1 h-[3px] rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                                      <div className="h-full rounded-full transition-all duration-[800ms]" style={{ width: entering ? `${Math.min(pctBar, 100)}%` : '0%', background: g.color }} />
                                    </div>
                                    <span className="text-[9px] w-[55px] text-right" style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>{fmtR(cat.valor)}</span>
                                    <span className="text-[8px] w-[32px] text-right" style={{ color: C.txtSec }}>{fat ? (Math.abs(cat.valor) / Math.abs(fat) * 100).toFixed(1) : '0'}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </AI>
              );
            })}
          </div>

          {/* Semáforo */}
          <AI i={8}>
            <div className="rounded-xl p-5" style={{ background: C.cardBg, border: `1px solid ${C.cardBorder}` }}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs font-bold tracking-wider" style={{ color: C.txt, fontFamily: "'JetBrains Mono',monospace" }}>Semáforo de saúde financeira</span>
                <span className="text-sm font-bold px-2.5 py-0.5 rounded" style={{ color: scoreC, background: `${scoreC}1A`, fontFamily: "'JetBrains Mono',monospace" }}>
                  {score}/100
                </span>
              </div>
              <div className="flex gap-3 flex-wrap">
                {kpisAtivos.slice(0, 7).map((k, i) => {
                  const c = statusColor(k.status);
                  const lbl = statusLabel(k.status);
                  return (
                    <div key={i} className="flex flex-col items-center gap-1 min-w-[100px] rounded-lg p-3"
                      style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.cardBorder}` }}>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                        style={{ border: `2px solid ${c}`, color: c, fontFamily: "'JetBrains Mono',monospace" }}>
                        {k.pct?.toFixed(0) ?? '—'}%
                      </div>
                      <span className="text-[10px] text-center leading-tight mt-1" style={{ color: C.txt }}>{k.indicador.nome}</span>
                      <span className="text-[8px] italic" style={{ color: C.txtSec }}>ref. GPI</span>
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full" style={{ color: c, background: `${c}18` }}>{lbl}</span>
                    </div>
                  );
                })}
              </div>
              {score < 70 && (
                <div className="mt-4 rounded-lg p-3 flex items-start gap-2"
                  style={{ background: 'rgba(255,59,59,.08)', border: '1px solid rgba(255,59,59,.2)' }}>
                  <span className="text-base">⚠️</span>
                  <p className="text-[11px] leading-relaxed" style={{ color: 'rgba(255,255,255,.6)' }}>
                    A saúde financeira está abaixo do nível saudável. Recomenda-se atenção aos indicadores em vermelho e revisão das despesas operacionais.
                  </p>
                </div>
              )}
            </div>
          </AI>
        </div>
      </div>
    );
  };

  /* ═══════════════════════════ SLIDE 3 — O QUE ACONTECEU ═══════════════════════════ */
  const renderSlide3 = () => {
    const indicators = ['Faturamento', 'Custos Operacionais', 'Margem de Contribuição', 'Despesas Fixas', 'Geração de Caixa'];
    const icons: Record<string, string> = { 'Faturamento': '📈', 'Custos Operacionais': '💰', 'Margem de Contribuição': '📊', 'Despesas Fixas': '🏢', 'Geração de Caixa': '🎯' };
    const colors: Record<string, string> = { 'Faturamento': C.blue, 'Custos Operacionais': C.red, 'Margem de Contribuição': C.cyan, 'Despesas Fixas': C.amber, 'Geração de Caixa': C.green };

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <SlideHeader num={3} eyebrow="Aprofundamento" title="O que aconteceu"
          right={
            <div className="flex flex-col items-end">
              <span className="text-[12px]" style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>{mesShort} vs {prevMesShort}</span>
              <span className="text-[10px]" style={{ color: 'rgba(255,255,255,.28)' }}>▶ clique para detalhar</span>
            </div>
          }
        />
        <div className="flex-1 overflow-auto px-10 pb-6 space-y-3">
          {indicators.map((indName, i) => {
            const an = analises.find((a: any) => a.indicador === indName);
            const expanded = expandedCards.has(`s3-${indName}`);
            let val = 0;
            if (indName === 'Faturamento') val = fat;
            else if (indName === 'Custos Operacionais') val = groupData.find(g => g.tipo === 'custo_variavel')?.val || 0;
            else if (indName === 'Despesas Fixas') val = groupData.find(g => g.tipo === 'despesa_fixa')?.val || 0;
            else if (indName === 'Margem de Contribuição') val = totalizadores.mc;
            else if (indName === 'Geração de Caixa') val = totalizadores.gc;

            const prevVal = indName === 'Faturamento' ? prevFat
              : indName === 'Custos Operacionais' ? (groupData.find(g => g.tipo === 'custo_variavel')?.prevVal || 0)
              : 0;
            const delta = prevVal ? ((val - prevVal) / Math.abs(prevVal)) * 100 : 0;
            const accentColor = colors[indName] || C.blue;

            return (
              <AI key={indName} i={i + 1}>
                <div
                  className="rounded-xl cursor-pointer transition-all hover:scale-[1.002] overflow-hidden"
                  style={{ background: C.cardBg, border: `1px solid ${C.cardBorder}` }}
                  onClick={() => toggleCard(`s3-${indName}`)}
                >
                  <div className="flex items-center">
                    <div className="w-1 self-stretch rounded-l-xl" style={{ background: accentColor }} />
                    <div className="flex-1 flex items-center gap-3 p-4">
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full"
                        style={{ background: `${accentColor}1A`, color: accentColor, fontFamily: "'JetBrains Mono',monospace" }}>
                        {icons[indName]} {indName}
                      </span>
                      <span className="flex-1 text-[13px] font-medium truncate" style={{ color: C.txt }}>
                        {an?.titulo || 'Análise pendente'}
                      </span>
                      <span className="text-[13px] font-bold" style={{ color: C.txt, fontFamily: "'JetBrains Mono',monospace" }}>{fmtR(val)}</span>
                      {delta !== 0 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ color: delta >= 0 ? C.green : C.red, background: delta >= 0 ? 'rgba(0,201,122,.1)' : 'rgba(255,59,59,.1)' }}>
                          {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
                        </span>
                      )}
                      <ChevronRight className="h-4 w-4 transition-transform" style={{ color: C.txtSec, transform: expanded ? 'rotate(90deg)' : 'none' }} />
                    </div>
                  </div>
                  {expanded && an && (
                    <div className="px-6 pb-4 pt-1 grid grid-cols-2 gap-x-8 gap-y-2 border-t" style={{ borderColor: C.cardBorder }}>
                      {[
                        { label: 'Por que importa', text: an.titulo },
                        { label: 'O que pode ter acontecido', text: an.analise },
                        { label: 'Impacto na GC', text: `Variação de ${fmtP(delta)} impacta diretamente a geração de caixa` },
                        { label: 'Sugestão', text: an.acao },
                      ].map((sec, j) => (
                        <div key={j} className="py-2">
                          <span className="text-[9px] font-bold uppercase tracking-wider block mb-1" style={{ color: C.cyan }}>{sec.label}</span>
                          <p className="text-[11px] leading-relaxed" style={{ color: C.txtSec }}>{sec.text || '—'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                  {expanded && !an && (
                    <div className="px-6 pb-4 border-t" style={{ borderColor: C.cardBorder }}>
                      <p className="text-[11px] py-2" style={{ color: C.txtSec }}>Análise IA não gerada para este indicador.</p>
                    </div>
                  )}
                </div>
              </AI>
            );
          })}
        </div>
      </div>
    );
  };

  /* ═══════════════════════════ SLIDE 4 — ANÁLISE CONSULTIVA ═══════════════════════════ */
  const renderSlide4 = () => {
    const campos = [
      { key: 'diagnostico', icon: '🔍', label: 'O que os números dizem' },
      { key: 'objetivos', icon: '🎯', label: 'O que queremos alcançar' },
      { key: 'riscos', icon: '⚡', label: 'Riscos se não agirmos agora' },
      { key: 'proximos_passos', icon: '✅', label: 'O que fazer esta semana' },
    ];

    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header strip */}
        <div className="px-10 py-3" style={{ background: 'rgba(26,60,255,.12)', borderBottom: '1px solid rgba(26,60,255,.2)' }}>
          <AI i={0}>
            <div className="flex items-center gap-3">
              <span className="text-xl">🧠</span>
              <div>
                <span className="text-[11px] tracking-[0.2em] uppercase block" style={{ color: C.cyan, fontFamily: "'JetBrains Mono',monospace" }}>Slide 4 · Análise</span>
                <span className="text-xs" style={{ color: C.txtSec }}>
                  {cliente?.razao_social || cliente?.nome_empresa} · {mesShort} · Análise com base nos 9 indicadores DRE
                </span>
              </div>
              {prepData?.editado_em && (
                <span className="ml-auto text-[9px] font-bold px-2 py-1 rounded" style={{ background: 'rgba(0,201,122,.12)', color: C.green }}>
                  ✓ Revisado · {new Date(prepData.editado_em).toLocaleDateString('pt-BR')}
                </span>
              )}
            </div>
          </AI>
        </div>

        <div className="flex-1 overflow-auto px-10 py-5 space-y-3">
          <AI i={1}>
            <h2 className="text-lg font-bold mb-1" style={{ color: '#fff' }}>Análise Consultiva</h2>
          </AI>

          {campos.map((c, i) => {
            const val = prepData?.[c.key] || '';
            const expanded = expandedCards.has(`s4-${c.key}`);
            const metricsForBlock = [
              { label: 'Faturamento', value: fmtR(fat) },
              { label: 'Custos %', value: `${groupData[1]?.avPct.toFixed(1)}%` },
              { label: 'MC %', value: fat ? `${(totalizadores.mc / Math.abs(fat) * 100).toFixed(1)}%` : '—' },
            ];

            return (
              <AI key={c.key} i={i + 2}>
                <div
                  className="rounded-xl overflow-hidden cursor-pointer transition-all hover:scale-[1.002]"
                  style={{ background: C.cardBg, border: `1px solid ${C.cardBorder}` }}
                  onClick={() => toggleCard(`s4-${c.key}`)}
                >
                  <div className="flex">
                    <div className="w-[3px] self-stretch" style={{ background: C.blue }} />
                    <div className="flex-1 p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-base">{c.icon}</span>
                        <span className="text-xs font-bold" style={{ color: C.txt }}>{c.label}</span>
                        <ChevronRight className="h-3.5 w-3.5 ml-auto transition-transform" style={{ color: C.txtSec, transform: expanded ? 'rotate(90deg)' : 'none' }} />
                      </div>
                      <p className={`text-[12px] leading-[1.7] whitespace-pre-wrap ${!expanded ? 'line-clamp-3' : ''}`} style={{ color: C.txtSec }}>
                        {val || 'Conteúdo não gerado'}
                      </p>
                    </div>
                  </div>
                  {expanded && (
                    <div className="px-5 pb-4 border-t flex gap-3" style={{ borderColor: C.cardBorder }}>
                      {metricsForBlock.map((m, j) => (
                        <div key={j} className="flex-1 rounded-lg p-2.5 mt-2" style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.cardBorder}` }}>
                          <span className="text-[9px] uppercase tracking-wider block" style={{ color: C.txtSec }}>{m.label}</span>
                          <span className="text-sm font-bold" style={{ color: C.txt, fontFamily: "'JetBrains Mono',monospace" }}>{m.value}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </AI>
            );
          })}
        </div>
      </div>
    );
  };

  /* ═══════════════════════════ SLIDE 5 — TORRE AO VIVO ═══════════════════════════ */
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
      return { tipo, label: TYPE_LABELS[tipo], color: TYPE_COLORS[tipo], realizado, meta: hasMeta ? metaTotal : null, status };
    });

    const statusIcon = (s: string) => s === 'ok' ? '✅' : s === 'critico' ? '❌' : s === 'atencao' ? '⚠️' : '—';
    const statusBg = (s: string) => s === 'ok' ? 'rgba(0,201,122,0.04)' : s === 'critico' ? 'rgba(255,59,59,0.04)' : 'transparent';

    return (
      <div className="h-full flex flex-col overflow-hidden">
        <SlideHeader num={5} eyebrow="Metas" title="Torre de Controle ao Vivo" />

        <div className="flex-1 overflow-auto px-10 pb-6 space-y-4">
          <AI i={1}>
            <div className="flex gap-5">
              {[
                { icon: '✅', label: 'Atingiu meta', color: C.green },
                { icon: '❌', label: 'Abaixo da meta', color: C.red },
                { icon: '—', label: 'Sem meta', color: C.txtSec },
              ].map(l => (
                <span key={l.label} className="flex items-center gap-1.5 text-[10px]" style={{ color: l.color, fontFamily: "'JetBrains Mono',monospace" }}>
                  {l.icon} {l.label}
                </span>
              ))}
            </div>
          </AI>

          <AI i={2}>
            <div className="rounded-xl overflow-hidden" style={{ background: C.cardBg, border: `1px solid ${C.cardBorder}` }}>
              <table className="w-full text-xs" style={{ fontFamily: "'JetBrains Mono',monospace" }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <th className="text-left p-4 font-bold tracking-wider" style={{ color: C.txtSec }}>CONTA DRE</th>
                    <th className="text-right p-4 font-bold tracking-wider" style={{ color: C.txtSec }}>{mesShort} REALIZADO</th>
                    <th className="text-right p-4 font-bold tracking-wider" style={{ color: C.blue }}>META</th>
                    <th className="text-center p-4 font-bold tracking-wider" style={{ color: C.txtSec }}>STATUS</th>
                  </tr>
                </thead>
                <tbody>
                  {torreRows.map((r, i) => (
                    <tr key={r.tipo} style={{ borderTop: `1px solid ${C.cardBorder}`, background: statusBg(r.status) }}>
                      <td className="p-4 font-bold flex items-center gap-2" style={{ color: C.txt }}>
                        <div className="w-2 h-2 rounded-full" style={{ background: r.color }} />
                        {r.label}
                      </td>
                      <td className="p-4 text-right" style={{ color: C.txt }}>{fmtR(r.realizado)}</td>
                      <td className="p-4 text-right" style={{ color: r.meta !== null ? C.blue : C.txtSec }}>{r.meta !== null ? fmtR(r.meta) : '—'}</td>
                      <td className="p-4 text-center text-sm">{statusIcon(r.status)}</td>
                    </tr>
                  ))}
                  {/* Totalizadores */}
                  {[
                    { label: '= MARGEM DE CONTRIBUIÇÃO', val: totalizadores.mc },
                    { label: '= RESULTADO OPERACIONAL', val: totalizadores.ro },
                    { label: '= GERAÇÃO DE CAIXA', val: totalizadores.gc },
                  ].map((t, i) => (
                    <tr key={t.label} style={{ borderTop: `1px solid ${C.cardBorder}`, background: 'rgba(13,27,53,0.5)' }}>
                      <td className="p-4 font-bold" style={{ color: '#fff' }}>{t.label}</td>
                      <td className="p-4 text-right font-bold" style={{ color: t.val >= 0 ? C.green : C.red }}>{fmtR(t.val)}</td>
                      <td className="p-4 text-right" style={{ color: C.txtSec }}>—</td>
                      <td className="p-4" />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AI>
        </div>
      </div>
    );
  };

  /* ═══════════════════════════ SLIDE 6 — PLANO DE VOO ═══════════════════════════ */
  const renderSlide6 = () => {
    const gcAtual = totalizadores.gc;
    const gcAtualPct = fat ? (gcAtual / Math.abs(fat)) * 100 : 0;
    const gcColor = gcAtualPct >= 10 ? C.green : gcAtualPct >= 0 ? C.amber : C.red;
    const checkpoints = prepData?.checkpoints_json as Record<string, string> | null;

    const cpData = [
      { n: 1, ...torreGroups[0], cpKey: 'faturamento', cx: 280, cy: 200 },
      { n: 2, ...torreGroups[1], cpKey: 'custos', cx: 530, cy: 155 },
      { n: 3, ...torreGroups[2], cpKey: 'despesas', cx: 780, cy: 155 },
      { n: 4, ...torreGroups[3], cpKey: 'investimentos', cx: 1000, cy: 160 },
    ];

    const pathD = "M 80,310 C 160,310 190,260 280,200 S 430,160 530,155 S 680,155 780,155 S 900,145 1000,160 S 1080,130 1110,100";

    return (
      <div className="h-full flex flex-col relative overflow-hidden">
        {/* Green horizon */}
        <div className="absolute bottom-0 left-0 right-0 h-32 pointer-events-none" style={{ background: 'linear-gradient(to top, rgba(0,201,122,0.04), transparent)' }} />

        {/* Mini header */}
        <div className="flex items-center justify-between px-10 pt-5 pb-2 z-10">
          <AI i={0}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="w-[2px] h-4 rounded" style={{ background: C.green }} />
                <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.green, fontFamily: "'JetBrains Mono',monospace" }}>Slide 6 · Plano de Voo</span>
              </div>
              <h2 className="text-lg font-bold">
                <span style={{ color: '#fff' }}>Rota para </span>
                <span style={{ background: `linear-gradient(135deg,${C.green},${C.cyan})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontStyle: 'italic' }}>
                  {nextCompLabel}
                </span>
              </h2>
            </div>
          </AI>
          <AI i={1}>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'rgba(0,201,122,.08)', border: '1px solid rgba(0,201,122,.25)', animation: 'glowPulse 3s ease-in-out infinite' }}>
              <span className="text-[8px] font-bold tracking-widest uppercase" style={{ color: C.green, fontFamily: "'JetBrains Mono',monospace" }}>ALTITUDE ALVO</span>
              <span className="text-xs font-bold" style={{ color: C.green, fontFamily: "'JetBrains Mono',monospace" }}>GC ≥ {gcProjetadoPct >= 0 ? '+' : ''}{gcProjetadoPct.toFixed(1)}%</span>
              <span className="text-[10px]" style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>{fmtR(gcProjetado)}</span>
            </div>
          </AI>
        </div>

        {/* Flight map area */}
        <div className="flex-1 relative mx-10 mb-0" style={{ minHeight: 340 }}>
          {/* CP cards above the SVG */}
          {cpData.map((cp, i) => {
            const varColor = cp.isReceita ? (cp.varPct >= 0 ? C.green : C.red) : (cp.varPct <= 0 ? C.green : C.red);
            const msg = checkpoints?.[cp.cpKey] || (cp.hasMeta ? 'Meta definida' : 'Sem meta definida');
            return (
              <AI key={cp.n} i={i + 2}>
                <div className="absolute top-0 w-[175px] rounded-xl p-2.5 z-10"
                  style={{ left: `${(cp.cx / 1200) * 100}%`, transform: 'translateX(-50%)', background: C.cardBg, border: `1px solid ${C.cardBorder}` }}>
                  <div className="text-[8px] font-bold px-1.5 py-0.5 rounded inline-block mb-1"
                    style={{ border: `1px solid ${cp.color}`, color: cp.color, fontFamily: "'JetBrains Mono',monospace" }}>
                    CP-{cp.n} · {cp.label}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] mb-1" style={{ fontFamily: "'JetBrains Mono',monospace" }}>
                    <span style={{ color: C.txtSec }}>{fmtR(cp.realizado)}</span>
                    <span style={{ color: C.txtSec }}>→</span>
                    <span style={{ color: cp.color }}>{cp.metaTotal !== null ? fmtR(cp.metaTotal) : '—'}</span>
                    {cp.hasMeta && <span className="text-[9px] px-1 rounded" style={{ background: `${varColor}22`, color: varColor }}>{fmtP(cp.varPct)}</span>}
                  </div>
                  <div className="text-[9px] leading-[1.4] pl-2" style={{ color: 'rgba(255,255,255,.4)', borderLeft: `2px solid ${cp.color}` }}>{msg}</div>
                </div>
              </AI>
            );
          })}

          {/* Destination card */}
          <AI i={7}>
            <div className="absolute top-0 right-0 w-[160px] rounded-xl p-3 z-10"
              style={{ background: 'rgba(0,201,122,.06)', border: '1px solid rgba(0,201,122,.25)' }}>
              <span className="text-[10px] font-bold block mb-1" style={{ color: C.green }}>🎯 DESTINO</span>
              <span className="text-lg font-bold block" style={{ color: C.green, fontFamily: "'JetBrains Mono',monospace" }}>
                GC {gcProjetadoPct >= 0 ? '+' : ''}{gcProjetadoPct.toFixed(1)}%
              </span>
              <span className="text-[10px] block" style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>{fmtR(gcProjetado)}</span>
              <span className="text-[9px]" style={{ color: C.txtSec }}>{nextCompLabel}</span>
            </div>
          </AI>

          {/* SVG Flight route */}
          <svg viewBox="0 0 1200 420" className="absolute bottom-0 left-0 w-full" style={{ height: 260 }} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="pathGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor={C.red} />
                <stop offset="50%" stopColor={C.amber} />
                <stop offset="100%" stopColor={C.green} />
              </linearGradient>
            </defs>
            {/* Altitude lines */}
            {[130, 220, 310].map((y, i) => (
              <g key={y}>
                <line x1="40" y1={y} x2="1160" y2={y} stroke="rgba(255,255,255,.04)" strokeDasharray="4 8" />
                <text x="15" y={y + 3} fill="rgba(255,255,255,.15)" fontSize="8" fontFamily="'JetBrains Mono',monospace">
                  {['ALT+3', 'ALT±0', 'ALT−3'][i]}
                </text>
              </g>
            ))}
            {/* Shadow path */}
            <path d={pathD} fill="none" stroke="rgba(0,201,122,.08)" strokeWidth="12" strokeLinecap="round" />
            {/* Main dashed path */}
            <path d={pathD} fill="none" stroke="url(#pathGrad)" strokeWidth="2.5" strokeDasharray="8 4">
              <animate attributeName="stroke-dashoffset" values="24;0" dur="1.5s" repeatCount="indefinite" />
            </path>
            {/* Start point */}
            <circle cx="80" cy="310" r="14" fill="rgba(255,59,59,0.1)" stroke={C.red} strokeWidth="1">
              <animate attributeName="r" values="12;16;12" dur="2s" repeatCount="indefinite" />
            </circle>
            <circle cx="80" cy="310" r="4" fill={C.red} />
            <text x="80" y="340" textAnchor="middle" fill={gcColor} fontSize="8" fontFamily="'JetBrains Mono',monospace" fontWeight="bold">PARTIDA</text>
            <text x="80" y="352" textAnchor="middle" fill={C.txtSec} fontSize="8" fontFamily="'JetBrains Mono',monospace">{mesShort}</text>
            <text x="80" y="364" textAnchor="middle" fill={gcColor} fontSize="9" fontFamily="'JetBrains Mono',monospace" fontWeight="bold">GC {gcAtualPct.toFixed(1)}%</text>
            {/* CP nodes */}
            {cpData.map(cp => (
              <g key={cp.n}>
                <circle cx={cp.cx} cy={cp.cy} r="12" fill={`${cp.color}1A`} stroke={`${cp.color}66`} strokeWidth="1.5" />
                <circle cx={cp.cx} cy={cp.cy} r="5" fill={cp.color} />
                <line x1={cp.cx} y1={cp.cy - 12} x2={cp.cx} y2={cp.cy - 55} stroke={`${cp.color}40`} strokeDasharray="3 3" />
                <text x={cp.cx} y={cp.cy + 25} textAnchor="middle" fill={cp.color} fontSize="8" fontFamily="'JetBrains Mono',monospace">CP-{cp.n}</text>
              </g>
            ))}
            {/* Destination zone */}
            {[28, 20, 12].map((r, i) => (
              <circle key={r} cx="1110" cy="100" r={r} fill="none" stroke={`rgba(0,201,122,${0.08 + i * 0.06})`} strokeWidth="1">
                {i === 0 && <animate attributeName="r" values="26;30;26" dur="3s" repeatCount="indefinite" />}
              </circle>
            ))}
            <circle cx="1110" cy="100" r="6" fill={C.green}>
              <animate attributeName="opacity" values="0.8;1;0.8" dur="2s" repeatCount="indefinite" />
            </circle>
            <text x="1110" y="145" textAnchor="middle" fill={C.green} fontSize="8" fontFamily="'JetBrains Mono',monospace" fontWeight="bold">DESTINO</text>
            <text x="1110" y="158" textAnchor="middle" fill={C.txtSec} fontSize="8" fontFamily="'JetBrains Mono',monospace">{nextCompLabel}</text>
            <text x="1110" y="170" textAnchor="middle" fill={C.green} fontSize="9" fontFamily="'JetBrains Mono',monospace" fontWeight="bold">GC ≥{gcProjetadoPct >= 0 ? '+' : ''}{gcProjetadoPct.toFixed(1)}%</text>
            {/* Airplane */}
            <text fontSize="18" fill={C.blue} style={{ filter: `drop-shadow(0 0 6px ${C.blue})` }}>
              <animateMotion dur="8s" repeatCount="indefinite" rotate="auto" path={pathD} />
              ✈
            </text>
          </svg>
        </div>

        {/* Footer */}
        <AI i={8}>
          <div className="flex items-center justify-between px-10 pb-4 z-10">
            <div className="flex items-center gap-2 flex-wrap text-[10px]" style={{ fontFamily: "'JetBrains Mono',monospace" }}>
              <span style={{ color: '#7CB8FF' }}>{fmtR(torreGroups[0].metaTotal ?? fat)}</span>
              <span style={{ color: C.txtSec }}>−</span>
              <span style={{ color: '#FF8989' }}>{fmtR(Math.abs(torreGroups[1].metaTotal ?? torreGroups[1].realizado))}</span>
              <span style={{ color: C.txtSec }}>−</span>
              <span style={{ color: '#FCD34D' }}>{fmtR(Math.abs(torreGroups[2].metaTotal ?? torreGroups[2].realizado))}</span>
              <span style={{ color: C.txtSec }}>−</span>
              <span style={{ color: '#7DD3FC' }}>{fmtR(Math.abs(torreGroups[3].metaTotal ?? torreGroups[3].realizado))}</span>
              <span style={{ color: C.txtSec }}>=</span>
              <span style={{ color: C.green, fontWeight: 'bold' }}>{fmtR(gcProjetado)} · GC {gcProjetadoPct >= 0 ? '+' : ''}{gcProjetadoPct.toFixed(1)}%</span>
              <span className="ml-3 flex items-center gap-1" style={{ color: 'rgba(255,255,255,.3)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.amber, animation: 'pulse 2s infinite' }} />
                🔔 Estas metas alimentam alertas semanais automáticos
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={handleGeneratePDF} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors hover:bg-white/10"
                style={{ color: C.txtSec, border: `1px solid ${C.cardBorder}`, fontFamily: "'JetBrains Mono',monospace" }}>
                <FileText className="h-3.5 w-3.5" /> 📄 Gerar PDF
              </button>
              <button onClick={handleWhatsApp} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-medium transition-colors hover:bg-white/10"
                style={{ color: C.txtSec, border: `1px solid ${C.cardBorder}`, fontFamily: "'JetBrains Mono',monospace" }}>
                <MessageCircle className="h-3.5 w-3.5" /> 💬 Enviar por WhatsApp
              </button>
            </div>
          </div>
        </AI>
      </div>
    );
  };

  /* ── PDF Generation ── */
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

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: SLIDE_BG }}>
        <Loader2 className="h-10 w-10 animate-spin" style={{ color: C.blue }} />
      </div>
    );
  }

  const slides = [renderSlide1, renderSlide2, renderSlide3, renderSlide4, renderSlide5, renderSlide6];

  return (
    <div className="fixed inset-0 z-[9999]" style={{ background: SLIDE_BG, fontFamily: "'JetBrains Mono', 'DM Sans', monospace" }}>
      {/* SCANLINES */}
      <div className="fixed inset-0 pointer-events-none z-[1]" style={{
        background: 'repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,.08) 2px,rgba(0,0,0,.08) 4px)',
      }} />

      {/* HUD GRID */}
      <div className="fixed inset-0 pointer-events-none z-0" style={{
        backgroundImage: 'linear-gradient(rgba(26,60,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(26,60,255,.04) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        animation: 'gridShift 20s linear infinite',
      }} />

      {/* FLASH TRANSITION */}
      {flash && (
        <div className="fixed inset-0 z-[10001] pointer-events-none" style={{
          background: `linear-gradient(135deg, ${C.blue}, ${C.cyan})`,
          animation: 'flashTrans 180ms ease forwards',
        }} />
      )}

      {/* EXIT BUTTON */}
      <button onClick={onExit} className="fixed top-4 right-4 z-[10002] p-2 rounded-lg transition-all hover:bg-white/10" style={{ color: C.txtSec }}>
        <X className="h-5 w-5" />
      </button>

      {/* SLIDE CONTENT */}
      <div className="absolute inset-0 pb-[58px] z-[2]">
        {slides.map((renderFn, i) => (
          <div
            key={i}
            className="absolute inset-0"
            style={{
              opacity: i + 1 === slide ? 1 : 0,
              pointerEvents: i + 1 === slide ? 'all' : 'none',
              transition: 'opacity 0.15s ease',
              paddingBottom: '58px',
            }}
          >
            {i + 1 === slide && renderFn()}
          </div>
        ))}
      </div>

      {/* NAV BAR */}
      <div className="fixed bottom-0 left-0 right-0 h-[58px] flex items-center justify-center gap-4 z-[10002]"
        style={{ background: 'rgba(6,13,26,0.88)', backdropFilter: 'blur(12px)', borderTop: '1px solid rgba(26,60,255,.15)' }}>
        <button onClick={() => goTo(slide - 1)} disabled={slide === 1}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-[11px] disabled:opacity-30 transition-colors hover:bg-white/8"
          style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>
          <ChevronLeft className="h-3.5 w-3.5" /> Anterior
        </button>

        <div className="flex gap-2 items-center">
          {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
            <button key={i} onClick={() => goTo(i + 1)} className="w-2.5 h-2.5 rounded-full transition-all"
              style={{
                background: i + 1 === slide ? C.blue : 'rgba(255,255,255,0.2)',
                boxShadow: i + 1 === slide ? `0 0 8px ${C.blue}` : 'none',
                transform: i + 1 === slide ? 'scale(1.3)' : 'scale(1)',
              }} />
          ))}
        </div>

        <span className="text-[10px] mx-2" style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>{slide} / {TOTAL_SLIDES}</span>

        <button onClick={() => goTo(slide + 1)} disabled={slide === TOTAL_SLIDES}
          className="flex items-center gap-1 px-3 py-1.5 rounded text-[11px] disabled:opacity-30 transition-colors hover:bg-white/8"
          style={{ color: C.txtSec, fontFamily: "'JetBrains Mono',monospace" }}>
          Próximo <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* KEYFRAMES */}
      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes flashTrans {
          0% { opacity: 0; }
          40% { opacity: 0.18; }
          100% { opacity: 0; }
        }
        @keyframes gridShift {
          from { background-position: 0 0; }
          to { background-position: 60px 60px; }
        }
        @keyframes radarSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes floatUp {
          0%, 100% { transform: translateY(0); opacity: 0.4; }
          50% { transform: translateY(-30px); opacity: 0.6; }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes glowPulse {
          0%, 100% { box-shadow: 0 0 8px rgba(0,201,122,0.15); }
          50% { box-shadow: 0 0 16px rgba(0,201,122,0.3); }
        }
      `}</style>
    </div>
  );
}
