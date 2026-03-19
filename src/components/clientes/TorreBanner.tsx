/**
 * Torre de Controle Banner — reusable cockpit banner (portal + internal).
 * Extracted from TorreControleTab.tsx layout.
 */
const keyframesCSS = `
@keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
@keyframes scanHorizontal { 0%{left:-30%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{left:110%;opacity:0} }
@keyframes scanHorizontal2 { 0%{left:-20%;opacity:0} 15%{opacity:0.6} 85%{opacity:0.6} 100%{left:115%;opacity:0} }
@keyframes floatUp { 0%{transform:translateY(0) scale(1);opacity:0} 8%{opacity:0.85} 70%{opacity:0.5} 100%{transform:translateY(-150px) scale(0.7);opacity:0} }
@keyframes floatDrift { 0%{transform:translate(0,0) scale(1);opacity:0} 10%{opacity:0.8} 75%{opacity:0.4} 100%{transform:translate(35px,-130px) scale(0.6);opacity:0} }
@keyframes glowPulse { 0%,100%{opacity:0.5;filter:drop-shadow(0 0 2px rgba(0,153,230,0.3))} 50%{opacity:1;filter:drop-shadow(0 0 8px rgba(0,153,230,0.8))} }
@keyframes dataPulse { 0%,100%{opacity:0.05} 50%{opacity:0.15} }
@keyframes radarSweep { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
@keyframes signalWave { 0%{r:8;opacity:0.6} 100%{r:28;opacity:0} }
`;

const DATA_PARTICLES = [
  { text: '3.2M', left: '12%', delay: '0s', dur: '3s', anim: 'floatUp' },
  { text: '+12%', left: '25%', delay: '0.8s', dur: '3.4s', anim: 'floatDrift' },
  { text: '847K', left: '38%', delay: '1.8s', dur: '2.8s', anim: 'floatUp' },
  { text: '−5.3%', left: '52%', delay: '0.4s', dur: '3.6s', anim: 'floatDrift' },
  { text: '1.4M', left: '65%', delay: '2.5s', dur: '2.9s', anim: 'floatUp' },
  { text: '+8.7%', left: '78%', delay: '1.2s', dur: '3.2s', anim: 'floatDrift' },
  { text: '92K', left: '45%', delay: '2.8s', dur: '3.5s', anim: 'floatUp' },
  { text: '◈', left: '88%', delay: '1.5s', dur: '4s', anim: 'floatDrift' },
  { text: '2.1M', left: '8%', delay: '2.2s', dur: '3.1s', anim: 'floatDrift' },
  { text: '+24%', left: '70%', delay: '0.2s', dur: '3.8s', anim: 'floatUp' },
];

const C_MONO = "'Courier New', monospace";

