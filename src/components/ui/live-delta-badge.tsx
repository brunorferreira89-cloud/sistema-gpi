interface LiveDeltaBadgeProps {
  realizado: number;
  meta: number;
}

export function LiveDeltaBadge({ realizado, meta }: LiveDeltaBadgeProps) {
  if (!meta) return null;
  const delta = ((realizado - meta) / Math.abs(meta)) * 100;
  const positive = delta >= 0;
  const formatted = `${positive ? '+' : ''}${delta.toFixed(1).replace('.', ',')}%`;

  return (
    <span
      className={positive ? '' : ''}
      style={{
        fontSize: 10,
        fontWeight: 700,
        border: `1px solid ${positive ? 'hsl(var(--green))' : 'hsl(var(--amber))'}`,
        borderRadius: 5,
        padding: '2px 7px',
        color: positive ? 'hsl(var(--green))' : 'hsl(var(--amber))',
        backgroundColor: positive ? 'hsl(var(--green) / 0.1)' : 'hsl(var(--amber) / 0.1)',
        animation: positive ? 'none' : 'pulseDelta 2s ease-in-out infinite',
        display: 'inline-block',
      }}
    >
      {formatted}
    </span>
  );
}
