interface SparkLineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export function SparkLine({ data, color = 'hsl(var(--primary))', width = 56, height = 20 }: SparkLineProps) {
  if (!data.length) return <div style={{ width, height }} />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pad = 3;

  const points = data
    .map((v, i) => {
      const x = pad + (i / (data.length - 1 || 1)) * (width - pad * 2);
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const lastX = pad + ((data.length - 1) / (data.length - 1 || 1)) * (width - pad * 2);
  const lastY = height - pad - ((data[data.length - 1] - min) / range) * (height - pad * 2);

  const totalLength = 200;

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={totalLength}
        strokeDashoffset={0}
        style={{
          animation: 'sparkDraw 0.8s ease-out forwards',
        }}
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill={color} />
    </svg>
  );
}