export function TorreBanner() {
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
            <defs><pattern id="torre-hud-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <line x1="0" y1="0" x2="40" y2="0" stroke="#1A3CFF" strokeWidth="0.5" />
              <line x1="0" y1="0" x2="0" y2="40" stroke="#1A3CFF" strokeWidth="0.5" />
            </pattern></defs>
            <rect width="100%" height="100%" fill="url(#torre-hud-grid)" />
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
          {DATA_PARTICLES.map((p, i) => (
            <span key={i} style={{
              position: 'absolute', bottom: 8, left: p.left,
              fontFamily: C_MONO, fontSize: 10, fontWeight: 600,
              color: p.text.startsWith('+') ? 'rgba(0,168,107,0.5)' : p.text.startsWith('−') ? 'rgba(220,38,38,0.4)' : 'rgba(0,153,230,0.4)',
              animation: `${p.anim} ${p.dur} ease-in-out ${p.delay} infinite`,
              letterSpacing: '0.04em',
            }}>
              {p.text}
            </span>
          ))}
        </div>
        {/* Radar pulse */}
        <div style={{ position: 'absolute', right: 100, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
          <div style={{ position: 'relative', width: 80, height: 80 }}>
            <div style={{ position: 'absolute', inset: 0, border: '1px solid rgba(0,153,230,0.15)', borderRadius: '50%', animation: 'dataPulse 2s ease infinite' }} />
            <div style={{ position: 'absolute', inset: 10, border: '1px solid rgba(26,60,255,0.2)', borderRadius: '50%', animation: 'dataPulse 2s ease 0.4s infinite' }} />
            <div style={{ position: 'absolute', inset: 20, border: '1px solid rgba(0,153,230,0.25)', borderRadius: '50%', animation: 'dataPulse 2s ease 0.8s infinite' }} />
            <div style={{ position: 'absolute', inset: 0, borderTop: '2px solid rgba(0,153,230,0.4)', borderRadius: '50%', animation: 'radarSweep 3s linear infinite' }} />
          </div>
        </div>
        {/* Second scan beam */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', width: '25%', height: '100%', background: 'linear-gradient(90deg, transparent, rgba(0,153,230,0.04), transparent)', animation: 'scanHorizontal2 12s linear infinite' }} />
        </div>
        {/* Tower SVG */}
        <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.75, filter: 'drop-shadow(0 0 24px rgba(26,60,255,0.7)) drop-shadow(0 0 50px rgba(0,153,230,0.4)) drop-shadow(0 0 80px rgba(0,212,255,0.15))' }}>
          <svg viewBox="0 0 220 150" style={{ width: 280, height: 175 }}>
            <ellipse cx="110" cy="142" rx="80" ry="6" fill="#1A3CFF" opacity="0.3" style={{ animation: 'glowPulse 3s ease infinite' }} />
            <defs>
              <linearGradient id="tb-body-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1A3CFF" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#0D1B35" stopOpacity="0.95" />
              </linearGradient>
              <linearGradient id="tb-glass-grad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#00D4FF" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#0099E6" stopOpacity="0.5" />
              </linearGradient>
              <radialGradient id="tb-antenna-glow" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#00D4FF" stopOpacity="1" />
                <stop offset="60%" stopColor="#0099E6" stopOpacity="0.6" />
                <stop offset="100%" stopColor="#0099E6" stopOpacity="0" />
              </radialGradient>
              <filter id="tb-glass-filter">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <polygon points="60,140 160,140 145,122 75,122" fill="url(#tb-body-grad)" />
            <polygon points="80,122 140,122 132,60 88,60" fill="url(#tb-body-grad)" />
            <line x1="82" y1="80" x2="138" y2="80" stroke="#0099E6" strokeWidth="0.5" opacity="0.25" />
            <line x1="83" y1="95" x2="137" y2="95" stroke="#0099E6" strokeWidth="0.5" opacity="0.2" />
            <line x1="84" y1="110" x2="136" y2="110" stroke="#0099E6" strokeWidth="0.5" opacity="0.15" />
            <line x1="85" y1="122" x2="70" y2="140" stroke="#0099E6" strokeWidth="1.2" opacity="0.35" />
            <line x1="135" y1="122" x2="150" y2="140" stroke="#0099E6" strokeWidth="1.2" opacity="0.35" />
            <rect x="72" y="36" width="76" height="26" rx="5" fill="#0D1B35" stroke="#1A3CFF" strokeWidth="2" />
            <g filter="url(#tb-glass-filter)">
              <rect x="78" y="40" width="14" height="18" rx="2" fill="url(#tb-glass-grad)" style={{ animation: 'glowPulse 2s ease infinite' }} />
              <rect x="96" y="40" width="14" height="18" rx="2" fill="url(#tb-glass-grad)" style={{ animation: 'glowPulse 2s ease 0.4s infinite' }} />
              <rect x="114" y="40" width="14" height="18" rx="2" fill="url(#tb-glass-grad)" style={{ animation: 'glowPulse 2s ease 0.8s infinite' }} />
            </g>
            <polygon points="68,36 152,36 144,26 76,26" fill="#1A3CFF" opacity="0.7" />
            <line x1="110" y1="26" x2="110" y2="4" stroke="#1A3CFF" strokeWidth="2.5" />
            <line x1="110" y1="12" x2="100" y2="20" stroke="#0099E6" strokeWidth="1" opacity="0.5" />
            <line x1="110" y1="12" x2="120" y2="20" stroke="#0099E6" strokeWidth="1" opacity="0.5" />
            <circle cx="110" cy="4" r="5" fill="url(#tb-antenna-glow)" style={{ animation: 'glowPulse 1.2s ease infinite' }} />
            <circle cx="110" cy="4" r="2" fill="#FFFFFF" opacity="0.9" style={{ animation: 'glowPulse 1.2s ease infinite' }} />
            <circle cx="110" cy="4" r="10" stroke="#00D4FF" strokeWidth="1" fill="none" opacity="0.5" style={{ animation: 'signalWave 2s ease-out infinite' }} />
            <circle cx="110" cy="4" r="10" stroke="#0099E6" strokeWidth="0.8" fill="none" opacity="0.4" style={{ animation: 'signalWave 2s ease-out 0.5s infinite' }} />
            <circle cx="110" cy="4" r="10" stroke="#0099E6" strokeWidth="0.6" fill="none" opacity="0.3" style={{ animation: 'signalWave 2s ease-out 1s infinite' }} />
            <circle cx="100" cy="75" r="2" fill="#00FF88" opacity="0.8" style={{ animation: 'glowPulse 3s ease infinite' }} />
            <circle cx="120" cy="85" r="2" fill="#FF4444" opacity="0.8" style={{ animation: 'glowPulse 3s ease 1s infinite' }} />
            <circle cx="100" cy="100" r="2" fill="#00FF88" opacity="0.8" style={{ animation: 'glowPulse 3s ease 2s infinite' }} />
            <circle cx="70" cy="49" r="2" fill="#FF4444" opacity="0.7" style={{ animation: 'glowPulse 1.8s ease infinite' }} />
            <circle cx="150" cy="49" r="2" fill="#00FF88" opacity="0.7" style={{ animation: 'glowPulse 1.8s ease 0.9s infinite' }} />
          </svg>
        </div>

        {/* Content */}
        <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '14px 24px 12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: '#0099E6', fontSize: 14 }}>◈</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: '#0099E6', letterSpacing: '0.22em' }}>GPI INTELIGÊNCIA FINANCEIRA</span>
            </div>
            <span style={{ fontSize: 9, fontWeight: 600, color: '#00A86B', background: 'rgba(0,168,107,0.12)', border: '1px solid rgba(0,168,107,0.25)', borderRadius: 6, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00A86B', animation: 'pulse 2s infinite', boxShadow: '0 0 6px rgba(0,168,107,0.8)' }} />
              OPERACIONAL
            </span>
          </div>
          <div>
            <h2 style={{ fontSize: 40, fontWeight: 800, color: '#FFFFFF', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.1, textShadow: '0 0 20px rgba(26,60,255,0.5), 0 0 40px rgba(26,60,255,0.2)' }}>Torre de Controle</h2>
            <p style={{ fontSize: 11, color: 'rgba(138,155,188,0.7)', margin: '4px 0 0', letterSpacing: '0.06em' }}>Monitoramento · Metas · Projeções</p>
          </div>
          <div />
        </div>
      </div>
    </>
  );
}
