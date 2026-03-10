import { useMemo, useEffect, useRef, useState } from 'react';
import { BarChart, Bar, ComposedChart, Line, Area, XAxis, YAxis, ReferenceLine, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatCurrency } from '@/lib/plano-contas-utils';
import type { ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas } from '@/lib/dre-indicadores';

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
function IndicatorCard({ index, color, label, children, hasData }: {
  index: number; color: string; label: string; hasData: boolean; children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [lineWidth, setLineWidth] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setVisible(true), index * 60);
    const t2 = setTimeout(() => setLineWidth(100), index * 60 + 100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [index]);

  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid hsl(var(--border))',
      borderRadius: 16,
      padding: '16px 20px',
      position: 'relative',
      overflow: 'hidden',
      height: 88,
      opacity: visible ? 1 : 0,
      transform: visible ? 'translateY(0)' : 'translateY(8px)',
      transition: 'opacity 350ms cubic-bezier(0.16,1,0.3,1), transform 350ms cubic-bezier(0.16,1,0.3,1)',
    }}>
      {/* Radial gradient bg */}
      <div style={{
        position: 'absolute', inset: 0,
        background: `radial-gradient(circle at 100% 0%, ${color}0F, transparent 70%)`,
        pointerEvents: 'none',
      }} />
      {/* Top line */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        borderRadius: '16px 16px 0 0',
        background: color,
        width: `${lineWidth}%`,
        transition: 'width 400ms cubic-bezier(0.16,1,0.3,1)',
      }} />
      {/* Label */}
      <div style={{ textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.08em', color: '#8A9BBC', fontWeight: 600, marginBottom: 4, position: 'relative' }}>
        {label}
      </div>
      {/* Content */}
      <div style={{ position: 'relative' }}>
        {children}
      </div>
    </div>
  );
}

