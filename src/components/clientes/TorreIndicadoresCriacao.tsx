import { useState, useMemo } from 'react';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { type TorreMeta, calcProjetado, fmtCompetencia } from '@/lib/torre-utils';
import { TorreIndicadorModal } from './TorreIndicadorModal';

// ── Types ─────────────────────────────────────────────────────
interface Cliente {
  id: string;
  nome_empresa: string;
  razao_social?: string | null;
  segmento: string;
  faturamento_faixa: string;
}

interface ValorMensal {
  conta_id: string;
  competencia: string;
  valor_realizado: number | null;
}

interface Props {
  cliente: Cliente;
  competencia: string;        // mês selecionado (base realizado)
  mesProximo: string;          // mês alvo das metas
  valoresMensais: ValorMensal[];
  torreMetas: TorreMeta[];
  planoDeContas: ContaRow[];
}

// ── Colors ────────────────────────────────────────────────────
const C = {
  primary: '#1A3CFF', cyan: '#0099E6', green: '#00A86B', greenLo: 'rgba(0,168,107,0.08)', greenBd: 'rgba(0,168,107,0.28)',
  amber: '#D97706', red: '#DC2626',
  canvas: '#FAFCFF', bg: '#F0F4FA', bgAlt: '#E8EEF8', surface: '#FFFFFF',
  border: '#DDE4F0', borderStr: '#C4CFEA',
  txt: '#0D1B35', txtSec: '#4A5E80', txtMuted: '#8A9BBC',
  mono: "'Courier New', monospace",
};

const fmtR = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const fmtRColor = (v: number) => <span style={{ fontFamily: C.mono, fontWeight: 700, color: v < 0 ? C.red : C.green }}>{fmtR(v)}</span>;

// ── Keyframes ─────────────────────────────────────────────────
const keyframesCSS = `
@keyframes commanderFloat {
  0%, 100% { transform: translateY(0) rotate(-1deg); box-shadow: 0 0 12px rgba(0,153,230,0.14); }
  50% { transform: translateY(-6px) rotate(3deg); box-shadow: 0 0 20px rgba(0,153,230,0.30); }
}
@keyframes radarSweepInst { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
@keyframes blipPulse { 0%, 100% { opacity: 0.4; r: 3; } 50% { opacity: 1; r: 5; } }
@keyframes pulseGreen { 0%, 100% { opacity: 0.6; } 50% { opacity: 1; } }
`;

// ── Tree builder (local) ──────────────────────────────────────
interface DreNode { conta: ContaRow; children: DreNode[] }

function buildTree(contas: ContaRow[]): DreNode[] {
  const map = new Map<string, DreNode>();
  const roots: DreNode[] = [];
  for (const c of contas) map.set(c.id, { conta: c, children: [] });
  for (const c of contas) {
    const node = map.get(c.id)!;
    if (c.conta_pai_id && map.has(c.conta_pai_id)) map.get(c.conta_pai_id)!.children.push(node);
    else roots.push(node);
  }
  const sort = (arr: DreNode[]) => { arr.sort((a, b) => a.conta.ordem - b.conta.ordem); arr.forEach(n => sort(n.children)); };
  sort(roots);
  return roots;
}

function sumNodeLeafs(node: DreNode, valMap: Record<string, number | null>): number {
  if (node.conta.nivel === 2) return valMap[node.conta.id] ?? 0;
  let total = 0;
  for (const child of node.children) total += sumNodeLeafs(child, valMap);
  return total;
}

function sumByTipo(tree: DreNode[], tipo: string, valMap: Record<string, number | null>): number {
  let total = 0;
  for (const node of tree) {
    if (node.conta.tipo === tipo) total += sumNodeLeafs(node, valMap);
  }
  return total;
}

