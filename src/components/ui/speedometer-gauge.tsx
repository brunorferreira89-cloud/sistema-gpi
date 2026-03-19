/**
 * Speedometer-style semicircular gauge (automotive dashboard style).
 */
interface SpeedometerGaugeProps {
  nome: string;
  pctAtingido: number;
  realizado: number;
  meta: number;
  tipo: string;
  fmtR$: (v: number) => string;
}

export function SpeedometerGauge({ nome, pctAtingido, realizado, meta, tipo, fmtR$ }: SpeedometerGaugeProps) {
  const isReceita = tipo === 'receita';
  const clamped = Math.max(0, Math.min(pctAtingido, 120));

  // Status
  let statusColor: string, statusLabel: string;
  if (!isReceita) {
    if (pctAtingido > 90) { statusColor = '#DC2626'; statusLabel = 'PRÓXIMO DO LIMITE'; }
    else if (pctAtingido > 70) { statusColor = '#D97706'; statusLabel = 'ATENÇÃO'; }
    else { statusColor = '#00A86B'; statusLabel = 'NO PLANO'; }
  } else {
    if (pctAtingido < 70) { statusColor = '#DC2626'; statusLabel = 'ABAIXO DA META'; }
    else if (pctAtingido < 90) { statusColor = '#D97706'; statusLabel = 'ATENÇÃO'; }
    else { statusColor = '#00A86B'; statusLabel = 'NO PLANO'; }
  }

  // SVG dimensions
  const w = 200, h = 120;
  const cx = 100, cy = 105;
  const r = 80;
  const strokeW = 12;

  // Arc from 180° (left) to 0° (right) = semicircle
  // Start angle: π (180°), End angle: 0°
  const startAngle = Math.PI;
  const endAngle = 0;
  const arcPath = (radius: number) => {
    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle);
    const y2 = cy + radius * Math.sin(endAngle);
    return `M ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2}`;
  };

  // Needle angle: -90° (0%) to +90° (100%), clamped to 120%
  const needleAngle = -90 + (Math.min(clamped, 100) / 100) * 180;
  const needleRad = (needleAngle * Math.PI) / 180;
  const needleLen = r - 12;
  const nx = cx + needleLen * Math.cos(needleRad);
  const ny = cy + needleLen * Math.sin(needleRad);

  // Scale marks
  const marks = [0, 20, 40, 60, 80, 100];

  return (
    <div style={{
      background: '#FFFFFF',
      border: '1px solid #DDE4F0',
      borderRadius: 14,
      padding: '16px 16px 12px',
      textAlign: 'center',
      transition: 'box-shadow 0.2s',
    }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(13,27,53,0.1)'; }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = 'none'; }}
    >
      {/* Name */}
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8A9BBC', marginBottom: 8 }}>{nome}</p>

      {/* Gauge SVG */}
      <svg width={w} height={h} style={{ display: 'block', margin: '0 auto' }}>
        <defs>
          <linearGradient id={`sg-grad-${nome.replace(/\s/g, '')}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#DC2626" />
            <stop offset="40%" stopColor="#D97706" />
            <stop offset="70%" stopColor="#00A86B" />
            <stop offset="100%" stopColor="#00A86B" />
          </linearGradient>
        </defs>

        {/* Track */}
        <path d={arcPath(r)} fill="none" stroke="#F0F4FA" strokeWidth={strokeW} strokeLinecap="round" />
        {/* Colored arc */}
        <path d={arcPath(r)} fill="none" stroke={`url(#sg-grad-${nome.replace(/\s/g, '')})`} strokeWidth={strokeW} strokeLinecap="round" />

        {/* Scale marks */}
        {marks.map(pct => {
          const angle = Math.PI - (pct / 100) * Math.PI;
          const inner = r + strokeW / 2 + 2;
          const outer = inner + 6;
          const x1 = cx + inner * Math.cos(angle);
          const y1 = cy + inner * Math.sin(angle);
          const x2 = cx + outer * Math.cos(angle);
          const y2 = cy + outer * Math.sin(angle);
          const tx = cx + (outer + 8) * Math.cos(angle);
          const ty = cy + (outer + 8) * Math.sin(angle);
          return (
            <g key={pct}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#8A9BBC" strokeWidth={1} opacity={0.5} />
              <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central" style={{ fontSize: 8, fill: '#8A9BBC', fontWeight: 500 }}>{pct}</text>
            </g>
          );
        })}

        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={nx} y2={ny}
          stroke="#0D1B35"
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ transition: 'all 0.8s cubic-bezier(0.16,1,0.3,1)' }}
        />
        {/* Needle tip */}
        <circle cx={nx} cy={ny} r={3} fill="#0D1B35" style={{ transition: 'all 0.8s cubic-bezier(0.16,1,0.3,1)' }} />
        {/* Center circle */}
        <circle cx={cx} cy={cy} r={6} fill="#0D1B35" />
        <circle cx={cx} cy={cy} r={3} fill="#DDE4F0" />
      </svg>

      {/* Percentage */}
      <p style={{ fontFamily: "'Courier New', monospace", fontWeight: 800, fontSize: 18, color: statusColor, marginTop: -2 }}>
        {pctAtingido.toFixed(1)}%
      </p>

      {/* Values */}
      <p style={{ fontSize: 10, color: '#4A5E80', marginTop: 2 }}>
        {fmtR$(realizado)} de {fmtR$(meta)}
      </p>

      {/* Status badge */}
      <span style={{
        display: 'inline-block',
        marginTop: 6,
        fontSize: 9,
        fontWeight: 700,
        color: statusColor,
        background: statusColor === '#00A86B' ? 'rgba(0,168,107,0.1)' : statusColor === '#D97706' ? 'rgba(217,119,6,0.1)' : 'rgba(220,38,38,0.08)',
        borderRadius: 10,
        padding: '3px 10px',
        letterSpacing: '0.06em',
      }}>
        {statusLabel}
      </span>
    </div>
  );
}
