import { useMemo, useEffect, useRef, useState } from 'react';
import { BarChart, Bar, ComposedChart, Line, Area, XAxis, YAxis, ReferenceLine, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrency } from '@/lib/plano-contas-utils';
import type { ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas } from '@/lib/dre-indicadores';
import { AnaliseDrawer, type AnaliseDrawerDados } from './AnaliseDrawer';

/* ──────── types ──────── */
interface Props {
  contas: ContaRow[];
  valoresAnuais: { conta_id: string; competencia: string; valor_realizado: number | null }[];
  months: { value: string; label: string; shortLabel: string }[];
  mesSelecionado?: string;
}

/* ──────── animated counter ──────── */
function useAnimatedNumber(target: number, duration = 600, delay = 0) {
  const [v, setV] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    const t = setTimeout(() => {
      const start = performance.now();
      const animate = (now: number) => {
        const p = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        setV(target * ease);
        if (p < 1 && mountedRef.current) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }, delay);
    return () => { mountedRef.current = false; clearTimeout(t); };
  }, [target, duration, delay]);
  return v;
}

/* ──────── helpers ──────── */
function calcIndicatorValue(leafs: ContaRow[], valMap: Record<string, number | null>, tipos: string[]): number {
  let total = 0;
  for (const c of leafs) {
    if (!tipos.includes(c.tipo)) continue;
    const v = valMap[c.id];
    if (v == null) continue;
    total += v;
  }
  return total;
}

function sumByTipo(leafs: ContaRow[], valMap: Record<string, number | null>, tipo: string): number {
  let total = 0;
  for (const c of leafs) {
    if (c.tipo !== tipo) continue;
    const v = valMap[c.id];
    if (v != null) total += v;
  }
  return total;
}

function getSubgroups(
  contas: ContaRow[], tipo: string,
  valMap: Record<string, number | null>,
  fat: number,
  prevMap?: Record<string, number | null>,
): any[] {
  const subs = contas.filter(c => c.tipo === tipo && c.nivel === 1);
  const result = subs.map(s => {
    const parent = contas.find(c => c.id === s.conta_pai_id && c.nivel === 0);
    const children = contas.filter(c => c.conta_pai_id === s.id && c.nivel === 2);
    let val = 0;
    let valPrev = 0;
    for (const ch of children) {
      const v = valMap[ch.id];
      if (v != null) val += Math.abs(v);
      if (prevMap) {
        const vp = prevMap[ch.id];
        if (vp != null) valPrev += Math.abs(vp);
      }
    }
    const filhas = children
      .map(ch => {
        const v = valMap[ch.id];
        const valor = v != null ? v : 0;
        return { nome: ch.nome, valor, pct_faturamento: fat ? (Math.abs(valor) / fat) * 100 : 0 };
      })
      .filter(f => f.valor !== 0)
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor))
      .slice(0, 5);

    const entry: any = {
      nome: s.nome,
      grupo: parent?.nome || tipo,
      nivel: 'subgrupo',
      valor: val,
      pct_faturamento: fat ? (val / fat) * 100 : 0,
      filhas,
    };
    if (prevMap) {
      entry.valor_anterior = valPrev;
      entry.variacao_abs = val - valPrev;
      entry.variacao_pct = valPrev ? ((val - valPrev) / valPrev) * 100 : 0;
    }
    return entry;
  }).filter(s => s.valor !== 0);
  return result.sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
}

function fmtCurrency(v: number): string {
  return formatCurrency(Math.abs(v)).replace('R$\u00a0', 'R$ ').replace('R$  ', 'R$ ');
}

function fmtPct(v: number): string {
  return v.toFixed(1).replace('.', ',') + '%';
}

function statusColor(value: number, thresholds: [number, number], direction: 'higher_better' | 'lower_better'): string {
  const [low, high] = thresholds;
  if (direction === 'higher_better') {
    if (value > high) return '#00A86B';
    if (value >= low) return '#D97706';
    return '#DC2626';
  }
  if (value < low) return '#00A86B';
  if (value <= high) return '#D97706';
  return '#DC2626';
}

function statusLabel(color: string): 'verde' | 'ambar' | 'vermelho' {
  if (color === '#00A86B') return 'verde';
  if (color === '#D97706') return 'ambar';
  return 'vermelho';
}