// ══════════════════════════════════════════════════════════════
export function TorreIndicadoresCriacao({ cliente, competencia, mesProximo, valoresMensais, torreMetas, planoDeContas }: Props) {
  const [instrumentsOpen, setInstrumentsOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalTipo, setModalTipo] = useState<any>('altimetro');

  const mesBaseLabel = fmtCompetencia(competencia);
  const mesProxLabel = fmtCompetencia(mesProximo);

  // ── Build maps ────────────────────────────────────────────
  const realizadoMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valoresMensais.forEach(v => {
      if (v.competencia === competencia) map[v.conta_id] = v.valor_realizado;
    });
    return map;
  }, [valoresMensais, competencia]);

  const metaMap = useMemo(() => {
    const map: Record<string, TorreMeta> = {};
    torreMetas.forEach(m => { map[m.conta_id] = m; });
    return map;
  }, [torreMetas]);

  const tree = useMemo(() => buildTree(planoDeContas), [planoDeContas]);

  // ── Calculate totals (realized) ───────────────────────────
  const totais = useMemo(() => {
    const fat = sumByTipo(tree, 'receita', realizadoMap);
    const custos = sumByTipo(tree, 'custo_variavel', realizadoMap);
    const mc = fat + custos;
    const despesas = sumByTipo(tree, 'despesa_fixa', realizadoMap);
    const ro = mc + despesas;
    const invest = sumByTipo(tree, 'investimento', realizadoMap);
    const financ = sumByTipo(tree, 'financeiro', realizadoMap);
    const gc = ro + invest + financ;
    return { fat, custos, mc, despesas, ro, invest, financ, gc };
  }, [tree, realizadoMap]);

  // ── Calculate meta values ─────────────────────────────────
  const metaValoresMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    planoDeContas.forEach(c => {
      const real = realizadoMap[c.id] ?? null;
      const meta = metaMap[c.id] || null;
      if (real != null && meta && meta.meta_valor != null) {
        // calcProjetado returns Math.abs — preserve original sign for costs/expenses
        const projected = calcProjetado(real, meta);
        map[c.id] = projected !== null ? (real < 0 ? -Math.abs(projected) : projected) : real;
      } else {
        map[c.id] = real;
      }
    });
    return map;
  }, [planoDeContas, realizadoMap, metaMap]);

  const totaisMeta = useMemo(() => {
    const fat = sumByTipo(tree, 'receita', metaValoresMap);
    const custos = sumByTipo(tree, 'custo_variavel', metaValoresMap);
    const mc = fat + custos;
    const despesas = sumByTipo(tree, 'despesa_fixa', metaValoresMap);
    const ro = mc + despesas;
    const invest = sumByTipo(tree, 'investimento', metaValoresMap);
    const financ = sumByTipo(tree, 'financeiro', metaValoresMap);
    const gc = ro + invest + financ;
    return { fat, custos, mc, despesas, ro, invest, financ, gc };
  }, [tree, metaValoresMap]);

  const gcPct = totais.fat !== 0 ? (totais.gc / totais.fat) * 100 : 0;
  const gcMetaPct = totaisMeta.fat !== 0 ? (totaisMeta.gc / totaisMeta.fat) * 100 : 0;

  // ── Ganho Rápido ──────────────────────────────────────────
  const ganhoRapido = useMemo(() => {
    let bestScore = 0;
    let bestNome = '';
    let bestPct = 0;
    let bestValor = 0;

    for (const node of tree) {
      if (node.conta.tipo !== 'custo_variavel' && node.conta.tipo !== 'despesa_fixa') continue;
      if (node.conta.nivel !== 0) continue;
      for (const sub of node.children) {
        const meta = metaMap[sub.conta.id];
        if (!meta || meta.meta_valor == null) continue;
        const val = sumNodeLeafs(sub, realizadoMap);
        const absVal = Math.abs(val);
        const pct = meta.meta_tipo === 'pct' ? Math.abs(meta.meta_valor) : (absVal > 0 ? (Math.abs(meta.meta_valor) / absVal) * 100 : 0);
        const score = absVal * (pct / 100);
        if (score > bestScore) {
          bestScore = score;
          bestNome = sub.conta.nome;
          bestPct = pct;
          bestValor = score;
        }
      }
    }
    return { nome: bestNome, pct: bestPct, valor: bestValor };
  }, [tree, metaMap, realizadoMap]);

  // ── Projeção de Rota ──────────────────────────────────────
  const projecao = useMemo(() => {
    // Get GC for last 2 months
    const compDate = new Date(competencia + 'T12:00:00Z');
    const m1 = competencia;
    const m2d = new Date(compDate); m2d.setUTCMonth(m2d.getUTCMonth() - 1);
    const m2 = `${m2d.getUTCFullYear()}-${String(m2d.getUTCMonth() + 1).padStart(2, '0')}-01`;

    const calcGcForComp = (comp: string) => {
      const vm: Record<string, number | null> = {};
      valoresMensais.forEach(v => { if (v.competencia === comp) vm[v.conta_id] = v.valor_realizado; });
      const fat = sumByTipo(tree, 'receita', vm);
      const custos = sumByTipo(tree, 'custo_variavel', vm);
      const despesas = sumByTipo(tree, 'despesa_fixa', vm);
      const invest = sumByTipo(tree, 'investimento', vm);
      const financ = sumByTipo(tree, 'financeiro', vm);
      return fat + custos + despesas + invest + financ;
    };

    const gc1 = calcGcForComp(m1);
    const gc2 = calcGcForComp(m2);
    const avg = (gc1 + gc2) / 2;
    const tendencia = avg < gc1 ? 'queda' : 'melhora';
    return { valor: avg, tendencia: tendencia as 'queda' | 'melhora', gc1, gc2 };
  }, [competencia, valoresMensais, tree]);

  // ── Modal data builder ────────────────────────────────────
  const modalDados = useMemo(() => ({
    faturamento: totais.fat, custos: totais.custos, mc: totais.mc, despesas: totais.despesas,
    ro: totais.ro, investimentos: totais.invest, financeiro: totais.financ, gc: totais.gc,
    fatMeta: totaisMeta.fat, custosMeta: totaisMeta.custos, mcMeta: totaisMeta.mc,
    despesasMeta: totaisMeta.despesas, roMeta: totaisMeta.ro, investMeta: totaisMeta.invest,
    financMeta: totaisMeta.financ, gcMeta: totaisMeta.gc,
    gcPct, gcMetaPct,
    ganhoRapidoNome: ganhoRapido.nome, ganhoRapidoPct: ganhoRapido.pct, ganhoRapidoValor: ganhoRapido.valor,
    projecaoValor: projecao.valor, projecaoTendencia: projecao.tendencia,
    mesBase: mesBaseLabel, mesProximo: mesProxLabel,
  }), [totais, totaisMeta, gcPct, gcMetaPct, ganhoRapido, projecao, mesBaseLabel, mesProxLabel]);

  const openModal = (tipo: any) => { setModalTipo(tipo); setModalOpen(true); };

  // ── Frase lúdica ──────────────────────────────────────────
  const fraseLudica = ganhoRapido.nome
    ? `Comandante, reduza ${ganhoRapido.nome} em ${ganhoRapido.pct.toFixed(0)}% e liberamos ${fmtR(ganhoRapido.valor)} de altitude financeira em ${mesProxLabel}. Esse é o ajuste que muda a rota.`
    : `Comandante, aplique os ajustes propostos e a Geração de Caixa passa de ${gcPct.toFixed(1)}% para ${gcMetaPct.toFixed(1)}% em ${mesProxLabel}.`;

  const gcDelta = totaisMeta.gc - totais.gc;
  const gcBenchmark10 = totais.fat * 0.1;

  // ── DRE Cards config ──────────────────────────────────────
  const dreCards = [
    { key: 'fat', nome: 'Faturamento', tipo: 'receita', barra: C.primary, borda: undefined, real: totais.fat, meta: totaisMeta.fat },
    { key: 'custo', nome: '− Custos Operacionais', tipo: 'custo', barra: C.red, borda: undefined, real: totais.custos, meta: totaisMeta.custos },
    { key: 'mc', nome: '= Margem de Contribuição', tipo: 'mc', barra: C.green, borda: C.green, real: totais.mc, meta: totaisMeta.mc },
    { key: 'desp', nome: '− Despesas Fixas', tipo: 'despesa', barra: C.amber, borda: undefined, real: totais.despesas, meta: totaisMeta.despesas },
    { key: 'ro', nome: '= Resultado Operacional', tipo: 'ro', barra: C.primary, borda: C.primary, real: totais.ro, meta: totaisMeta.ro },
    { key: 'invest', nome: '− Ativ. Investimento', tipo: 'invest', barra: C.red, borda: undefined, real: totais.invest, meta: totaisMeta.invest },
    { key: 'financ', nome: '+/− Ativ. Financiamento', tipo: 'financ', barra: C.txtMuted, borda: undefined, real: totais.financ, meta: totaisMeta.financ },
    { key: 'gc', nome: '= Geração de Caixa', tipo: 'gc', barra: C.cyan, borda: C.cyan, real: totais.gc, meta: totaisMeta.gc },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <style>{keyframesCSS}</style>

      {/* ═══ PARTE A — Coordenada do Comandante ═══ */}
      <div style={{
        background: C.surface, border: `1px solid ${C.borderStr}`, borderLeft: `3px solid ${C.cyan}`,
        borderRadius: 12, boxShadow: '0 2px 8px rgba(13,27,53,0.06)',
        padding: '16px 20px', display: 'flex', alignItems: 'flex-start', gap: 14,
      }}>
        {/* Avatar */}
        <div style={{
          width: 48, height: 48, borderRadius: '50%', flexShrink: 0,
          background: 'linear-gradient(135deg, rgba(26,60,255,0.13), rgba(0,153,230,0.07))',
          border: '1.5px solid rgba(0,153,230,0.28)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'commanderFloat 3.5s ease-in-out infinite',
        }}>
          <span style={{ fontSize: 24 }}>👨🏻‍✈️</span>
        </div>

        {/* Conteúdo */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Eyebrow */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 8, fontWeight: 700, color: C.cyan, letterSpacing: '0.18em' }}>🎯 COORDENADA DO COMANDANTE GPI</span>
            <span style={{
              fontSize: 8, fontWeight: 700, color: C.green, background: C.greenLo, border: `1px solid ${C.greenBd}`,
              borderRadius: 10, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, animation: 'pulseGreen 2s infinite' }} />
              META PROPOSTA
            </span>
          </div>

          {/* Frase lúdica */}
          <p style={{ fontSize: 14, fontWeight: 700, color: C.txt, lineHeight: 1.5, margin: '0 0 10px' }}>{fraseLudica}</p>

          {/* Bloco técnico */}
          <div style={{ background: C.bgAlt, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px' }}>
            <p style={{ fontSize: 11.5, color: C.txtSec, fontWeight: 500, margin: 0, lineHeight: 1.6 }}>
              📌 Meta proposta para {mesProxLabel}: {ganhoRapido.nome ? <>reduzir {ganhoRapido.nome} em {fmtRColor(ganhoRapido.valor)}, mantendo receitas e demais saídas constantes.</> : <>aplicar os ajustes definidos nas metas.</>}
              {' '}Se atingida, a Geração de Caixa passará de {fmtRColor(totais.gc)} para {fmtRColor(totaisMeta.gc)} — {totais.gc < 0 && totaisMeta.gc >= 0
                ? 'saindo do vermelho para o positivo'
                : `de ${gcPct.toFixed(1)}% para ${gcMetaPct.toFixed(1)}%`
              }.
            </p>
          </div>
        </div>

        {/* Delta GC */}
        <div style={{
          minWidth: 110, alignSelf: 'flex-start', textAlign: 'center',
          background: C.greenLo, border: `1px solid ${C.greenBd}`, borderRadius: 10, padding: '10px 12px',
        }}>
          <p style={{ fontSize: 8, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.1em', textTransform: 'uppercase', margin: '0 0 4px' }}>IMPACTO GC</p>
          <p style={{ fontFamily: C.mono, fontSize: 22, fontWeight: 700, color: gcDelta >= 0 ? C.green : C.red, margin: '0 0 2px' }}>
            {gcDelta >= 0 ? '+' : ''}{fmtR(gcDelta)}
          </p>
          <p style={{ fontSize: 8, color: C.txtMuted, margin: 0 }}>variação total</p>
        </div>
      </div>

      {/* ═══ PARTE B — Seção colapsável ═══ */}
      <div>
        {/* Header colapsável */}
        <button
          onClick={() => setInstrumentsOpen(v => !v)}
          style={{
            display: 'flex', alignItems: 'center', gap: 8, width: '100%', cursor: 'pointer',
            background: 'none', border: 'none', padding: '8px 0',
            fontSize: 12, fontWeight: 700, color: C.txt, letterSpacing: '0.04em',
          }}
        >
          <span style={{
            display: 'inline-block', transition: 'transform 0.2s',
            transform: instrumentsOpen ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>▶</span>
          🛫 Instrumentos de Criação de Metas · {mesBaseLabel}
        </button>

        {/* Collapsible wrapper */}
        <div style={{
          maxHeight: instrumentsOpen ? 2000 : 0, opacity: instrumentsOpen ? 1 : 0,
          overflow: 'hidden', transition: 'max-height 0.4s ease, opacity 0.3s ease',
        }}>
          {/* ── B1: Grid 3 colunas ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 }}>
            {/* CARD 1: Altímetro Financeiro */}
            <div onClick={() => openModal('altimetro')} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
              cursor: 'pointer', overflow: 'hidden', transition: 'box-shadow 0.15s, transform 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(13,27,53,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ height: 2.5, background: `linear-gradient(90deg, ${C.red}, rgba(220,38,38,0.4))` }} />
              <div style={{ padding: 16 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: C.red, letterSpacing: '0.12em', margin: '0 0 2px' }}>◈ ALTÍMETRO FINANCEIRO</p>
                <p style={{ fontSize: 10, color: C.txtMuted, margin: '0 0 12px' }}>Geração de Caixa atual vs. meta GPI vs. meta proposta</p>

                {/* Gauge Arc SVG */}
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                  <svg viewBox="0 0 180 110" style={{ width: 180, height: 110 }}>
                    {/* Track */}
                    <path d="M 20 100 A 70 70 0 0 1 160 100" fill="none" stroke="rgba(13,27,53,0.07)" strokeWidth="10" strokeLinecap="round" />
                    {/* Fill - realized */}
                    {(() => {
                      const pct = Math.min(Math.max(Math.abs(gcPct) / 15, 0), 1);
                      const angle = pct * 180;
                      const rad = (angle * Math.PI) / 180;
                      const x = 90 - 70 * Math.cos(rad);
                      const y = 100 - 70 * Math.sin(rad);
                      const largeArc = angle > 90 ? 1 : 0;
                      return <path d={`M 20 100 A 70 70 0 ${largeArc} 1 ${x} ${y}`} fill="none" stroke={gcPct < 0 ? C.red : C.green} strokeWidth="10" strokeLinecap="round" />;
                    })()}
                    {/* Meta proposta dashed */}
                    {(() => {
                      const pct = Math.min(Math.max(Math.abs(gcMetaPct) / 15, 0), 1);
                      const angle = pct * 180;
                      const rad = (angle * Math.PI) / 180;
                      const x = 90 - 70 * Math.cos(rad);
                      const y = 100 - 70 * Math.sin(rad);
                      const largeArc = angle > 90 ? 1 : 0;
                      return <path d={`M 20 100 A 70 70 0 ${largeArc} 1 ${x} ${y}`} fill="none" stroke="rgba(26,60,255,0.35)" strokeWidth="6" strokeLinecap="round" strokeDasharray="4 4" />;
                    })()}
                    {/* Meta GPI 10% marker */}
                    {(() => {
                      const angle = (10 / 15) * 180;
                      const rad = (angle * Math.PI) / 180;
                      const x = 90 - 70 * Math.cos(rad);
                      const y = 100 - 70 * Math.sin(rad);
                      return <circle cx={x} cy={y} r="5" fill={C.amber} style={{ filter: 'drop-shadow(0 0 4px rgba(217,119,6,0.5))' }} />;
                    })()}
                    {/* Center value */}
                    <text x="90" y="80" textAnchor="middle" style={{ fontFamily: C.mono, fontSize: 22, fontWeight: 700, fill: gcPct < 0 ? C.red : C.green }}>{gcPct.toFixed(1)}%</text>
                    <text x="90" y="96" textAnchor="middle" style={{ fontSize: 8.5, fill: C.txtMuted }}>GC / FAT</text>
                    {/* Scale labels */}
                    <text x="15" y="108" style={{ fontSize: 8, fill: C.txtMuted }}>0%</text>
                    <text x="155" y="108" style={{ fontSize: 8, fill: C.txtMuted }}>15%</text>
                  </svg>
                </div>

                {/* Grid 3 columns */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, fontSize: 10 }}>
                  <div style={{ textAlign: 'center', borderRight: `1px solid ${C.border}`, padding: '6px 4px' }}>
                    <p style={{ fontSize: 7, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.08em', margin: '0 0 2px' }}>REALIZADO</p>
                    <p style={{ fontFamily: C.mono, fontWeight: 700, color: gcPct < 0 ? C.red : C.green, margin: '0 0 1px' }}>{gcPct.toFixed(1)}%</p>
                    <p style={{ fontFamily: C.mono, fontSize: 9, color: C.txtSec, margin: 0 }}>{fmtR(totais.gc)}</p>
                  </div>
                  <div style={{ textAlign: 'center', borderRight: `1px solid ${C.border}`, padding: '6px 4px' }}>
                    <p style={{ fontSize: 7, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.08em', margin: '0 0 2px' }}>META GPI</p>
                    <p style={{ fontFamily: C.mono, fontWeight: 700, color: C.amber, margin: '0 0 1px' }}>10.0%</p>
                    <p style={{ fontFamily: C.mono, fontSize: 9, color: C.txtSec, margin: 0 }}>{fmtR(gcBenchmark10)}</p>
                  </div>
                  <div style={{ textAlign: 'center', padding: '6px 4px' }}>
                    <p style={{ fontSize: 7, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.08em', margin: '0 0 2px' }}>META PROPOSTA</p>
                    <p style={{ fontFamily: C.mono, fontWeight: 700, color: C.primary, margin: '0 0 1px' }}>{gcMetaPct.toFixed(1)}%</p>
                    <p style={{ fontFamily: C.mono, fontSize: 9, color: C.txtSec, margin: 0 }}>{fmtR(totaisMeta.gc)}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* CARD 2: Ganho Rápido */}
            <div onClick={() => openModal('ganho_rapido')} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
              cursor: 'pointer', overflow: 'hidden', transition: 'box-shadow 0.15s, transform 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(13,27,53,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ height: 2.5, background: `linear-gradient(90deg, ${C.green}, rgba(0,168,107,0.4))` }} />
              <div style={{ padding: 16 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: C.green, letterSpacing: '0.12em', margin: '0 0 2px' }}>⚡ GANHO RÁPIDO</p>
                <p style={{ fontSize: 10, color: C.txtMuted, margin: '0 0 12px' }}>Custo ou despesa com maior retorno de redução na GC</p>

                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {/* Radar SVG */}
                  <svg viewBox="0 0 88 88" style={{ width: 88, height: 88, flexShrink: 0, background: 'rgba(240,244,250,0.9)', borderRadius: '50%' }}>
                    <circle cx="44" cy="44" r="38" fill="none" stroke={C.green} strokeWidth="0.5" opacity="0.3" />
                    <circle cx="44" cy="44" r="28" fill="none" stroke={C.green} strokeWidth="0.5" opacity="0.25" />
                    <circle cx="44" cy="44" r="18" fill="none" stroke={C.green} strokeWidth="0.5" opacity="0.2" />
                    <line x1="44" y1="6" x2="44" y2="82" stroke={C.green} strokeWidth="0.3" opacity="0.2" />
                    <line x1="6" y1="44" x2="82" y2="44" stroke={C.green} strokeWidth="0.3" opacity="0.2" />
                    {/* Sweep */}
                    <line x1="44" y1="44" x2="44" y2="8" stroke={C.green} strokeWidth="1.5" opacity="0.6" style={{ transformOrigin: '44px 44px', animation: 'radarSweepInst 3s linear infinite' }} />
                    {/* Blip */}
                    <circle cx="56" cy="30" r="3" fill={C.green} opacity="0.7" style={{ animation: 'blipPulse 1.5s ease infinite' }} />
                  </svg>

                  <div style={{ flex: 1 }}>
                    {ganhoRapido.nome ? (
                      <>
                        <p style={{ fontSize: 13, fontWeight: 700, color: C.txt, margin: '0 0 6px' }}>{ganhoRapido.nome}</p>
                        <div style={{ display: 'inline-block', background: C.greenLo, border: `1px solid ${C.greenBd}`, borderRadius: 6, padding: '3px 8px', marginBottom: 6 }}>
                          <span style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 700, color: C.green }}>−{ganhoRapido.pct.toFixed(0)}% → +{fmtR(ganhoRapido.valor)}</span>
                        </div>
                        <p style={{ fontSize: 10, color: C.txtMuted, fontStyle: 'italic', margin: 0 }}>Maior impacto na Geração de Caixa</p>
                      </>
                    ) : (
                      <p style={{ fontSize: 12, color: C.txtMuted, margin: 0 }}>Nenhuma meta definida para custos/despesas</p>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* CARD 3: Projeção de Rota */}
            <div onClick={() => openModal('projecao_rota')} style={{
              background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12,
              cursor: 'pointer', overflow: 'hidden', transition: 'box-shadow 0.15s, transform 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(13,27,53,0.12)'; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
            >
              <div style={{ height: 2.5, background: `linear-gradient(90deg, ${C.amber}, rgba(217,119,6,0.4))` }} />
              <div style={{ padding: 16 }}>
                <p style={{ fontSize: 9, fontWeight: 700, color: C.amber, letterSpacing: '0.12em', margin: '0 0 2px' }}>🔮 PROJEÇÃO DE ROTA</p>
                <p style={{ fontSize: 10, color: C.txtMuted, margin: '0 0 12px' }}>Tendência da GC em {mesProxLabel} se nenhuma meta for atingida</p>

                {/* Mini chart SVG */}
                <svg viewBox="0 0 200 62" style={{ width: '100%', height: 62, marginBottom: 10 }}>
                  {/* Meta 10% line */}
                  {(() => {
                    const metaY = totais.fat !== 0 ? 56 - (10 / 15) * 50 : 30;
                    return (
                      <>
                        <line x1="0" y1={metaY} x2="200" y2={metaY} stroke={C.amber} strokeWidth="1" strokeDasharray="3 3" opacity="0.5" />
                        <text x="160" y={metaY - 3} style={{ fontSize: 7, fill: C.amber, fontWeight: 600 }}>META 10%</text>
                      </>
                    );
                  })()}
                  {/* Historical line */}
                  {(() => {
                    const gc2Pct = totais.fat !== 0 ? (projecao.gc2 / totais.fat) * 100 : 0;
                    const gc1Pct = totais.fat !== 0 ? (projecao.gc1 / totais.fat) * 100 : 0;
                    const projPct = totais.fat !== 0 ? (projecao.valor / totais.fat) * 100 : 0;
                    const toY = (pct: number) => 56 - (Math.max(Math.min(pct, 15), -5) + 5) / 20 * 50;
                    const y0 = toY(gc2Pct), y1 = toY(gc1Pct), y2 = toY(projPct);
                    return (
                      <>
                        <polyline points={`30,${y0} 100,${y1}`} fill="none" stroke={C.primary} strokeWidth="2" />
                        <polyline points={`100,${y1} 170,${y2}`} fill="none" stroke={C.red} strokeWidth="2" strokeDasharray="4 3" />
                        <circle cx="30" cy={y0} r="3" fill={C.primary} />
                        <circle cx="100" cy={y1} r="3" fill={C.primary} />
                        <text x="96" y={y1 - 6} style={{ fontSize: 10 }}>✈</text>
                        <circle cx="170" cy={y2} r="3" fill={C.red} />
                      </>
                    );
                  })()}
                </svg>

                <p style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 700, color: projecao.valor < 0 ? C.red : C.txt, marginBottom: 4 }}>{fmtR(projecao.valor)}</p>
                <p style={{ fontSize: 10, color: projecao.tendencia === 'queda' ? C.red : C.green, fontWeight: 600, margin: 0 }}>
                  {projecao.tendencia === 'queda' ? '↓ tendência de queda' : '↑ tendência de melhora'}
                </p>
              </div>
            </div>
          </div>

          {/* ── B2: Grid DRE 4×2 ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {dreCards.map(card => {
              const delta = card.meta - card.real;
              const pctChange = card.real !== 0 ? ((card.meta - card.real) / Math.abs(card.real)) * 100 : 0;
              const isPositiveDelta = (card.key === 'fat' || card.key === 'mc' || card.key === 'ro' || card.key === 'gc') ? delta >= 0 : delta <= 0;
              const hasMeta = Math.abs(card.meta - card.real) > 0.01;

              return (
                <div key={card.key} onClick={() => openModal(card.key as any)} style={{
                  background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10,
                  borderLeft: card.borda ? `3px solid ${card.borda}` : undefined,
                  cursor: 'pointer', overflow: 'hidden', transition: 'box-shadow 0.15s, transform 0.15s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(13,27,53,0.10)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                  onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}
                >
                  <div style={{ height: 2.5, background: `linear-gradient(90deg, ${card.barra}, ${card.barra}66)` }} />
                  <div style={{ padding: '12px 14px' }}>
                    {/* Top: nome + badge */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: C.txt }}>{card.nome}</span>
                      <span style={{
                        fontSize: 8, fontWeight: 700, borderRadius: 4, padding: '1px 5px',
                        color: !hasMeta ? C.txtMuted : isPositiveDelta ? C.green : C.red,
                        background: !hasMeta ? 'transparent' : isPositiveDelta ? C.greenLo : 'rgba(220,38,38,0.08)',
                      }}>
                        {!hasMeta ? '= sem ajuste' : `${pctChange >= 0 ? '↑' : '↓'} ${Math.abs(pctChange).toFixed(1)}%`}
                      </span>
                    </div>

                    {/* Valor meta destaque */}
                    <p style={{ fontFamily: C.mono, fontSize: 20, fontWeight: 700, color: C.txt, margin: '0 0 2px' }}>{fmtR(card.meta)}</p>
                    <p style={{ fontSize: 8, fontWeight: 600, color: card.barra, margin: '0 0 8px', letterSpacing: '0.06em' }}>meta {mesProxLabel}</p>

                    <div style={{ height: 1, background: C.border, marginBottom: 8 }} />

                    {/* Realizado */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 11, color: C.txtMuted }}>Realizado {mesBaseLabel}</span>
                      <span style={{ fontFamily: C.mono, fontSize: 11, color: C.txtMuted, textDecoration: hasMeta ? 'line-through' : 'none' }}>{fmtR(card.real)}</span>
                    </div>

                    {/* Delta */}
                    {hasMeta && (
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, color: C.txtMuted }}>{isPositiveDelta ? 'Ganho' : 'Variação'}</span>
                        <span style={{ fontFamily: C.mono, fontSize: 11, fontWeight: 700, color: isPositiveDelta ? C.green : C.red }}>
                          {delta >= 0 ? '+' : ''}{fmtR(delta)}
                        </span>
                      </div>
                    )}

                    {/* GC special block */}
                    {card.key === 'gc' && (
                      <div style={{
                        marginTop: 8, background: C.greenLo, border: `1px solid ${C.greenBd}`,
                        borderRadius: 6, padding: '6px 8px',
                      }}>
                        <p style={{ fontSize: 10, color: C.green, fontWeight: 600, margin: 0 }}>
                          🎯 {totaisMeta.gc >= 0 ? 'Meta: levar a GC para o positivo' : 'Meta: reduzir o déficit de caixa'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Modal */}
      <TorreIndicadorModal open={modalOpen} onClose={() => setModalOpen(false)} tipo={modalTipo} dados={modalDados} />
    </div>
  );
}
