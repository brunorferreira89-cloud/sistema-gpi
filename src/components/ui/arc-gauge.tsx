import { useEffect, useRef, useState } from 'react';

interface ArcGaugeProps {
  value: number;
  benchmark: number;
  color: string;
  label: string;
  size?: number;
}

export function ArcGauge({ value, benchmark, color, label, size = 130 }: ArcGaugeProps) {
  const [animatedValue, setAnimatedValue] = useState(0);
  const [animatedNumber, setAnimatedNumber] = useState(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const duration = 900;
    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setAnimatedValue(value * ease);
      setAnimatedNumber(Math.round(value * ease * 10) / 10);
      if (t < 1 && mounted.current) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    return () => { mounted.current = false; };
  }, [value]);

  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 7;
  const circumference = 2 * Math.PI * r;
  const arcFraction = 0.75; // 270° out of 360°
  const arcLength = circumference * arcFraction;
  const gapLength = circumference - arcLength;

  // Fill based on value (0-100 range assumed percentage)
  const clampedValue = Math.max(0, Math.min(100, animatedValue));
  const fillLength = (clampedValue / 100) * arcLength;
  const fillOffset = arcLength - fillLength;

  // Benchmark tick angle: map benchmark (0-100) to arc angle
  const benchmarkAngle = -225 + (benchmark / 100) * 270;
  const benchmarkRad = (benchmarkAngle * Math.PI) / 180;
  const tickInner = r - 8;
  const tickOuter = r + 8;
  const tx1 = cx + tickInner * Math.cos(benchmarkRad);
  const ty1 = cy + tickInner * Math.sin(benchmarkRad);
  const tx2 = cx + tickOuter * Math.cos(benchmarkRad);
  const ty2 = cy + tickOuter * Math.sin(benchmarkRad);

  const isOk = value >= benchmark;
  const fontSize = size * 0.19;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} className="block">
        <g transform={`rotate(135 ${cx} ${cy})`}>
          {/* Track */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${gapLength}`}
            strokeLinecap="round"
          />
          {/* Fill */}
          <circle
            cx={cx} cy={cy} r={r}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${fillLength} ${circumference - fillLength}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.16,1,0.3,1)' }}
          />
        </g>
        {/* Benchmark tick */}
        <line
          x1={tx1} y1={ty1} x2={tx2} y2={ty2}
          stroke="hsl(var(--primary))"
          strokeWidth={2.5}
          opacity={0.7}
          strokeLinecap="round"
        />
        {/* Center text */}
        <text
          x={cx} y={cy - 2}
          textAnchor="middle"
          dominantBaseline="central"
          className="font-mono-data"
          style={{ fontSize, fontWeight: 800, fill: color }}
        >
          {animatedNumber.toFixed(1)}%
        </text>
        <text
          x={cx} y={cy + fontSize * 0.7}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ fontSize: 9, fill: 'hsl(var(--txt-muted))' }}
        >
          {isOk ? '✓ ok' : '⚠'}
        </text>
      </svg>
      <span className="text-[11px] font-bold text-txt">{label}</span>
      <span className="text-[9px] text-txt-muted">ref: {benchmark}%</span>
    </div>
  );
}