const BLUE = '#1A3CFF';
const INVEST_BLUE = '#0099E6';

/* ──────── sparkline SVG ──────── */
function MiniSparkLine({ data, color, w = 48, h = 32 }: { data: number[]; color: string; w?: number; h?: number }) {
  if (data.length < 2) return <div style={{ width: w, height: h }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 3;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(' ');
  const lastX = pad + ((data.length - 1) / (data.length - 1)) * (w - pad * 2);
  const lastY = h - pad - ((data[data.length - 1] - min) / range) * (h - pad * 2);
  return (
    <svg width={w} height={h} className="inline-block">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
      <circle cx={lastX} cy={lastY} r={3} fill={color} />
    </svg>
  );
}

/* ──────── card wrapper ──────── */
function IndicatorCard({ index, color, label, children, hasData, onClick }: {
  index: number; color: string; label: string; hasData: boolean; children: React.ReactNode; onClick?: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const [lineWidth, setLineWidth] = useState(0);
  const [hovered, setHovered] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), index * 60);
    const t2 = setTimeout(() => setLineWidth(100), index * 60 + 100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [index]);

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: '#FFFFFF',
        border: '1px solid #DDE4F0',
        borderRadius: 12,
        padding: 16,
        position: 'relative',
        overflow: 'hidden',
        minHeight: 88,
        opacity: visible ? 1 : 0,
        transform: visible ? (hovered ? 'translateY(-1px)' : 'translateY(0)') : 'translateY(8px)',
        transition: 'opacity 350ms cubic-bezier(0.16,1,0.3,1), transform 200ms ease, box-shadow 200ms ease',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: hovered && onClick ? '0 4px 16px #1A3CFF14' : 'none',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 100% 0%, ${color}0F, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, borderRadius: '12px 12px 0 0', background: color, width: `${lineWidth}%`, transition: 'width 400ms cubic-bezier(0.16,1,0.3,1)' }} />
      <div style={{ textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.05em', color: '#8A9BBC', fontWeight: 600, marginBottom: 4, position: 'relative' }}>{label}</div>
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}

/* ──────── main component ──────── */
export function DreIndicadoresHeader({ contas, valoresAnuais, months, mesSelecionado }: Props) {
  const leafs = useMemo(() => getLeafContas(contas), [contas]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTitulo, setDrawerTitulo] = useState('');
  const [drawerDados, setDrawerDados] = useState<AnaliseDrawerDados | null>(null);

  const valoresMap = useMemo(() => {
    const map: Record<string, Record<string, number | null>> = {};
    valoresAnuais?.forEach((v) => {
      if (!map[v.conta_id]) map[v.conta_id] = {};
      map[v.conta_id][v.competencia] = v.valor_realizado;
    });
    return map;
  }, [valoresAnuais]);

  const getMonthMap = (comp: string): Record<string, number | null> => {
    const m: Record<string, number | null> = {};
    contas.forEach(c => { m[c.id] = valoresMap[c.id]?.[comp] ?? null; });
    return m;
  };

  const monthsWithData = useMemo(() => {
    return months.filter(m => valoresAnuais?.some(v => v.competencia === m.value && v.valor_realizado != null));
  }, [months, valoresAnuais]);

  const hasData = monthsWithData.length > 0;

  // Use mesSelecionado prop if provided, otherwise default to last month with data
  const selectedIdx = mesSelecionado ? monthsWithData.findIndex(m => m.value === mesSelecionado) : monthsWithData.length - 1;
  const latestMonth = selectedIdx >= 0 ? monthsWithData[selectedIdx] : monthsWithData[monthsWithData.length - 1];
  const prevMonth = selectedIdx > 0 ? monthsWithData[selectedIdx - 1] : (monthsWithData.length >= 2 ? monthsWithData[monthsWithData.length - 2] : null);
  const last6 = mesSelecionado
    ? monthsWithData.slice(0, selectedIdx + 1).slice(-6)
    : monthsWithData.slice(-6);

  const currentMap = latestMonth ? getMonthMap(latestMonth.value) : {};
  const prevMap = prevMonth ? getMonthMap(prevMonth.value) : {};

  // Core values
  const fat = hasData ? calcIndicatorValue(leafs, currentMap, ['receita']) : 0;
  const custosVar = hasData ? sumByTipo(leafs, currentMap, 'custo_variavel') : 0;
  const mc = hasData ? calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel']) : 0;
  const despesasFixas = hasData ? sumByTipo(leafs, currentMap, 'despesa_fixa') : 0;
  const ro = hasData ? calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel', 'despesa_fixa']) : 0;
  const investimentos = hasData ? sumByTipo(leafs, currentMap, 'investimento') : 0;
  const financeiro = hasData ? sumByTipo(leafs, currentMap, 'financeiro') : 0;
  const rai = hasData ? calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento']) : 0;
  const gc = hasData ? calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']) : 0;

  // Percentages
  const custosVarPct = fat ? (custosVar / fat) * 100 : 0;
  const mcPct = fat ? (mc / fat) * 100 : 0;
  const despFixasPct = fat ? (despesasFixas / fat) * 100 : 0;
  const roPct = fat ? (ro / fat) * 100 : 0;
  const investPct = fat ? (investimentos / fat) * 100 : 0;
  const financeiroPct = fat ? (financeiro / fat) * 100 : 0;
  const raiPct = fat ? (rai / fat) * 100 : 0;
  const gcPct = fat ? (gc / fat) * 100 : 0;

  // Financeiro sign-based value (positive = entrada, negative = saída)
  const financeiroSigned = hasData ? calcIndicatorValue(leafs, currentMap, ['financeiro']) : 0;

  // PE
  const mcDecimal = fat ? mc / fat : 0;
  const peMinimo = mcDecimal ? despesasFixas / mcDecimal : 0;
  const peIdeal = mcDecimal ? (despesasFixas + investimentos + financeiro) / mcDecimal : 0;
  const gapMinimo = fat - peMinimo;
  const gapIdeal = fat - peIdeal;

  // History arrays
  const histFat = last6.map(m => calcIndicatorValue(leafs, getMonthMap(m.value), ['receita']));
  const histCustos = last6.map(m => sumByTipo(leafs, getMonthMap(m.value), 'custo_variavel'));
  const histMC = last6.map(m => { const mm = getMonthMap(m.value); const f = calcIndicatorValue(leafs, mm, ['receita']); const mcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel']); return f ? (mcV / f) * 100 : 0; });
  const histDesp = last6.map(m => sumByTipo(leafs, getMonthMap(m.value), 'despesa_fixa'));
  const histRO = last6.map(m => { const mm = getMonthMap(m.value); const f = calcIndicatorValue(leafs, mm, ['receita']); const roV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel', 'despesa_fixa']); return f ? (roV / f) * 100 : 0; });
  const histInvest = last6.map(m => sumByTipo(leafs, getMonthMap(m.value), 'investimento'));
  const histFin = last6.map(m => sumByTipo(leafs, getMonthMap(m.value), 'financeiro'));
  const histRAI = last6.map(m => { const mm = getMonthMap(m.value); const f = calcIndicatorValue(leafs, mm, ['receita']); const r = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento']); return f ? (r / f) * 100 : 0; });
  const histGC = last6.map(m => { const mm = getMonthMap(m.value); const f = calcIndicatorValue(leafs, mm, ['receita']); const gcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']); return f ? (gcV / f) * 100 : 0; });
  const histPE = last6.map(m => {
    const mm = getMonthMap(m.value);
    const f = calcIndicatorValue(leafs, mm, ['receita']);
    const mcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel']);
    const df = sumByTipo(leafs, mm, 'despesa_fixa');
    const mcD = f ? mcV / f : 0;
    return mcD ? df / mcD : 0;
  });

  // Colors
  const custosColor = statusColor(custosVarPct, [38, 50], 'lower_better');
  const mcColor = statusColor(mcPct, [30, 40], 'higher_better');
  const despColor = statusColor(despFixasPct, [25, 35], 'lower_better');
  const roColor = statusColor(roPct, [5, 10], 'higher_better');
  const raiColor = statusColor(raiPct, [0, 5], 'higher_better');
  const gcColor = statusColor(gcPct, [3, 10], 'higher_better');
  const finColor = financeiroSigned > 0 ? '#00A86B' : financeiroSigned < 0 ? '#DC2626' : '#8A9BBC';
  const peColor = gapMinimo >= 0 ? '#00A86B' : '#DC2626';

  // Animations
  const animFat = useAnimatedNumber(hasData ? fat : 0, 600, 0);
  const animCustos = useAnimatedNumber(hasData ? custosVar : 0, 600, 60);
  const animMcPct = useAnimatedNumber(hasData ? mcPct : 0, 600, 120);
  const animDesp = useAnimatedNumber(hasData ? despesasFixas : 0, 600, 180);
  const animRoPct = useAnimatedNumber(hasData ? roPct : 0, 600, 240);
  const animInvest = useAnimatedNumber(hasData ? investimentos : 0, 600, 300);
  const animFin = useAnimatedNumber(hasData ? financeiro : 0, 600, 360);
  const animRaiPct = useAnimatedNumber(hasData ? raiPct : 0, 600, 420);
  const animGcPct = useAnimatedNumber(hasData ? gcPct : 0, 600, 480);

  const monthLabel = latestMonth ? new Date(latestMonth.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '') : '';
  const monthLabelFull = latestMonth ? new Date(latestMonth.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';

  const openDrawer = (titulo: string, dados: AnaliseDrawerDados) => {
    setDrawerTitulo(titulo);
    setDrawerDados(dados);
    setDrawerOpen(true);
  };

  /* ── click handlers ── */

  const handleFatClick = () => {
    if (!hasData) return;
    const subs = getSubgroups(contas, 'receita', currentMap, fat, prevMap);
    const subsText = subs.map(s => `[${s.nome}: ${fmtCurrency(s.valor)}]`).join(' + ');
    openDrawer('Faturamento', {
      indicador: 'Faturamento', valor_atual: 100, valor_absoluto: fat, faturamento: fat,
      mes_referencia: monthLabelFull, status: 'verde', limite_verde: 0, limite_ambar: 0,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histFat[i] })),
      formula: `Faturamento = Soma de todas as Receitas Operacionais\n= ${subsText}\n= ${fmtCurrency(fat)}`,
      composicao: subs,
      instrucao_especifica: 'Identifique qual canal de receita mais contribui, qual está crescendo e qual está caindo vs mês anterior. Aponte oportunidade ou risco específico.',
    });
  };

  const handleCustosClick = () => {
    if (!hasData) return;
    const subs = getSubgroups(contas, 'custo_variavel', currentMap, fat, prevMap);
    const subsText = subs.map(s => `${s.nome}: ${fmtCurrency(s.valor)} (${fmtPct(s.pct_faturamento)})`).join('\n');
    openDrawer('Custos Operacionais', {
      indicador: 'Custos Operacionais', valor_atual: custosVarPct, valor_absoluto: custosVar, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(custosColor), limite_verde: 38, limite_ambar: 50,
      direcao: 'menor_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histCustos[i] })),
      formula: `Custos Op. = Soma dos Custos Variáveis\n${subsText}\n= ${fmtCurrency(custosVar)} (${fmtPct(custosVarPct)} do fat.)`,
      composicao: subs,
      instrucao_especifica: 'Identifique qual custo variável mais pressiona o faturamento. Verifique se algum subgrupo cresceu vs mês anterior. Sugira onde reduzir.',
    });
  };

  const handleMcClick = () => {
    if (!hasData) return;
    const recSubs = getSubgroups(contas, 'receita', currentMap, fat);
    const custoSubs = getSubgroups(contas, 'custo_variavel', currentMap, fat);
    const custosText = custoSubs.map(s => `${s.nome}: ${fmtCurrency(s.valor)} (${fmtPct(s.pct_faturamento)} fat)`).join('\n');
    openDrawer('Margem de Contribuição', {
      indicador: 'Margem de Contribuição', valor_atual: mcPct, valor_absoluto: mc, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(mcColor), limite_verde: 40, limite_ambar: 30,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histMC[i] })),
      formula: `MC = Faturamento - Custos Variáveis\nFaturamento: ${fmtCurrency(fat)}\n${custosText}\n= MC ${fmtCurrency(mc)} (${fmtPct(mcPct)})`,
      composicao: [
        ...recSubs.map(s => ({ ...s, grupo: 'Receitas' })),
        ...custoSubs.map(s => ({ ...s, grupo: 'Custos Variáveis' })),
        { nome: 'Margem de Contribuição', grupo: 'Resultado', nivel: 'totalizador', valor: mc, pct_faturamento: mcPct },
      ],
      instrucao_especifica: 'Identifique qual custo variável mais pressiona a margem. Verifique se algum subgrupo está acima do benchmark saudável para o segmento. Sugira ação específica.',
    });
  };

  const handleDespClick = () => {
    if (!hasData) return;
    const subs = getSubgroups(contas, 'despesa_fixa', currentMap, fat, prevMap);
    const subsText = subs.map(s => `${s.nome}: ${fmtCurrency(s.valor)} (${fmtPct(s.pct_faturamento)})`).join('\n');
    openDrawer('Despesas Fixas', {
      indicador: 'Despesas Fixas', valor_atual: despFixasPct, valor_absoluto: despesasFixas, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(despColor), limite_verde: 25, limite_ambar: 35,
      direcao: 'menor_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histDesp[i] })),
      formula: `Despesas Fixas = Soma das Despesas Operacionais\n${subsText}\n= ${fmtCurrency(despesasFixas)} (${fmtPct(despFixasPct)} do fat.)`,
      composicao: subs,
      instrucao_especifica: 'Identifique a despesa fixa mais pesada em % do faturamento. Avalie se é estrutural ou pontual. Cite o nome exato da conta mais relevante.',
    });
  };

  const handleRoClick = () => {
    if (!hasData) return;
    const despSubs = getSubgroups(contas, 'despesa_fixa', currentMap, fat);
    const despText = despSubs.map(s => `${s.nome}: ${fmtCurrency(s.valor)} (${fmtPct(s.pct_faturamento)} fat)`).join('\n');
    openDrawer('Resultado Operacional', {
      indicador: 'Resultado Operacional', valor_atual: roPct, valor_absoluto: ro, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(roColor), limite_verde: 10, limite_ambar: 5,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histRO[i] })),
      formula: `RO = MC - Despesas Fixas\nMC: ${fmtCurrency(mc)} (${fmtPct(mcPct)})\n${despText}\n= RO ${fmtCurrency(ro)} (${fmtPct(roPct)})`,
      composicao: [
        { nome: 'Margem de Contribuição', grupo: 'MC', nivel: 'totalizador', valor: mc, pct_faturamento: mcPct },
        ...despSubs.map(s => ({ ...s, grupo: 'Despesas Fixas' })),
        { nome: 'Resultado Operacional', grupo: 'Resultado', nivel: 'totalizador', valor: ro, pct_faturamento: roPct },
      ],
      instrucao_especifica: 'Identifique a despesa fixa mais pesada em % do faturamento. Avalie se o RO está comprometido por despesas estruturais ou pontuais. Sugira onde cortar ou otimizar.',
    });
  };

  const handleInvestClick = () => {
    if (!hasData) return;
    const subs = getSubgroups(contas, 'investimento', currentMap, fat, prevMap);
    const subsText = subs.map(s => `${s.nome}: ${fmtCurrency(s.valor)} (${fmtPct(s.pct_faturamento)})`).join('\n');
    openDrawer('Atividades de Investimento', {
      indicador: 'Atividades de Investimento', valor_atual: investPct, valor_absoluto: investimentos, faturamento: fat,
      mes_referencia: monthLabelFull, status: 'verde', limite_verde: 0, limite_ambar: 0,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histInvest[i] })),
      formula: `Invest. = Soma das Atividades de Investimento\n${subsText}\n= ${fmtCurrency(investimentos)} (${fmtPct(investPct)} do fat.)`,
      composicao: subs,
      instrucao_especifica: 'Avalie se os investimentos realizados são proporcionais ao resultado operacional disponível. Identifique o maior item de investimento e seu impacto no fluxo de caixa.',
    });
  };

  const handleFinClick = () => {
    if (!hasData) return;
    const subs = getSubgroups(contas, 'financeiro', currentMap, fat, prevMap);
    const subsText = subs.map(s => `${s.nome}: ${fmtCurrency(s.valor)} (${fmtPct(s.pct_faturamento)})`).join('\n');
    openDrawer('Atividades de Financiamento', {
      indicador: 'Atividades de Financiamento', valor_atual: financeiroPct, valor_absoluto: financeiro, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(finColor), limite_verde: 0, limite_ambar: 0,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histFin[i] })),
      formula: `Financ. = Soma das Atividades de Financiamento\n${subsText}\n= ${fmtCurrency(financeiro)} (${fmtPct(financeiroPct)} do fat.)`,
      composicao: subs,
      instrucao_especifica: 'Identifique se as atividades de financiamento representam entrada (empréstimos/aportes) ou saída (pagamento de dívidas/retiradas). Avalie o impacto no caixa disponível.',
    });
  };

  const handleRaiClick = () => {
    if (!hasData) return;
    const roVal = ro;
    const roPctVal = roPct;
    openDrawer('Resultado após Investimentos', {
      indicador: 'Resultado após Investimentos', valor_atual: raiPct, valor_absoluto: rai, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(raiColor), limite_verde: 5, limite_ambar: 0,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histRAI[i] })),
      formula: `RAI = Resultado Operacional − Investimentos\nRO: ${fmtCurrency(roVal)} (${fmtPct(roPctVal)})\nInvest.: ${fmtCurrency(investimentos)} (${fmtPct(investPct)})\n= ${fmtCurrency(rai)} (${fmtPct(raiPct)})`,
      composicao: [
        { nome: 'Resultado Operacional', grupo: 'RO', nivel: 'totalizador', valor: roVal, pct_faturamento: roPctVal },
        { nome: '(-) Atividades de Investimento', grupo: 'Investimento', nivel: 'totalizador', valor: investimentos, pct_faturamento: investPct },
        { nome: '= Resultado após Invest.', grupo: 'Resultado', nivel: 'totalizador', valor: rai, pct_faturamento: raiPct },
      ],
      instrucao_especifica: 'Avalie se o resultado operacional é suficiente para absorver os investimentos realizados. Se RAI negativo, indique se é por baixo RO ou por investimentos excessivos no período.',
    });
  };

  const handleGcClick = () => {
    if (!hasData) return;
    const recSubs = getSubgroups(contas, 'receita', currentMap, fat);
    const custoSubs = getSubgroups(contas, 'custo_variavel', currentMap, fat);
    const despSubs = getSubgroups(contas, 'despesa_fixa', currentMap, fat);
    const invSubs = getSubgroups(contas, 'investimento', currentMap, fat);
    const finSubs = getSubgroups(contas, 'financeiro', currentMap, fat);
    openDrawer('Geração de Caixa', {
      indicador: 'Geração de Caixa', valor_atual: gcPct, valor_absoluto: gc, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(gcColor), limite_verde: 10, limite_ambar: 3,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histGC[i] })),
      formula: `GC = Faturamento - Custos Variáveis - Despesas Fixas - Investimentos ± Financeiro\n= ${fmtCurrency(fat)} - ${fmtCurrency(custosVar)} - ${fmtCurrency(despesasFixas)} - ${fmtCurrency(investimentos)} ± ${fmtCurrency(financeiro)}\n= ${fmtCurrency(gc)} (${fmtPct(gcPct)})`,
      composicao: [
        ...recSubs.map(s => ({ ...s, grupo: 'Receitas' })),
        ...custoSubs.map(s => ({ ...s, grupo: 'Custos Variáveis' })),
        ...despSubs.map(s => ({ ...s, grupo: 'Despesas Fixas' })),
        ...invSubs.map(s => ({ ...s, grupo: 'Investimentos' })),
        ...finSubs.map(s => ({ ...s, grupo: 'Financeiro' })),
      ],
      instrucao_especifica: 'Analise a geração de caixa considerando todos os 5 grupos (receitas, custos variáveis, despesas fixas, investimentos, financeiro). Identifique qual grupo mais impacta negativamente e sugira ação.',
    });
  };

  const handlePeClick = () => {
    if (!hasData) return;
    const mcPctVal = mcDecimal * 100;
    const despSubs = getSubgroups(contas, 'despesa_fixa', currentMap, fat);
    openDrawer('Ponto de Equilíbrio', {
      indicador: 'Ponto de Equilíbrio', valor_atual: peMinimo ? (fat / peMinimo) * 100 : 0, valor_absoluto: peMinimo, faturamento: fat,
      mes_referencia: monthLabelFull, status: gapMinimo >= 0 ? 'verde' : 'vermelho', limite_verde: 100, limite_ambar: 90,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histPE[i] })),
      formula: `PE Mínimo = Despesas Fixas ÷ MC%\n= ${fmtCurrency(despesasFixas)} ÷ ${fmtPct(mcPctVal)} = ${fmtCurrency(peMinimo)}\n\nPE Ideal = (Desp. Fixas + Invest. + Financ.) ÷ MC%\n= (${fmtCurrency(despesasFixas)} + ${fmtCurrency(investimentos)} + ${fmtCurrency(financeiro)}) ÷ ${fmtPct(mcPctVal)} = ${fmtCurrency(peIdeal)}\n\nGap Mínimo: ${fmtCurrency(fat)} - ${fmtCurrency(peMinimo)} = ${fmtCurrency(gapMinimo)}\nGap Ideal: ${fmtCurrency(fat)} - ${fmtCurrency(peIdeal)} = ${fmtCurrency(gapIdeal)}`,
      composicao: [
        { nome: 'Faturamento Atual', grupo: 'Referência', nivel: 'totalizador', valor: fat, pct_faturamento: 100 },
        { nome: 'MC%', grupo: 'Referência', nivel: 'totalizador', valor: mcPctVal, pct_faturamento: 0, pct: null },
        ...despSubs.map(s => ({ ...s, grupo: 'Despesas Fixas' })),
        { nome: 'Investimentos (total)', grupo: 'Saídas', nivel: 'totalizador', valor: investimentos, pct_faturamento: fat ? (investimentos / fat) * 100 : 0 },
        { nome: 'Financiamentos (total)', grupo: 'Saídas', nivel: 'totalizador', valor: financeiro, pct_faturamento: fat ? (financeiro / fat) * 100 : 0 },
        { nome: 'PE Mínimo', grupo: 'Ponto de Equilíbrio', nivel: 'totalizador', valor: peMinimo, pct_faturamento: fat ? (peMinimo / fat) * 100 : 0 },
        { nome: 'PE Ideal', grupo: 'Ponto de Equilíbrio', nivel: 'totalizador', valor: peIdeal, pct_faturamento: fat ? (peIdeal / fat) * 100 : 0 },
        { nome: 'Gap PE Mínimo', grupo: 'Gaps', nivel: 'totalizador', valor: gapMinimo, pct_faturamento: 0, pct: null },
        { nome: 'Gap PE Ideal', grupo: 'Gaps', nivel: 'totalizador', valor: gapIdeal, pct_faturamento: 0, pct: null },
      ],
      instrucao_especifica: 'Avalie a distância do faturamento atual em relação ao PE mínimo e ideal. Identifique qual despesa fixa mais eleva o ponto de equilíbrio. Se abaixo do PE ideal, calcule quanto de faturamento adicional seria necessário e sugira alavanca específica (reduzir despesa X ou aumentar canal Y).',
    });
  };

  /* ── card content helper ── */
  const cardValue = (val: number, isAbs: boolean, color: string) => (
    <div style={{ fontSize: 28, fontWeight: 800, fontFamily: "'Courier New', monospace", color }}>
      {hasData ? (isAbs ? fmtCurrency(val) : fmtPct(val)) : '—'}
    </div>
  );

  const cardBottom = (label: string, sparkData: number[], color: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
      <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? label : ''}</span>
      {hasData && <MiniSparkLine data={sparkData} color={color} />}
    </div>
  );

  return (
    <div style={{ marginBottom: 24 }}>

      {/* Linha 1 — DRE Operacional */}
      <div className="dre-header-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
        {/* 1. Faturamento */}
        <IndicatorCard index={0} color={BLUE} label="Faturamento" hasData={hasData} onClick={hasData ? handleFatClick : undefined}>
          {cardValue(animFat, true, BLUE)}
          {cardBottom(monthLabel, histFat, BLUE)}
        </IndicatorCard>

        {/* 2. Custos Operacionais */}
        <IndicatorCard index={1} color={custosColor} label="Custos Operacionais" hasData={hasData} onClick={hasData ? handleCustosClick : undefined}>
          {cardValue(animCustos, true, custosColor)}
          {cardBottom(`${fmtPct(custosVarPct)} fat. atual`, histCustos, custosColor)}
        </IndicatorCard>

        {/* 3. Margem de Contribuição */}
        <IndicatorCard index={2} color={mcColor} label="Margem de Contribuição" hasData={hasData} onClick={hasData ? handleMcClick : undefined}>
          {cardValue(animMcPct, false, mcColor)}
          {cardBottom(`${fmtCurrency(mc)} abs.`, histMC, mcColor)}
        </IndicatorCard>

        {/* 4. Despesas Fixas */}
        <IndicatorCard index={3} color={despColor} label="Despesas Fixas" hasData={hasData} onClick={hasData ? handleDespClick : undefined}>
          {cardValue(animDesp, true, despColor)}
          {cardBottom(`${fmtPct(despFixasPct)} fat. atual`, histDesp, despColor)}
        </IndicatorCard>

        {/* 5. Resultado Operacional */}
        <IndicatorCard index={4} color={roColor} label="Resultado Operacional" hasData={hasData} onClick={hasData ? handleRoClick : undefined}>
          {cardValue(animRoPct, false, roColor)}
          {cardBottom(`${fmtCurrency(ro)} abs.`, histRO, roColor)}
        </IndicatorCard>
      </div>

      {/* Linha 2 — Fluxo de Caixa e Equilíbrio */}
      <div className="dre-header-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginTop: 12 }}>
        {/* 6. Ativ. Investimento */}
        <IndicatorCard index={5} color={INVEST_BLUE} label="Ativ. Investimento" hasData={hasData} onClick={hasData ? handleInvestClick : undefined}>
          {cardValue(animInvest, true, INVEST_BLUE)}
          {cardBottom(`${fmtPct(investPct)} fat. atual`, histInvest, INVEST_BLUE)}
        </IndicatorCard>

        {/* 7. Ativ. Financiamento */}
        <IndicatorCard index={6} color={finColor} label="Ativ. Financiamento" hasData={hasData} onClick={hasData ? handleFinClick : undefined}>
          {cardValue(animFin, true, finColor)}
          {cardBottom(`${fmtPct(financeiroPct)} fat. atual`, histFin, finColor)}
        </IndicatorCard>

        {/* 8. Resultado após Invest. */}
        <IndicatorCard index={7} color={raiColor} label="Resultado após Invest." hasData={hasData} onClick={hasData ? handleRaiClick : undefined}>
          {cardValue(animRaiPct, false, raiColor)}
          {cardBottom(`${fmtCurrency(rai)} abs.`, histRAI, raiColor)}
        </IndicatorCard>

        {/* 9. Geração de Caixa */}
        <IndicatorCard index={8} color={gcColor} label="Geração de Caixa" hasData={hasData} onClick={hasData ? handleGcClick : undefined}>
          {cardValue(animGcPct, false, gcColor)}
          {cardBottom(`${fmtCurrency(gc)} abs.`, histGC, gcColor)}
        </IndicatorCard>

        {/* 10. Ponto de Equilíbrio */}
        <IndicatorCard index={9} color={peColor} label="Ponto de Equilíbrio" hasData={hasData} onClick={hasData ? handlePeClick : undefined}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#8A9BBC', marginBottom: 1 }}>Mínimo</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Courier New', monospace", color: '#0D1B35' }}>
                {hasData ? fmtCurrency(peMinimo) : '—'}
              </div>
              <div style={{ fontSize: 10, color: gapMinimo >= 0 ? '#00A86B' : '#DC2626', fontWeight: 500 }}>
                {hasData && <>{gapMinimo >= 0 ? '▲' : '▼'} {fmtCurrency(Math.abs(gapMinimo))}</>}
              </div>
            </div>
            <div style={{ width: 1, height: 36, background: '#DDE4F0', alignSelf: 'center' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: '#8A9BBC', marginBottom: 1 }}>Ideal</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Courier New', monospace", color: '#0D1B35' }}>
                {hasData ? fmtCurrency(peIdeal) : '—'}
              </div>
              <div style={{ fontSize: 10, color: gapIdeal >= 0 ? '#00A86B' : '#DC2626', fontWeight: 500 }}>
                {hasData && <>{gapIdeal >= 0 ? '▲' : '▼'} {fmtCurrency(Math.abs(gapIdeal))}</>}
              </div>
            </div>
          </div>
        </IndicatorCard>
      </div>

      {/* Responsive overrides */}
      <style>{`
        @media (max-width: 1200px) and (min-width: 768px) {
          .dre-header-grid { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 767px) {
          .dre-header-grid { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      <AnaliseDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} titulo={drawerTitulo} dados={drawerDados} />
    </div>
  );
}
