import { useMemo } from 'react';

const keyframesCSS = `
@keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
@keyframes scanHorizontal { 0%{left:-30%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{left:110%;opacity:0} }
@keyframes floatUp { 0%{transform:translateY(0) scale(1);opacity:0} 8%{opacity:0.85} 70%{opacity:0.5} 100%{transform:translateY(-150px) scale(0.7);opacity:0} }
@keyframes floatDrift { 0%{transform:translate(0,0) scale(1);opacity:0} 10%{opacity:0.8} 75%{opacity:0.4} 100%{transform:translate(35px,-130px) scale(0.6);opacity:0} }
@keyframes glowPulse { 0%,100%{opacity:0.5;filter:drop-shadow(0 0 2px rgba(0,153,230,0.3))} 50%{opacity:1;filter:drop-shadow(0 0 8px rgba(0,153,230,0.8))} }
@keyframes dataPulse { 0%,100%{opacity:0.05} 50%{opacity:0.15} }
`;

const fmtShort = (v: number): string => {
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return v.toFixed(0);
};

interface Props {
  faturamento?: number | null;
  mcPct?: number | null;
  gcPct?: number | null;
}

export function DreBanner({ faturamento, mcPct, gcPct }: Props) {
  const particles = useMemo(() => {
    const fat = faturamento != null ? fmtShort(faturamento) : '--';
    const mc = mcPct != null ? `${mcPct >= 0 ? '+' : ''}${mcPct.toFixed(1)}%` : '--';
    const gc = gcPct != null ? `${gcPct >= 0 ? '+' : ''}${gcPct.toFixed(1)}%` : '--';
    return [
      { text: fat, left: '12%', delay: '0s', dur: '3s', anim: 'floatUp' },
      { text: mc, left: '25%', delay: '0.8s', dur: '3.4s', anim: 'floatDrift' },
      { text: gc, left: '38%', delay: '1.8s', dur: '2.8s', anim: 'floatUp' },
      { text: '◈', left: '52%', delay: '0.4s', dur: '3.6s', anim: 'floatDrift' },
      { text: fat, left: '65%', delay: '2.5s', dur: '2.9s', anim: 'floatUp' },
      { text: mc, left: '78%', delay: '1.2s', dur: '3.2s', anim: 'floatDrift' },
      { text: gc, left: '45%', delay: '2.8s', dur: '3.5s', anim: 'floatUp' },
      { text: '◈', left: '88%', delay: '1.5s', dur: '4s', anim: 'floatDrift' },
      { text: fat, left: '8%', delay: '2.2s', dur: '3.1s', anim: 'floatDrift' },
      { text: mc, left: '70%', delay: '0.2s', dur: '3.8s', anim: 'floatUp' },
    ];
  }, [faturamento, mcPct, gcPct]);

  return (
    <>
      <style>{keyframesCSS}</style>
      <div style={{
        width: '100%', height: 170, position: 'relative', overflow: 'hidden',
        borderRadius: 12,
        background: 'linear-gradient(135deg, #0A1628 0%, #0D1B35 50%, #0A1628 100%)',
      }}>
        {/* HUD grid */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.08, pointerEvents: 'none' }}>
          <svg width="100%" height="100%">
            <defs><pattern id="dre-hud-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="40" y2="0" stroke="#1A3CFF" strokeWidth="0.5" />
              <line x1="0" y1="0" x2="0" y2="40" stroke="#1A3CFF" strokeWidth="0.5" />
            </pattern></defs>
            <rect width="100%" height="100%" fill="url(#dre-hud-grid)" />
          </svg>
        </div>
        {/* Blue glow */}
        <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 80% at 30% 50%, rgba(26,60,255,0.18) 0%, rgba(0,153,230,0.08) 40%, transparent 70%)', pointerEvents: 'none' }} />
        {/* Scan beam */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: '30%',
            background: 'linear-gradient(90deg, transparent, rgba(26,60,255,0.08), rgba(0,153,230,0.12), rgba(26,60,255,0.08), transparent)',
            animation: 'scanHorizontal 3s ease-in-out infinite',
          }} />
        </div>
        {/* Floating particles */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          {particles.map((p, i) => (
            <span key={i} style={{
              position: 'absolute', bottom: 8, left: p.left,
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10, fontWeight: 600,
              color: p.text.startsWith('+') ? 'rgba(0,168,107,0.5)' : p.text.startsWith('-') || p.text.startsWith('−') ? 'rgba(220,38,38,0.4)' : 'rgba(0,153,230,0.4)',
              animation: `${p.anim} ${p.dur} ease-in-out ${p.delay} infinite`,
              letterSpacing: '0.04em',
            }}>
              {p.text}
            </span>
          ))}
        </div>
        {/* DRE chart SVG illustration (right side) */}
        <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.12 }}>
          <svg viewBox="0 0 220 150" style={{ width: 280, height: 175 }}>
            {/* Bar chart columns */}
            <rect x="30" y="100" width="18" height="40" rx="2" fill="#1A3CFF" />
            <rect x="55" y="70" width="18" height="70" rx="2" fill="#0099E6" />
            <rect x="80" y="85" width="18" height="55" rx="2" fill="#1A3CFF" />
            <rect x="105" y="50" width="18" height="90" rx="2" fill="#0099E6" />
            <rect x="130" y="65" width="18" height="75" rx="2" fill="#1A3CFF" />
            <rect x="155" y="40" width="18" height="100" rx="2" fill="#0099E6" />
            {/* Trend lines */}
            <polyline points="39,95 64,65 89,78 114,45 139,58 164,35" fill="none" stroke="#00D4FF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            <polyline points="39,105 64,90 89,95 114,72 139,80 164,60" fill="none" stroke="#1A3CFF" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4,3" />
            {/* Baseline */}
            <line x1="25" y1="140" x2="180" y2="140" stroke="#0099E6" strokeWidth="1" opacity="0.4" />
            {/* Grid lines */}
            <line x1="25" y1="40" x2="180" y2="40" stroke="#0099E6" strokeWidth="0.3" opacity="0.3" />
            <line x1="25" y1="70" x2="180" y2="70" stroke="#0099E6" strokeWidth="0.3" opacity="0.3" />
            <line x1="25" y1="100" x2="180" y2="100" stroke="#0099E6" strokeWidth="0.3" opacity="0.3" />
          </svg>
        </div>
        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '14px 24px 12px' }}>
          {/* Top row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#0099E6', fontSize: 14 }}>◈</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.2em' }}>GPI INTELIGÊNCIA FINANCEIRA</span>
            </div>
            <span style={{ fontSize: 9, fontWeight: 600, color: '#00A86B', background: 'rgba(0,168,107,0.12)', border: '1px solid rgba(0,168,107,0.25)', borderRadius: 6, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00A86B', animation: 'pulse 2s infinite', boxShadow: '0 0 6px rgba(0,168,107,0.8)' }} />
              OPERACIONAL
            </span>
          </div>
          {/* Title */}
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#FFFFFF', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.1 }}>DRE Financeira</h2>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', margin: '4px 0 0', letterSpacing: '0.06em' }}>Demonstrativo de Resultado · Análise Gerencial</p>
          </div>
          {/* Bottom spacer */}
          <div />
        </div>
      </div>
    </>
  );
}