/* ──────── main component ──────── */
export function DreIndicadoresHeader({ contas, valoresAnuais, months }: Props) {
  const leafs = useMemo(() => getLeafContas(contas), [contas]);

  // Build per-month maps
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

  // Find months with data
  const monthsWithData = useMemo(() => {
    return months.filter(m => {
      return valoresAnuais?.some(v => v.competencia === m.value && v.valor_realizado != null);
    });
  }, [months, valoresAnuais]);

  const hasData = monthsWithData.length > 0;
  const latestMonth = monthsWithData[monthsWithData.length - 1];
  const prevMonth = monthsWithData.length >= 2 ? monthsWithData[monthsWithData.length - 2] : null;
  const last6 = monthsWithData.slice(-6);

  // Current month calculations
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

  // History arrays
  const histFat = last6.map(m => {
    const mm = getMonthMap(m.value);
    return calcIndicatorValue(leafs, mm, ['receita']);
  });
  const histMC = last6.map(m => {
    const mm = getMonthMap(m.value);
    const f = calcIndicatorValue(leafs, mm, ['receita']);
    const mcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel']);
    return f ? (mcV / f) * 100 : 0;
  });
  const histRO = last6.map(m => {
    const mm = getMonthMap(m.value);
    const f = calcIndicatorValue(leafs, mm, ['receita']);
    const roV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel', 'despesa_fixa']);
    return f ? (roV / f) * 100 : 0;
  });
  const histGC = last6.map(m => {
    const mm = getMonthMap(m.value);
    const f = calcIndicatorValue(leafs, mm, ['receita']);
    const gcV = calcIndicatorValue(leafs, mm, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);
    return f ? (gcV / f) * 100 : 0;
  });

  // Status colors
  const mcColor = statusColor(mcPct, [30, 40], 'higher_better');
  const roColor = statusColor(roPct, [5, 10], 'higher_better');
  const gcColor = statusColor(gcPct, [3, 10], 'higher_better');
  const tendColor = tendPct >= 0 ? '#00A86B' : '#DC2626';

  // Animated values
  const animFat = useAnimatedNumber(hasData ? fat : 0, 600, 0);
  const animMcPct = useAnimatedNumber(hasData ? mcPct : 0, 600, 60);
  const animRoPct = useAnimatedNumber(hasData ? roPct : 0, 600, 120);
  const animGcPct = useAnimatedNumber(hasData ? gcPct : 0, 600, 180);
  const animTend = useAnimatedNumber(hasData ? tendPct : 0, 600, 240);

  // Month label
  const monthLabel = latestMonth
    ? new Date(latestMonth.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')
    : '';
  const prevMonthLabel = prevMonth
    ? new Date(prevMonth.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')
    : '';

  // Bar chart data
  const barData = last6.map((m, i) => ({
    mes: m.shortLabel,
    valor: histFat[i],
    isLast: i === last6.length - 1,
  }));

  // Line chart data
  const lineData = last6.map((m, i) => ({
    mes: m.shortLabel,
    gc: histGC[i],
  }));

  const [chartsVisible, setChartsVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setChartsVisible(true), 300);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{ marginBottom: 24 }}>
      {/* Month reference */}
      {hasData && (
        <div style={{ fontSize: 11, color: '#8A9BBC', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
          Referência: {monthLabel}
        </div>
      )}

      {/* 5 indicator cards */}
      <div className="grid gap-3 dre-header-cards" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        {/* FATURAMENTO */}
        <IndicatorCard index={0} color={BLUE} label="Faturamento" hasData={hasData}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: BLUE }}>
            {hasData ? fmtCurrency(animFat) : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? monthLabel : ''}</span>
            {hasData && <MiniSparkLine data={histFat} color={BLUE} />}
          </div>
        </IndicatorCard>

        {/* MC */}
        <IndicatorCard index={1} color={mcColor} label="Margem de Contribuição" hasData={hasData}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: mcColor }}>
            {hasData ? fmtPct(animMcPct) : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? `${fmtCurrency(mc)} abs.` : ''}</span>
            {hasData && <MiniSparkLine data={histMC} color={mcColor} />}
          </div>
        </IndicatorCard>

        {/* RO */}
        <IndicatorCard index={2} color={roColor} label="Resultado Operacional" hasData={hasData}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: roColor }}>
            {hasData ? fmtPct(animRoPct) : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? `${fmtCurrency(ro)} abs.` : ''}</span>
            {hasData && <MiniSparkLine data={histRO} color={roColor} />}
          </div>
        </IndicatorCard>

        {/* GC */}
        <IndicatorCard index={3} color={gcColor} label="Geração de Caixa" hasData={hasData}>
          <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'Courier New', monospace", color: gcColor }}>
            {hasData ? fmtPct(animGcPct) : '—'}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC' }}>{hasData ? `${fmtCurrency(gc)} abs.` : ''}</span>
            {hasData && <MiniArcGauge value={gcPct} color={gcColor} />}
          </div>
        </IndicatorCard>

        {/* TENDÊNCIA */}
        <IndicatorCard index={4} color={tendColor} label="Tendência Faturamento" hasData={hasData}>
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

      {/* 2 mini charts - hidden on mobile */}
      <div className="hidden md:grid gap-3 mt-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* BAR CHART - Receita Mensal */}
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
                <Tooltip
                  formatter={(v: number) => [fmtCurrency(v), 'Receita']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #DDE4F0' }}
                />
                <Bar dataKey="valor" radius={[4, 4, 0, 0]} animationDuration={500}>
                  {barData.map((entry, i) => (
                    <Cell key={i} fill={BLUE} fillOpacity={entry.isLast ? 1 : 0.3} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* LINE CHART - Geração de Caixa */}
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
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(1)}%`, 'GC']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #DDE4F0' }}
                />
                <Area type="monotone" dataKey="gc" stroke="none" fill="url(#gcFill)" />
                <Line
                  type="monotone"
                  dataKey="gc"
                  stroke={gcColor}
                  strokeWidth={2}
                  dot={{ r: 4, stroke: '#fff', strokeWidth: 2, fill: gcColor }}
                  activeDot={{ r: 6 }}
                  animationDuration={600}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Responsive overrides for tablet: 3+2 grid */}
      <style>{`
        @media (max-width: 1200px) and (min-width: 768px) {
          .dre-header-cards { grid-template-columns: repeat(3, 1fr) !important; }
        }
        @media (max-width: 767px) {
          .dre-header-cards { grid-template-columns: repeat(2, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
