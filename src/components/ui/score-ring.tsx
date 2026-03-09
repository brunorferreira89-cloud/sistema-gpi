import { useEffect, useRef, useState } from 'react';

interface ScoreRingProps {
  score: number;
  size?: number;
}

export function ScoreRing({ score, size = 170 }: ScoreRingProps) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const mounted = useRef(false);

  const clamped = Math.max(0, Math.min(100, score));

  useEffect(() => {
    mounted.current = true;
    const delay = 200;
    const duration = 800;
    const timeout = setTimeout(() => {
      const start = performance.now();
      const animate = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        setAnimatedScore(Math.round(clamped * ease));
        if (t < 1 && mounted.current) requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    }, delay);
    return () => { mounted.current = false; clearTimeout(timeout); };
  }, [clamped]);

  const r = size * 0.4;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const fillLength = (animatedScore / 100) * circumference;

  const fillColor = clamped >= 70 ? '#00A86B' : clamped >= 40 ? '#D97706' : '#DC2626';

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} className="block">
        <g style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}>
          {/* Track */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={10}
          />
          {/* Fill */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={fillColor}
            strokeWidth={10}
            strokeDasharray={`${fillLength} ${circumference}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </g>
        {/* Center number */}
        <text
          x={cx} y={cy - 4}
          textAnchor="middle"
          dominantBaseline="central"
          className="font-mono-data"
          style={{ fontSize: size >= 120 ? 38 : 22, fontWeight: 800, fill: fillColor }}
        >
          {animatedScore}
        </text>
        <text
          x={cx} y={cy + (size >= 120 ? 20 : 14)}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: 10, fill: 'hsl(var(--txt-muted))', textTransform: 'uppercase', letterSpacing: '0.1em' }}
        >
          saúde
        </text>
      </svg>
    </div>
  );
}

/** Calculate health score from financial data */
export function calcHealthScore(values: {
  mc_pct: number | null;
  cmv_pct: number | null;
  cmo_pct: number | null;
  gc_pct: number | null;
  hasData: boolean;
}): number {
  let score = 100;
  const { mc_pct, cmv_pct, cmo_pct, gc_pct, hasData } = values;

  if (mc_pct != null) {
    if (mc_pct < 30) score -= 25;
    else if (mc_pct < 40) score -= 15;
  }
  if (cmv_pct != null) {
    if (cmv_pct > 42) score -= 15;
    else if (cmv_pct > 38) score -= 5;
  }
  if (cmo_pct != null) {
    if (cmo_pct > 30) score -= 15;
    else if (cmo_pct > 25) score -= 5;
  }
  if (gc_pct != null) {
    if (gc_pct < 0) score -= 20;
    else if (gc_pct < 7) score -= 10;
  }
  if (!hasData) score -= 10;

  return Math.max(0, Math.min(100, score));
}
