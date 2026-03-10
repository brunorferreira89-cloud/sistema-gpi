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
    total += c.tipo === 'receita' ? v : -Math.abs(v);
  }
  return total;
}

function sumByTipo(leafs: ContaRow[], valMap: Record<string, number | null>, tipo: string): number {
  let total = 0;
  for (const c of leafs) {
    if (c.tipo !== tipo) continue;
    const v = valMap[c.id];
    if (v != null) total += Math.abs(v);
  }
  return total;
}

function getSubgroups(
  contas: ContaRow[], tipo: string,
  valMap: Record<string, number | null>,
  fat: number,
  prevMap?: Record<string, number | null>,
): { nome: string; grupo: string; nivel: string; valor: number; pct_faturamento: number; valor_anterior?: number; variacao_pct?: number; variacao_abs?: number }[] {
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
    const entry: any = {
      nome: s.nome,
      grupo: parent?.nome || tipo,
      nivel: 'subgrupo',
      valor: val,
      pct_faturamento: fat ? (val / fat) * 100 : 0,
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

/* ──────── sparkline SVG ──────── */
function MiniSparkLine({ data, color, w = 48, h = 20 }: { data: number[]; color: string; w?: number; h?: number }) {
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

/* ──────── mini arc gauge ──────── */
function MiniArcGauge({ value, color, size = 32 }: { value: number; color: string; size?: number }) {
  const r = size * 0.36;
  const cx = size / 2;
  const cy = size / 2;
  const sw = 4;
  const circ = 2 * Math.PI * r;
  const arcFrac = 0.5;
  const arcLen = circ * arcFrac;
  const gapLen = circ - arcLen;
  const clamped = Math.max(0, Math.min(100, Math.abs(value)));
  const fillLen = (clamped / 100) * arcLen;
  return (
    <svg width={size} height={size * 0.7}>
      <g transform={`rotate(180 ${cx} ${cy})`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={sw} strokeDasharray={`${arcLen} ${gapLen}`} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={sw} strokeDasharray={`${fillLen} ${circ - fillLen}`} strokeLinecap="round" />
      </g>
      <text x={cx} y={cy + 2} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 8, fontWeight: 800, fontFamily: "'Courier New', monospace", fill: color }}>
        {value.toFixed(1).replace('.', ',')}
      </text>
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
        border: '1px solid hsl(var(--border))',
        borderRadius: 16,
        padding: '16px 20px',
        position: 'relative',
        overflow: 'hidden',
        height: 88,
        opacity: visible ? 1 : 0,
        transform: visible ? (hovered ? 'translateY(-1px)' : 'translateY(0)') : 'translateY(8px)',
        transition: 'opacity 350ms cubic-bezier(0.16,1,0.3,1), transform 200ms ease, box-shadow 200ms ease',
        cursor: onClick ? 'pointer' : 'default',
        boxShadow: hovered && onClick ? '0 4px 16px #1A3CFF14' : 'none',
      }}
    >
      <div style={{ position: 'absolute', inset: 0, background: `radial-gradient(circle at 100% 0%, ${color}0F, transparent 70%)`, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, borderRadius: '16px 16px 0 0', background: color, width: `${lineWidth}%`, transition: 'width 400ms cubic-bezier(0.16,1,0.3,1)' }} />
      <div style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.08em', color: '#8A9BBC', fontWeight: 600, marginBottom: 4, position: 'relative' }}>{label}</div>
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}

/* ──────── main component ──────── */
export function DreIndicadoresHeader({ contas, valoresAnuais, months }: Props) {
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
  const latestMonth = monthsWithData[monthsWithData.length - 1];
  const prevMonth = monthsWithData.length >= 2 ? monthsWithData[monthsWithData.length - 2] : null;
  const last6 = monthsWithData.slice(-6);

  const currentMap = latestMonth ? getMonthMap(latestMonth.value) : {};
  const prevMap = prevMonth ? getMonthMap(prevMonth.value) : {};

  const fat = hasData ? calcIndicatorValue(leafs, currentMap, ['receita']) : 0;
  const fatPrev = prevMonth ? calcIndicatorValue(leafs, prevMap, ['receita']) : 0;
  const mc = hasData ? calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel']) : 0;
  const ro = hasData ? calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel', 'despesa_fixa']) : 0;
  const gc = hasData ? calcIndicatorValue(leafs, currentMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']) : 0;

  const mcPct = fat ? (mc / fat) * 100 : 0;
  const roPct = fat ? (ro / fat) * 100 : 0;
  const gcPct = fat ? (gc / fat) * 100 : 0;
  const tendPct = fatPrev ? ((fat - fatPrev) / Math.abs(fatPrev)) * 100 : 0;

  // Additional sums for PE
  const despesasFixas = hasData ? sumByTipo(leafs, currentMap, 'despesa_fixa') : 0;
  const investimentos = hasData ? sumByTipo(leafs, currentMap, 'investimento') : 0;
  const financeiro = hasData ? sumByTipo(leafs, currentMap, 'financeiro') : 0;
  const mcDecimal = fat ? mc / fat : 0;
  const peMinimo = mcDecimal ? despesasFixas / mcDecimal : 0;
  const peIdeal = mcDecimal ? (despesasFixas + investimentos + financeiro) / mcDecimal : 0;
  const gapMinimo = fat - peMinimo;
  const gapIdeal = fat - peIdeal;

  const histFat = last6.map(m => calcIndicatorValue(leafs, getMonthMap(m.value), ['receita']));
  const histMC = last6.map(m => { const mm = getMonthMap(m.value); const f = calcIndicatorValue(leafs, mm, ['receita']); const mcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel']); return f ? (mcV / f) * 100 : 0; });
  const histRO = last6.map(m => { const mm = getMonthMap(m.value); const f = calcIndicatorValue(leafs, mm, ['receita']); const roV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel', 'despesa_fixa']); return f ? (roV / f) * 100 : 0; });
  const histGC = last6.map(m => { const mm = getMonthMap(m.value); const f = calcIndicatorValue(leafs, mm, ['receita']); const gcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']); return f ? (gcV / f) * 100 : 0; });
  const histPE = last6.map(m => {
    const mm = getMonthMap(m.value);
    const f = calcIndicatorValue(leafs, mm, ['receita']);
    const mcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel']);
    const df = sumByTipo(leafs, mm, 'despesa_fixa');
    const mcD = f ? mcV / f : 0;
    return mcD ? df / mcD : 0;
  });

  const mcColor = statusColor(mcPct, [30, 40], 'higher_better');
  const roColor = statusColor(roPct, [5, 10], 'higher_better');
  const gcColor = statusColor(gcPct, [3, 10], 'higher_better');
  const tendColor = tendPct >= 0 ? '#00A86B' : '#DC2626';
  const peColor = gapMinimo >= 0 ? '#00A86B' : '#DC2626';

  const animFat = useAnimatedNumber(hasData ? fat : 0, 600, 0);
  const animMcPct = useAnimatedNumber(hasData ? mcPct : 0, 600, 60);
  const animRoPct = useAnimatedNumber(hasData ? roPct : 0, 600, 120);
  const animGcPct = useAnimatedNumber(hasData ? gcPct : 0, 600, 180);
  const animTend = useAnimatedNumber(hasData ? tendPct : 0, 600, 240);

  const monthLabel = latestMonth ? new Date(latestMonth.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '') : '';
  const monthLabelFull = latestMonth ? new Date(latestMonth.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
  const prevMonthLabel = prevMonth ? new Date(prevMonth.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '') : '';
  const prevMonthLabelFull = prevMonth ? new Date(prevMonth.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';

  const histLabels = last6.map(m => m.shortLabel);

  const barData = last6.map((m, i) => ({ mes: m.shortLabel, valor: histFat[i], isLast: i === last6.length - 1 }));
  const lineData = last6.map((m, i) => ({ mes: m.shortLabel, gc: histGC[i] }));

  const [chartsVisible, setChartsVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setChartsVisible(true), 300); return () => clearTimeout(t); }, []);

  const openDrawer = (titulo: string, dados: AnaliseDrawerDados) => {
    setDrawerTitulo(titulo);
    setDrawerDados(dados);
    setDrawerOpen(true);
  };

  const handleFatClick = () => {
    if (!hasData) return;
    openDrawer('Faturamento', {
      indicador: 'Faturamento', valor_atual: 100, valor_absoluto: fat, faturamento: fat,
      mes_referencia: monthLabelFull, status: 'verde', limite_verde: 0, limite_ambar: 0,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histFat[i] })),
      formula: 'Faturamento = Soma de todas as Receitas Operacionais',
      composicao: getSubgroups(contas, 'receita', currentMap),
    });
  };

  const handleMcClick = () => {
    if (!hasData) return;
    openDrawer('Margem de Contribuição', {
      indicador: 'Margem de Contribuição', valor_atual: mcPct, valor_absoluto: mc, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(mcColor), limite_verde: 40, limite_ambar: 30,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histMC[i] })),
      formula: 'MC = Faturamento - Custos Variáveis',
      composicao: getSubgroups(contas, 'custo_variavel', currentMap),
    });
  };

  const handleRoClick = () => {
    if (!hasData) return;
    openDrawer('Resultado Operacional', {
      indicador: 'Resultado Operacional', valor_atual: roPct, valor_absoluto: ro, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(roColor), limite_verde: 10, limite_ambar: 5,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histRO[i] })),
      formula: 'RO = MC - Despesas Fixas',
      composicao: getSubgroups(contas, 'despesa_fixa', currentMap),
    });
  };

  const handleGcClick = () => {
    if (!hasData) return;
    openDrawer('Geração de Caixa', {
      indicador: 'Geração de Caixa', valor_atual: gcPct, valor_absoluto: gc, faturamento: fat,
      mes_referencia: monthLabelFull, status: statusLabel(gcColor), limite_verde: 10, limite_ambar: 3,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histGC[i] })),
      formula: 'GC = RO - Investimentos +/- Financiamentos',
      composicao: [
        ...getSubgroups(contas, 'investimento', currentMap),
        ...getSubgroups(contas, 'financeiro', currentMap),
      ],
    });
  };

  const handleTendClick = () => {
    if (!hasData || !prevMonth) return;
    openDrawer('Tendência Faturamento', {
      indicador: 'Tendência Faturamento', valor_atual: tendPct, valor_absoluto: fat - fatPrev, faturamento: fat,
      mes_referencia: monthLabelFull, status: tendPct >= 0 ? 'verde' : 'vermelho', limite_verde: 5, limite_ambar: 0,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histFat[i] })),
      formula: 'Tendência = (Mês Atual - Mês Anterior) / Mês Anterior × 100',
      composicao: [
        { nome: prevMonthLabelFull, valor: fatPrev },
        { nome: monthLabelFull, valor: fat },
      ],
    });
  };

  const handlePeClick = () => {
    if (!hasData) return;
    const mcPctVal = mcDecimal * 100;
    openDrawer('Ponto de Equilíbrio', {
      indicador: 'Ponto de Equilíbrio', valor_atual: peMinimo ? (fat / peMinimo) * 100 : 0, valor_absoluto: peMinimo, faturamento: fat,
      mes_referencia: monthLabelFull, status: gapMinimo >= 0 ? 'verde' : 'vermelho', limite_verde: 100, limite_ambar: 90,
      direcao: 'maior_melhor',
      historico: last6.map((m, i) => ({ mes: m.shortLabel, valor: histPE[i] })),
      formula: `PE Mínimo = Despesas Fixas ÷ MC%\n= ${fmtCurrency(despesasFixas)} ÷ ${mcPctVal.toFixed(1)}% = ${fmtCurrency(peMinimo)}\n\nPE Ideal = (Desp. Fixas + Invest. + Financ.) ÷ MC%\n= (${fmtCurrency(despesasFixas)} + ${fmtCurrency(investimentos)} + ${fmtCurrency(financeiro)}) ÷ ${mcPctVal.toFixed(1)}% = ${fmtCurrency(peIdeal)}`,
      composicao: [
        { nome: 'Despesas Fixas', valor: despesasFixas },
        { nome: 'Investimentos', valor: investimentos },
        { nome: 'Financiamentos', valor: financeiro },
        { nome: 'MC%', valor: mcPctVal },
        { nome: 'Faturamento Atual', valor: fat },
      ],
    });
  };

  return (
    <div style={{ marginBottom: 24 }}>
      {hasData && (
        <div style={{ fontSize: 11, color: '#8A9BBC', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          Referência: {monthLabel}
        </div>
      )}

      {/* 5 indicator cards */}
      <div className="grid gap-3 dre-header-cards" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <IndicatorCard index={0} color={BLUE} label="Faturamento" hasData={hasData} onClick={hasData ? handleFatClick : undefined}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: BLUE }}>
            {hasData ? fmtCurrency(animFat) : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? monthLabel : ''}</span>
            {hasData && <MiniSparkLine data={histFat} color={BLUE} />}
          </div>
        </IndicatorCard>

        <IndicatorCard index={1} color={mcColor} label="Margem de Contribuição" hasData={hasData} onClick={hasData ? handleMcClick : undefined}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: mcColor }}>
            {hasData ? fmtPct(animMcPct) : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? `${fmtCurrency(mc)} abs.` : ''}</span>
            {hasData && <MiniSparkLine data={histMC} color={mcColor} />}
          </div>
        </IndicatorCard>

        <IndicatorCard index={2} color={roColor} label="Resultado Operacional" hasData={hasData} onClick={hasData ? handleRoClick : undefined}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: roColor }}>
            {hasData ? fmtPct(animRoPct) : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? `${fmtCurrency(ro)} abs.` : ''}</span>
            {hasData && <MiniSparkLine data={histRO} color={roColor} />}
          </div>
        </IndicatorCard>

        <IndicatorCard index={3} color={gcColor} label="Geração de Caixa" hasData={hasData} onClick={hasData ? handleGcClick : undefined}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: gcColor }}>
            {hasData ? fmtPct(animGcPct) : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? `${fmtCurrency(gc)} abs.` : ''}</span>
            {hasData && <MiniArcGauge value={gcPct} color={gcColor} />}
          </div>
        </IndicatorCard>

        <IndicatorCard index={4} color={tendColor} label="Tendência Faturamento" hasData={hasData} onClick={hasData ? handleTendClick : undefined}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: tendColor }}>
            {hasData ? `${tendPct >= 0 ? '▲' : '▼'} ${tendPct >= 0 ? '+' : ''}${animTend.toFixed(1).replace('.', ',')}%` : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData && prevMonth ? `vs ${prevMonthLabel}` : ''}</span>
            {hasData && prevMonth && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 20 }}>
                <div style={{ width: 4, borderRadius: 2, background: '#C4CFEA', height: Math.max(4, (fatPrev / Math.max(fat, fatPrev, 1)) * 20) }} />
                <div style={{ width: 4, borderRadius: 2, background: BLUE, height: Math.max(4, (fat / Math.max(fat, fatPrev, 1)) * 20) }} />
              </div>
            )}
          </div>
        </IndicatorCard>
      </div>

      {/* Ponto de Equilíbrio card */}
      {hasData && (
        <div className="grid gap-3 mt-3 dre-pe-card" style={{ gridTemplateColumns: '1fr' }}>
          <IndicatorCard index={5} color={peColor} label="Ponto de Equilíbrio" hasData={hasData} onClick={handlePeClick}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0, height: 44 }}>
              {/* Mínimo */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#8A9BBC', marginBottom: 2 }}>Mínimo</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Courier New', monospace", color: '#0D1B35' }}>
                  {fmtCurrency(peMinimo)}
                </div>
                <div style={{ fontSize: 11, color: gapMinimo >= 0 ? '#00A86B' : '#DC2626', fontWeight: 500 }}>
                  {gapMinimo >= 0 ? '▲' : '▼'} {fmtCurrency(Math.abs(gapMinimo))} {gapMinimo >= 0 ? 'acima' : 'abaixo'}
                </div>
              </div>
              {/* Divider */}
              <div style={{ width: 1, height: 40, background: '#DDE4F0', margin: '0 16px', alignSelf: 'center' }} />
              {/* Ideal */}
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 10, color: '#8A9BBC', marginBottom: 2 }}>Ideal</div>
                <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'Courier New', monospace", color: '#0D1B35' }}>
                  {fmtCurrency(peIdeal)}
                </div>
                <div style={{ fontSize: 11, color: gapIdeal >= 0 ? '#00A86B' : '#DC2626', fontWeight: 500 }}>
                  {gapIdeal >= 0 ? '▲' : '▼'} {fmtCurrency(Math.abs(gapIdeal))} {gapIdeal >= 0 ? 'acima' : 'abaixo'}
                </div>
              </div>
            </div>
          </IndicatorCard>
        </div>
      )}

      {/* 2 mini charts */}
      <div className="hidden md:grid gap-3 mt-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div style={{
          background: '#FFFFFF', border: '1px solid hsl(var(--border))', borderRadius: 16,
          padding: '16px 20px', height: 140,
          opacity: chartsVisible ? 1 : 0, transform: chartsVisible ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 350ms cubic-bezier(0.16,1,0.3,1) 300ms, transform 350ms cubic-bezier(0.16,1,0.3,1) 300ms',
        }}>
          <div style={{ textTransform: 'uppercase', fontSize: 10, color: '#8A9BBC', fontWeight: 600, letterSpacing: '0.08em' }}>Receita Mensal</div>
          <div style={{ fontSize: 11, color: '#4A5E80', marginBottom: 4 }}>últimos {last6.length} meses</div>
          {!hasData ? (
            <div style={{ textAlign: 'center', color: '#8A9BBC', fontSize: 12, marginTop: 20 }}>Importe dados para visualizar</div>
          ) : (
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={barData} margin={{ top: 12, right: 4, left: 4, bottom: 0 }}>
                <XAxis dataKey="mes" tick={{ fontSize: 9, fill: '#8A9BBC' }} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v: number) => [fmtCurrency(v), 'Receita']} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #DDE4F0' }} />
                <Bar dataKey="valor" radius={[4, 4, 0, 0]} animationDuration={500}>
                  {barData.map((entry, i) => (<Cell key={i} fill={BLUE} fillOpacity={entry.isLast ? 1 : 0.3} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div style={{
          background: '#FFFFFF', border: '1px solid hsl(var(--border))', borderRadius: 16,
          padding: '16px 20px', height: 140,
          opacity: chartsVisible ? 1 : 0, transform: chartsVisible ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 350ms cubic-bezier(0.16,1,0.3,1) 360ms, transform 350ms cubic-bezier(0.16,1,0.3,1) 360ms',
        }}>
          <div style={{ textTransform: 'uppercase', fontSize: 10, color: '#8A9BBC', fontWeight: 600, letterSpacing: '0.08em' }}>Geração de Caixa</div>
          <div style={{ fontSize: 11, color: '#4A5E80', marginBottom: 4 }}>% sobre faturamento · últimos {last6.length} meses</div>
          {!hasData ? (
            <div style={{ textAlign: 'center', color: '#8A9BBC', fontSize: 12, marginTop: 20 }}>Importe dados para visualizar</div>
          ) : (
            <ResponsiveContainer width="100%" height={80}>
              <ComposedChart data={lineData} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="gcFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={gcColor} stopOpacity={0.08} />
                    <stop offset="100%" stopColor={gcColor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="mes" tick={{ fontSize: 9, fill: '#8A9BBC' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 9, fill: '#8A9BBC' }} axisLine={false} tickLine={false} width={24} domain={['auto', 'auto']} />
                <ReferenceLine y={10} stroke="#00A86B" strokeDasharray="4 4" strokeOpacity={0.4} label={{ value: 'meta 10%', fontSize: 9, fill: '#00A86B', position: 'right' }} />
                <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, 'GC']} contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #DDE4F0' }} />
                <Area type="monotone" dataKey="gc" stroke="none" fill="url(#gcFill)" />
                <Line type="monotone" dataKey="gc" stroke={gcColor} strokeWidth={2} dot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: gcColor }} activeDot={{ r: 6 }} animationDuration={600} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Responsive overrides */}
      <style>{`
        @media (max-width: 1200px) and (min-width: 768px) {
          .dre-header-cards { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 767px) {
          .dre-header-cards { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>

      <AnaliseDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} titulo={drawerTitulo} dados={drawerDados} />
    </div>
  );
}
