import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const navigate = useNavigate();
  const { session, profile } = useAuth();

  useEffect(() => {
    if (session && profile) {
      if (profile.role === 'cliente') {
        navigate('/cliente', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [session, profile, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError('E-mail ou senha incorretos. Tente novamente.');
      setIsLoading(false);
    }
  };

  return (
    <div className="login-split-root">
      <style>{`
        /* ===== KEYFRAMES ===== */
        @keyframes gridPulse { 0%,100%{opacity:.7} 50%{opacity:1} }
        @keyframes glow1Move { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(30px,20px) scale(1.1)} }
        @keyframes glow2Move { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(-20px,-30px) scale(1.15)} }
        @keyframes glow3Move { 0%,100%{transform:translate(0,0) scale(1)} 50%{transform:translate(15px,-15px) scale(1.05)} }
        @keyframes radarSweep { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes plane1 {
          0%{transform:translate(-80px,500px) rotate(-25deg);opacity:0}
          5%{opacity:1} 90%{opacity:1}
          100%{transform:translate(900px,-100px) rotate(-25deg);opacity:0}
        }
        @keyframes plane2 {
          0%{transform:translate(-60px,0) rotate(-15deg);opacity:0}
          5%{opacity:1} 90%{opacity:1}
          100%{transform:translate(900px,-140px) rotate(-15deg);opacity:0}
        }
        @keyframes plane3 {
          0%{transform:translate(-40px,30px) rotate(-8deg);opacity:0}
          5%{opacity:1} 90%{opacity:1}
          100%{transform:translate(900px,-20px) rotate(-8deg);opacity:0}
        }
        @keyframes floatUp {
          0%{opacity:0;transform:translateY(0)} 
          15%{opacity:1} 
          100%{opacity:0;transform:translateY(-160px)}
        }
        @keyframes dotFloat {
          0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)}
        }
        @keyframes pulseBlip { 0%,100%{transform:scale(1)} 50%{transform:scale(1.3)} }
        @keyframes slideInLeft {
          from{opacity:0;transform:translateX(-20px)} to{opacity:1;transform:translateX(0)}
        }
        @keyframes borderGlow { 0%,100%{opacity:.6} 50%{opacity:1} }
        @keyframes fadeDown { from{opacity:0;transform:translateY(-12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes shimmer { 0%{left:-100%} 100%{left:100%} }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }

        /* ===== ROOT ===== */
        .login-split-root {
          display:flex; min-height:100vh; overflow:hidden;
          background:#04091A; font-family:'DM Sans',system-ui,sans-serif;
        }

        /* ===== LEFT PANEL ===== */
        .login-left {
          flex:1; position:relative; overflow:hidden; display:flex; flex-direction:column; justify-content:center;
        }
        .login-left .hud-grid {
          position:absolute;inset:0;
          background-image:linear-gradient(rgba(26,60,255,0.12) 1px,transparent 1px),linear-gradient(90deg,rgba(26,60,255,0.12) 1px,transparent 1px);
          background-size:52px 52px;
          animation:gridPulse 4s ease-in-out infinite;
        }
        .login-left .scanlines {
          position:absolute;inset:0;
          background:repeating-linear-gradient(0deg,transparent,transparent 3px,rgba(0,0,0,0.08) 3px,rgba(0,0,0,0.08) 4px);
          pointer-events:none;
        }
        .glow-orb{position:absolute;border-radius:50%;pointer-events:none}
        .glow-orb-1{top:-10%;left:-10%;width:500px;height:500px;background:radial-gradient(circle,rgba(26,60,255,0.22),transparent 70%);animation:glow1Move 8s ease-in-out infinite}
        .glow-orb-2{bottom:-20%;right:10%;width:400px;height:400px;background:radial-gradient(circle,rgba(0,153,230,0.15),transparent 70%);animation:glow2Move 10s ease-in-out infinite}
        .glow-orb-3{top:50%;left:40%;width:350px;height:350px;background:radial-gradient(circle,rgba(0,168,107,0.10),transparent 70%);animation:glow3Move 12s ease-in-out infinite}

        /* Radar */
        .radar-container{position:absolute;bottom:40px;right:40px;width:200px;height:200px;opacity:.18}
        .radar-ring{position:absolute;border-radius:50%;border:1px solid rgba(26,60,255,0.6)}
        .radar-ring:nth-child(1){inset:0}
        .radar-ring:nth-child(2){inset:20px}
        .radar-ring:nth-child(3){inset:40px}
        .radar-ring:nth-child(4){inset:60px}
        .radar-ring:nth-child(5){inset:80px}
        .radar-sweep{position:absolute;top:50%;left:50%;width:50%;height:2px;transform-origin:0 50%;background:linear-gradient(90deg,rgba(26,60,255,0.8),transparent);animation:radarSweep 3s linear infinite}
        .radar-blip{position:absolute;width:5px;height:5px;border-radius:50%;background:rgba(26,60,255,0.9);box-shadow:0 0 6px rgba(26,60,255,0.8)}

        /* Planes */
        .plane{position:absolute;pointer-events:none}
        .plane-1{font-size:22px;color:rgba(26,60,255,0.9);filter:drop-shadow(0 0 8px rgba(26,60,255,0.9)) drop-shadow(0 0 16px rgba(26,60,255,0.5));animation:plane1 18s linear infinite;top:0;left:0}
        .plane-2{font-size:16px;color:rgba(0,153,230,0.9);filter:drop-shadow(0 0 6px rgba(0,153,230,0.9));animation:plane2 12s linear infinite;animation-delay:4s;top:55%;left:0;opacity:0}
        .plane-3{font-size:12px;color:rgba(0,168,107,0.9);filter:drop-shadow(0 0 5px rgba(0,168,107,0.9));animation:plane3 22s linear infinite;animation-delay:8s;top:20%;left:0;opacity:0}

        /* Particles */
        .num-particle{position:absolute;font-family:'Courier New',monospace;font-size:13px;font-weight:700;pointer-events:none;animation:floatUp 9s linear infinite}

        /* Dots */
        .lum-dot{position:absolute;border-radius:50%;pointer-events:none;animation:dotFloat 6s ease-in-out infinite}

        /* Ghost chart */
        .ghost-chart{position:absolute;bottom:60px;right:0;opacity:.06;pointer-events:none}

        /* Flight trails */
        .flight-trails{position:absolute;inset:0;opacity:.15;pointer-events:none}

        /* Left content */
        .left-content{position:relative;z-index:2;padding:60px}
        .badge-pill{
          display:inline-flex;align-items:center;gap:8px;
          background:rgba(26,60,255,0.18);border:1px solid rgba(26,60,255,0.40);
          backdrop-filter:blur(4px);border-radius:999px;padding:6px 16px;margin-bottom:24px;
        }
        .badge-pill .pulse-dot{
          width:8px;height:8px;border-radius:50%;background:#1A3CFF;
          box-shadow:0 0 10px rgba(26,60,255,1);animation:pulseBlip 1.8s ease-in-out infinite;
        }
        .badge-pill span{font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:.18em;font-weight:600}
        .left-content h1{font-size:52px;font-weight:800;color:#fff;line-height:1.1;margin:0 0 16px}
        .left-content h1 .glow-text{color:#1A3CFF;text-shadow:0 0 20px rgba(26,60,255,0.5),0 0 40px rgba(26,60,255,0.3)}
        .left-content .subtitle{font-size:15px;color:rgba(255,255,255,0.45);max-width:400px;margin-bottom:32px;line-height:1.5}

        /* Metric cards */
        .metric-cards{display:flex;flex-direction:column;gap:10px;max-width:400px}
        .metric-card{
          display:flex;align-items:center;justify-content:space-between;
          background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
          border-radius:14px;padding:14px 18px;backdrop-filter:blur(8px);
          transition:all .3s ease;cursor:default;
        }
        .metric-card:nth-child(1){animation:slideInLeft .5s ease-out .2s both}
        .metric-card:nth-child(2){animation:slideInLeft .5s ease-out .4s both}
        .metric-card:nth-child(3){animation:slideInLeft .5s ease-out .6s both}
        .metric-card:hover{transform:translateX(4px);border-color:rgba(26,60,255,0.40);box-shadow:0 0 20px rgba(26,60,255,0.15)}
        .metric-card .mc-left{display:flex;align-items:center;gap:10px}
        .metric-card .mc-icon{font-size:20px}
        .metric-card .mc-label{font-size:13px;color:rgba(255,255,255,0.65);font-weight:500}
        .metric-card .mc-badge{font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;text-transform:uppercase;letter-spacing:.05em}
        .mc-badge.amber{background:rgba(217,119,6,0.2);color:#F59E0B}
        .mc-badge.red{background:rgba(220,38,38,0.2);color:#EF4444}

        /* ===== RIGHT PANEL ===== */
        .login-right{
          width:460px;background:#FFFFFF;position:relative;display:flex;flex-direction:column;justify-content:center;
          padding:60px 52px;
          box-shadow:-32px 0 100px rgba(0,0,0,0.45),-4px 0 0 rgba(26,60,255,0.15);
        }
        .login-right::before{
          content:'';position:absolute;left:0;top:15%;bottom:15%;width:2px;
          background:linear-gradient(to bottom,transparent,rgba(26,60,255,0.5) 30%,rgba(0,153,230,0.5) 70%,transparent);
          animation:borderGlow 3s ease-in-out infinite;
        }

        /* Logo */
        .login-logo{display:flex;align-items:center;gap:12px;margin-bottom:32px;animation:fadeDown .5s ease-out}
        .login-logo-icon{
          width:40px;height:40px;border-radius:12px;position:relative;overflow:hidden;
          background:linear-gradient(135deg,#1A3CFF,#0099E6);
          box-shadow:0 6px 20px rgba(26,60,255,0.40);
          display:flex;align-items:center;justify-content:center;
          color:#fff;font-weight:800;font-size:14px;
        }
        .login-logo-icon::after{
          content:'';position:absolute;top:-4px;left:-4px;width:20px;height:20px;
          background:rgba(255,255,255,0.25);border-radius:50%;filter:blur(4px);
        }
        .login-logo-text .logo-name{font-size:18px;font-weight:800;color:#0D1B35;line-height:1}
        .login-logo-text .logo-sub{font-size:9px;color:#8A9BBC;text-transform:uppercase;letter-spacing:.12em;font-weight:600}

        .login-right h2{font-size:28px;font-weight:800;color:#0D1B35;margin:0 0 6px;animation:fadeUp .5s ease-out .1s both}
        .login-right .form-subtitle{font-size:14px;color:#8A9BBC;margin-bottom:28px;animation:fadeUp .5s ease-out .2s both}

        /* Form fields */
        .login-field{margin-bottom:18px}
        .login-field label{display:block;font-size:13px;font-weight:600;color:#4A5E80;margin-bottom:6px}
        .login-field input{
          width:100%;padding:11px 14px;border:1.5px solid #DDE4F0;border-radius:10px;
          font-size:14px;background:#FAFCFF;color:#0D1B35;outline:none;
          transition:border-color .2s,box-shadow .2s;font-family:inherit;
        }
        .login-field input:focus{border-color:#1A3CFF;box-shadow:0 0 0 3px rgba(26,60,255,0.10)}
        .login-field input::placeholder{color:#A0AECB}

        .password-header{display:flex;justify-content:space-between;align-items:center}
        .forgot-link{font-size:12px;color:#1A3CFF;cursor:pointer;font-weight:500;background:none;border:none;padding:0}
        .forgot-link:hover{text-decoration:underline}

        .forgot-box{
          background:rgba(26,60,255,0.06);border:1px solid rgba(26,60,255,0.20);
          border-radius:10px;padding:12px 14px;margin-top:10px;
          font-size:13px;color:#4A5E80;line-height:1.5;
          animation:fadeIn .3s ease-out;
        }

        .login-error{font-size:13px;color:#DC2626;font-weight:500;margin-bottom:12px}

        /* Submit button */
        .login-submit{
          position:relative;overflow:hidden;width:100%;padding:13px;border:none;border-radius:12px;
          background:linear-gradient(135deg,#1A3CFF,#0099E6);color:#fff;
          font-size:15px;font-weight:700;cursor:pointer;
          box-shadow:0 6px 24px rgba(26,60,255,0.35);
          transition:transform .2s,box-shadow .2s;font-family:inherit;
        }
        .login-submit:hover{transform:translateY(-2px);box-shadow:0 10px 32px rgba(26,60,255,0.45)}
        .login-submit:disabled{opacity:.7;cursor:not-allowed;transform:none}
        .login-submit::after{
          content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;
          background:linear-gradient(90deg,transparent,rgba(255,255,255,0.25),transparent);
          transition:none;
        }
        .login-submit:hover::after{animation:shimmer .8s ease-in-out}

        .security-badge{text-align:center;font-size:12px;color:#8A9BBC;margin-top:18px}

        .login-footer{
          position:absolute;bottom:24px;left:52px;right:52px;text-align:center;
        }
        .login-footer p{font-size:12px;color:#A0AECB;margin:0;line-height:1.6}

        /* ===== RESPONSIVE ===== */
        @media(max-width:900px){
          .login-left{display:none!important}
          .login-right{width:100%;padding:40px 32px;box-shadow:none}
          .login-right::before{display:none}
          .login-footer{left:32px;right:32px}
        }
      `}</style>

      {/* ===== LEFT PANEL ===== */}
      <div className="login-left">
        <div className="hud-grid" />
        <div className="scanlines" />
        <div className="glow-orb glow-orb-1" />
        <div className="glow-orb glow-orb-2" />
        <div className="glow-orb glow-orb-3" />

        {/* Radar */}
        <div className="radar-container">
          <div className="radar-ring" /><div className="radar-ring" /><div className="radar-ring" /><div className="radar-ring" /><div className="radar-ring" />
          <div className="radar-sweep" />
          <div className="radar-blip" style={{ top: '30%', left: '60%' }} />
          <div className="radar-blip" style={{ top: '55%', left: '35%' }} />
          <div className="radar-blip" style={{ top: '70%', left: '72%' }} />
        </div>

        {/* Flight trails SVG */}
        <svg className="flight-trails" viewBox="0 0 800 600" preserveAspectRatio="none">
          <path d="M0,500 Q200,400 400,300 T800,100" fill="none" stroke="rgba(26,60,255,0.6)" strokeWidth="1.5" strokeDasharray="8,6">
            <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="18s" repeatCount="indefinite" />
          </path>
          <path d="M0,350 Q300,300 500,200 T800,150" fill="none" stroke="rgba(0,153,230,0.45)" strokeWidth="1" strokeDasharray="5,8">
            <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="12s" begin="4s" repeatCount="indefinite" />
          </path>
          <path d="M0,150 Q250,120 450,80 T800,50" fill="none" stroke="rgba(0,168,107,0.35)" strokeWidth="0.8" strokeDasharray="4,9">
            <animate attributeName="stroke-dashoffset" from="1000" to="0" dur="22s" begin="8s" repeatCount="indefinite" />
          </path>
          <circle cx="400" cy="300" r="3" fill="rgba(26,60,255,0.5)" />
          <circle cx="200" cy="400" r="2.5" fill="rgba(0,153,230,0.4)" />
          <circle cx="600" cy="150" r="2.5" fill="rgba(26,60,255,0.4)" />
          <circle cx="300" cy="200" r="2" fill="rgba(0,168,107,0.35)" />
          <circle cx="500" cy="250" r="2" fill="rgba(0,153,230,0.35)" />
        </svg>

        {/* Planes */}
        <span className="plane plane-1">✈</span>
        <span className="plane plane-2">✈</span>
        <span className="plane plane-3">✈</span>

        {/* Numeric particles */}
        {[
          { text: '+R$18.4k', color: '#00A86B', top: '70%', left: '15%', delay: '0s' },
          { text: '−4,2%', color: '#EF4444', top: '60%', left: '55%', delay: '1.5s' },
          { text: 'GC+9%', color: '#1A3CFF', top: '75%', left: '70%', delay: '3s' },
          { text: 'R$284k', color: '#F59E0B', top: '80%', left: '35%', delay: '4.5s' },
          { text: '▲28%', color: '#00A86B', top: '65%', left: '80%', delay: '6s' },
          { text: 'MC 48%', color: '#1A3CFF', top: '85%', left: '50%', delay: '7s' },
          { text: '⚡ META', color: '#F59E0B', top: '55%', left: '25%', delay: '2s' },
        ].map((p, i) => (
          <span key={i} className="num-particle" style={{ top: p.top, left: p.left, color: p.color, animationDelay: p.delay }}>
            {p.text}
          </span>
        ))}

        {/* Luminous dots */}
        {[
          { size: 4, color: 'rgba(26,60,255,0.8)', shadow: '0 0 8px rgba(26,60,255,0.6)', top: '25%', left: '30%', delay: '0s' },
          { size: 3, color: 'rgba(0,153,230,0.8)', shadow: '0 0 6px rgba(0,153,230,0.5)', top: '40%', left: '65%', delay: '1s' },
          { size: 5, color: 'rgba(0,168,107,0.7)', shadow: '0 0 10px rgba(0,168,107,0.5)', top: '70%', left: '45%', delay: '2s' },
          { size: 3, color: 'rgba(26,60,255,0.6)', shadow: '0 0 6px rgba(26,60,255,0.4)', top: '15%', left: '75%', delay: '3s' },
          { size: 4, color: 'rgba(0,153,230,0.7)', shadow: '0 0 8px rgba(0,153,230,0.5)', top: '85%', left: '20%', delay: '4s' },
        ].map((d, i) => (
          <div key={i} className="lum-dot" style={{ width: d.size, height: d.size, background: d.color, boxShadow: d.shadow, top: d.top, left: d.left, animationDelay: d.delay }} />
        ))}

        {/* Ghost chart */}
        <svg className="ghost-chart" width="280" height="140" viewBox="0 0 280 140">
          <rect x="20" y="80" width="30" height="50" fill="white" rx="4" />
          <rect x="65" y="50" width="30" height="80" fill="white" rx="4" />
          <rect x="110" y="30" width="30" height="100" fill="white" rx="4" />
          <rect x="155" y="60" width="30" height="70" fill="white" rx="4" />
          <rect x="200" y="20" width="30" height="110" fill="white" rx="4" />
          <polyline points="35,75 80,45 125,25 170,55 215,15" fill="none" stroke="white" strokeWidth="2" />
          <circle cx="35" cy="75" r="3" fill="white" />
          <circle cx="80" cy="45" r="3" fill="white" />
          <circle cx="125" cy="25" r="3" fill="white" />
          <circle cx="170" cy="55" r="3" fill="white" />
          <circle cx="215" cy="15" r="3" fill="white" />
        </svg>

        {/* Content */}
        <div className="left-content">
          <div className="badge-pill">
            <div className="pulse-dot" />
            <span>PORTAL FINANCEIRO EXCLUSIVO</span>
          </div>
          <h1>
            Seus números,<br />
            <span className="glow-text">seu controle.</span>
          </h1>
          <p className="subtitle">
            Acompanhe seus indicadores financeiros em tempo real, receba alertas inteligentes e tome decisões com base em dados.
          </p>
          <div className="metric-cards">
            <div className="metric-card">
              <div className="mc-left">
                <span className="mc-icon">📊</span>
                <span className="mc-label">Resultado Operacional · Fev/26</span>
              </div>
              <span className="mc-badge amber">ATENÇÃO</span>
            </div>
            <div className="metric-card">
              <div className="mc-left">
                <span className="mc-icon">💰</span>
                <span className="mc-label">Geração de Caixa · Fev/26</span>
              </div>
              <span className="mc-badge red">CRÍTICO</span>
            </div>
            <div className="metric-card">
              <div className="mc-left">
                <span className="mc-icon">🎯</span>
                <span className="mc-label">Meta CMV · Mar/26</span>
              </div>
              <span className="mc-badge amber">EM ROTA</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== RIGHT PANEL ===== */}
      <div className="login-right">
        <div className="login-logo">
          <div className="login-logo-icon">GPI</div>
          <div className="login-logo-text">
            <div className="logo-name">GPI</div>
            <div className="logo-sub">INTELIGÊNCIA FINANCEIRA</div>
          </div>
        </div>

        <h2>Bem-vindo de volta</h2>
        <p className="form-subtitle">Acesse seu painel financeiro exclusivo</p>

        <form onSubmit={handleLogin}>
          <div className="login-field">
            <label htmlFor="email">E-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
            />
          </div>

          <div className="login-field">
            <div className="password-header">
              <label htmlFor="password">Senha</label>
              <button type="button" className="forgot-link" onClick={() => setShowForgot(!showForgot)}>
                Esqueci minha senha
              </button>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            {showForgot && (
              <div className="forgot-box">
                ℹ️ Para redefinir sua senha, entre em contato com seu consultor GPI pelo WhatsApp ou e-mail. Ele irá gerar um novo acesso para você.
              </div>
            )}
          </div>

          {error && <p className="login-error">{error}</p>}

          <button type="submit" className="login-submit" disabled={isLoading}>
            {isLoading ? 'Entrando...' : 'Acessar meu painel →'}
          </button>
        </form>

        <p className="security-badge">🔒 Conexão segura · dados criptografados</p>

        <div className="login-footer">
          <p>Problemas para acessar? Fale com seu consultor</p>
          <p>© 2026 GPI Inteligência Financeira</p>
        </div>
      </div>
    </div>
  );
}
