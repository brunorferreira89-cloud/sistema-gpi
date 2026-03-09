interface SparkLineProps {
  values: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function SparkLine({ values, color = 'hsl(var(--primary))', width = 56, height = 20 }: SparkLineProps) {
  if (!values.length) return <div style={{ width, height }} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 2;

  const points = values
    .map((v, i) => {
      const x = padding + (i / (values.length - 1 || 1)) * (width - padding * 2);
      const y = height - padding - ((v - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function getBenchmarkColor(indicator: string, value: number): string {
  switch (indicator) {
    case 'cmv':
      if (value < 38) return 'hsl(var(--green))';
      if (value <= 42) return 'hsl(var(--amber))';
      return 'hsl(var(--red))';
    case 'cmo':
      if (value < 25) return 'hsl(var(--green))';
      if (value <= 30) return 'hsl(var(--amber))';
      return 'hsl(var(--red))';
    case 'margem_contribuicao':
      if (value > 40) return 'hsl(var(--green))';
      if (value >= 35) return 'hsl(var(--amber))';
      return 'hsl(var(--red))';
    case 'geracao_caixa':
      if (value > 10) return 'hsl(var(--green))';
      if (value >= 7) return 'hsl(var(--amber))';
      return 'hsl(var(--red))';
    default:
      return 'hsl(var(--primary))';
  }
}
