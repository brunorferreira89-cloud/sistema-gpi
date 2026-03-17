import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchKpiData } from '@/lib/kpi-utils';
import { fetchMergedIndicadores, calcularIndicadores, calcScore } from '@/lib/kpi-indicadores-utils';
import { TrendingUp, TrendingDown, Calendar, MessageCircle, Bell, CheckCircle, AlertTriangle, Info, ArrowRight, RefreshCw, LogOut, ChevronDown, ChevronUp, Play } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import gpiLogo from '@/assets/gpi-logo-dark.png';

function getCompetenciaAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function getCompetenciaAnterior(comp: string) {
  const d = new Date(comp + 'T00:00:00');
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

function fmtMesAno(comp: string) {
  const meses = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
  const d = new Date(comp + 'T00:00:00');
  return `${meses[d.getMonth()]}/${d.getFullYear()}`;
}

function fmtMesAnoLong(comp: string) {
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const d = new Date(comp + 'T00:00:00');
  return `${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function fmtR$(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

interface EmpresaOption {
  cliente_id: string;
  nome_empresa: string;
  razao_social: string | null;
  empresa_padrao: boolean;
}

interface ClientePortalPageProps {
  clienteId?: string;
  espelho?: boolean;
}

const STATUS_CONFIG = {
  verde: { label: '✓ ok', color: '#00A86B', bg: 'rgba(0,168,107,0.08)' },
  ambar: { label: '⚠ atenção', color: '#D97706', bg: 'rgba(217,119,6,0.08)' },
  vermelho: { label: '✕ crítico', color: '#DC2626', bg: 'rgba(220,38,38,0.08)' },
};

export default function ClientePortalPage({ clienteId: propClienteId, espelho }: ClientePortalPageProps = {}) {
  const { profile, signOut } = useAuth();

  // Competências liberadas state
  const [competenciasLiberadas, setCompetenciasLiberadas] = useState<string[]>([]);
  const [competenciaSelecionada, setCompetenciaSelecionada] = useState<string | null>(null);
  const [loadingCompetencias, setLoadingCompetencias] = useState(false);
  // Multi-empresa state
  const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState<string | null>(null);
  const [loadingEmpresas, setLoadingEmpresas] = useState(!propClienteId);
  const [noAccess, setNoAccess] = useState(false);

  // Dashboard state
  const [cliente, setCliente] = useState<any>(null);
  const [kpi, setKpi] = useState<any>(null);
  const [kpiAnterior, setKpiAnterior] = useState<any>(null);
  const [indicadoresCalc, setIndicadoresCalc] = useState<any[]>([]);
  const [score, setScore] = useState<number | null>(null);
  const [alertas, setAlertas] = useState<any[]>([]);
  const [proximaReuniao, setProximaReuniao] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [alertasOpen, setAlertasOpen] = useState(true);
  const [hasApresentacao, setHasApresentacao] = useState(false);
  const navigate = useNavigate();

  // If prop clienteId (espelho mode), skip empresa selection
  const resolvedClienteId = propClienteId || clienteIdSelecionado;

  // Load empresas for the logged-in user
  useEffect(() => {
    if (propClienteId) return;
    if (!profile?.id) return;

    const loadEmpresas = async () => {
      setLoadingEmpresas(true);
      try {
        const { data: links, error } = await supabase
          .from('portal_usuario_clientes' as any)
          .select('cliente_id, empresa_padrao')
          .eq('usuario_id', profile.id)
          .eq('ativo', true);

        if (error) throw error;

        if (links && (links as any[]).length > 0) {
          const clienteIds = (links as any[]).map((l: any) => l.cliente_id);
          const { data: clientes } = await supabase
            .from('clientes')
            .select('id, nome_empresa, razao_social')
            .in('id', clienteIds);

          const empresasList: EmpresaOption[] = (clientes || []).map((c) => {
            const link = (links as any[]).find((l: any) => l.cliente_id === c.id);
            return {
              cliente_id: c.id,
              nome_empresa: c.nome_empresa,
              razao_social: c.razao_social,
              empresa_padrao: link?.empresa_padrao ?? false,
            };
          });

          empresasList.sort((a, b) => {
            if (a.empresa_padrao && !b.empresa_padrao) return -1;
            if (!a.empresa_padrao && b.empresa_padrao) return 1;
            return (a.razao_social || a.nome_empresa).localeCompare(b.razao_social || b.nome_empresa);
          });

          setEmpresas(empresasList);

          if (empresasList.length === 1) {
            setClienteIdSelecionado(empresasList[0].cliente_id);
          }
        } else {
          if (profile.cliente_id) {
            setClienteIdSelecionado(profile.cliente_id as string);
            setEmpresas([]);
          } else {
            setNoAccess(true);
          }
        }
      } catch {
        if (profile.cliente_id) {
          setClienteIdSelecionado(profile.cliente_id as string);
        } else {
          setNoAccess(true);
        }
      } finally {
        setLoadingEmpresas(false);
      }
    };

    loadEmpresas();
  }, [propClienteId, profile?.id, profile?.cliente_id]);

  // Load competencias liberadas and dashboard data when clienteId is resolved
  useEffect(() => {
    if (!resolvedClienteId) return;
    const clienteId = resolvedClienteId;

    const load = async () => {
      setLoading(true);
      setLoadingCompetencias(true);
      try {
        const { data: cli } = await supabase
          .from('clientes')
          .select('*')
          .eq('id', clienteId)
          .single();
        setCliente(cli);

        // Fetch competencias liberadas (skip for espelho mode — show all)
        let compDisp: string[] = [];
        if (!espelho) {
          const { data: mesesLiberados } = await supabase
            .from('competencias_liberadas' as any)
            .select('competencia')
            .eq('cliente_id', clienteId)
            .eq('status', 'liberado')
            .order('competencia', { ascending: false });
          compDisp = (mesesLiberados || []).map((m: any) => m.competencia);
          setCompetenciasLiberadas(compDisp);
        } else {
          compDisp = [getCompetenciaAtual()];
          setCompetenciasLiberadas(compDisp);
        }

        setLoadingCompetencias(false);

        if (compDisp.length === 0 && !espelho) {
          setLoading(false);
          return;
        }

        const competencia = competenciaSelecionada && compDisp.includes(competenciaSelecionada)
          ? competenciaSelecionada
          : compDisp.length > 0 ? compDisp[0] : getCompetenciaAtual();

        setCompetenciaSelecionada(competencia);

        const [kpiCurr, kpiPrev] = await Promise.all([
          fetchKpiData(clienteId, competencia),
          fetchKpiData(clienteId, getCompetenciaAnterior(competencia)),
        ]);
        setKpi(kpiCurr);
        setKpiAnterior(kpiPrev);

        try {
          const { data: contasRaw } = await supabase
            .from('plano_de_contas')
            .select('id, nome, tipo, nivel, is_total, ordem, conta_pai_id')
            .eq('cliente_id', clienteId)
            .order('ordem');

          if (contasRaw?.length) {
            const contaIds = contasRaw.map((c: any) => c.id);
            const { data: valores } = await supabase
              .from('valores_mensais')
              .select('conta_id, valor_realizado, valor_meta')
              .in('conta_id', contaIds)
              .eq('competencia', competencia);

            const indicadores = await fetchMergedIndicadores(clienteId);
            const realizadoMap: Record<string, number | null> = {};
            (valores || []).forEach((v: any) => { realizadoMap[v.conta_id] = v.valor_realizado; });

            const calcs = calcularIndicadores(indicadores, contasRaw as any, realizadoMap);
            setIndicadoresCalc(calcs);
            const ativos = calcs.filter((c: any) => c.indicador.ativo);
            if (ativos.length > 0) {
              setScore(calcScore(calcs));
            }
          }
        } catch { /* score optional */ }

        // Check if apresentacao_preparacao exists for this competencia
        const { data: apresPrep } = await supabase
          .from('apresentacao_preparacao')
          .select('id')
          .eq('cliente_id', clienteId)
          .eq('competencia', competencia)
          .eq('visivel_portal', true)
          .maybeSingle();
        setHasApresentacao(!!apresPrep);

        const { data: alertasData } = await supabase
          .from('alertas_semanais')
          .select('*')
          .eq('cliente_id', clienteId)
          .eq('status', 'enviado')
          .order('created_at', { ascending: false })
          .limit(3);
        setAlertas(alertasData || []);

        const hoje = new Date().toISOString().split('T')[0];
        const { data: reuniaoData } = await supabase
          .from('reunioes')
          .select('*, profiles!reunioes_realizada_por_fkey(nome)')
          .eq('cliente_id', clienteId)
          .gte('data_reuniao', hoje)
          .order('data_reuniao', { ascending: true })
          .limit(1);
        if (reuniaoData?.length) setProximaReuniao(reuniaoData[0]);
        else setProximaReuniao(null);
      } catch {
        /* errors handled gracefully */
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [resolvedClienteId, competenciaSelecionada, espelho]);

  // Loading empresas
  if (loadingEmpresas) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#F0F4FA' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1A3CFF] border-t-transparent" />
      </div>
    );
  }

  // No access
  if (noAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4" style={{ background: '#F0F4FA' }}>
        <img src={gpiLogo} alt="GPI" className="h-10 w-auto" />
        <p className="text-[#4A5E80] text-sm text-center max-w-sm">
          Nenhuma empresa vinculada ao seu usuário. Entre em contato com a GPI para solicitar acesso.
        </p>
      </div>
    );
  }

  // Empresa selection screen (2+ empresas, none selected yet)
  if (!propClienteId && !clienteIdSelecionado && empresas.length >= 2) {
    return (
      <div className="flex flex-col items-center py-12 px-4 min-h-screen" style={{ background: '#F0F4FA' }}>
        <img src={gpiLogo} alt="GPI" className="h-10 w-auto mb-8" />
        <h1 className="text-xl font-bold text-[#0D1B35] mb-1" style={{ fontFamily: 'DM Sans, sans-serif' }}>
          Selecione a empresa
        </h1>
        <p className="text-sm text-[#4A5E80] mb-8">
          Você tem acesso a {empresas.length} empresas
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-[600px]">
          {empresas.map((e) => (
            <button
              key={e.cliente_id}
              onClick={() => setClienteIdSelecionado(e.cliente_id)}
              className={`relative rounded-xl bg-white p-6 text-left shadow-sm transition-all hover:shadow-md hover:scale-[1.01] ${
                e.empresa_padrao
                  ? 'border-2 border-[#1A3CFF]'
                  : 'border border-[#DDE4F0]'
              }`}
            >
              {e.empresa_padrao && (
                <span className="absolute top-3 right-3 rounded-full bg-[#EBF0FF] px-2 py-0.5 text-[10px] font-semibold text-[#1A3CFF]">
                  ★ Principal
                </span>
              )}
              <span className="text-2xl mb-3 block">🏢</span>
              <p className="text-sm font-bold text-[#0D1B35] mb-4">
                {e.razao_social || e.nome_empresa}
              </p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#1A3CFF]">
                Acessar <ArrowRight className="h-3 w-3" />
              </span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Dashboard loading
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: '#F0F4FA' }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1A3CFF] border-t-transparent" />
      </div>
    );
  }

  // No released competencias — show empty state
  if (!espelho && competenciasLiberadas.length === 0 && !loadingCompetencias) {
    const whatsappLinkEmpty = cliente?.responsavel_whatsapp
      ? `https://wa.me/55${cliente.responsavel_whatsapp.replace(/\D/g, '')}`
      : null;
    return (
      <div className="min-h-screen" style={{ background: '#F0F4FA' }}>
        {/* Header */}
        <header className="sticky top-0 z-30 bg-white border-b border-[#DDE4F0] px-4 py-3">
          <div className="max-w-[1100px] mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={gpiLogo} alt="GPI" className="h-8 w-auto" />
              <span className="text-sm font-semibold text-[#0D1B35]">{cliente?.razao_social || cliente?.nome_empresa || ''}</span>
            </div>
            <button onClick={signOut} className="rounded-md p-1.5 text-[#4A5E80] hover:text-[#DC2626] transition-colors">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <div className="max-w-[600px] mx-auto py-16 px-4">
          <div className="rounded-xl border border-[#DDE4F0] bg-white p-10 shadow-sm text-center space-y-4">
            <span className="text-5xl">📊</span>
            <h2 className="text-lg font-bold text-[#0D1B35]">Seus dados estão sendo preparados</h2>
            <p className="text-sm text-[#4A5E80] leading-relaxed">
              Seu consultor está analisando os números e em breve você terá acesso ao seu painel financeiro completo.
            </p>
            {whatsappLinkEmpty && (
              <>
                <p className="text-xs text-[#8A9BBC]">Dúvidas? Fale com a GPI pelo WhatsApp</p>
                <a
                  href={whatsappLinkEmpty}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#20BD5A] transition-colors"
                >
                  <MessageCircle className="h-4 w-4" />
                  💬 Falar com consultor
                </a>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const competencia = competenciaSelecionada || competenciasLiberadas[0] || getCompetenciaAtual();

  const fatVariacao = kpiAnterior?.faturamento
    ? ((kpi?.faturamento - kpiAnterior.faturamento) / Math.abs(kpiAnterior.faturamento)) * 100
    : 0;

  const gcPct = kpi?.gc_pct || 0;
  const gcAccent = gcPct >= 10 ? '#00A86B' : gcPct >= 0 ? '#D97706' : '#DC2626';
  const gcLabel = gcPct >= 10 ? '✓ Saudável' : gcPct >= 0 ? '⚠ Atenção' : '✕ Crítico';
  const gcBadgeBg = gcPct >= 10 ? 'rgba(0,168,107,0.1)' : gcPct >= 0 ? 'rgba(217,119,6,0.1)' : 'rgba(220,38,38,0.08)';

  const scoreVal = score ?? 0;
  const scoreColor = scoreVal >= 70 ? '#00A86B' : scoreVal >= 40 ? '#D97706' : '#DC2626';
  const scoreLabel = scoreVal >= 70 ? 'Saudável' : scoreVal >= 40 ? 'Atenção' : 'Crítico';

  const whatsappNum = cliente?.responsavel_whatsapp?.replace(/\D/g, '');
  const whatsappLink = whatsappNum ? `https://wa.me/55${whatsappNum}` : null;

  const showTrocarEmpresa = !propClienteId && empresas.length >= 2;

  const kpisAtivos = indicadoresCalc.filter((c: any) => c.indicador.ativo);

  return (
    <div className="min-h-screen" style={{ background: '#F0F4FA', fontFamily: 'DM Sans, sans-serif' }}>
      {/* 1. HEADER */}
      <header className="sticky top-0 z-30 bg-white border-b border-[#DDE4F0]">
        <div className="max-w-[1100px] mx-auto flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <img src={gpiLogo} alt="GPI" className="h-8 w-auto" />
            <span className="text-sm font-semibold text-[#0D1B35]">
              {cliente?.razao_social || cliente?.nome_empresa}
            </span>
            {espelho && (
              <span className="rounded-full bg-[#EBF0FF] px-2 py-0.5 text-[10px] font-medium text-[#1A3CFF]">
                visualizando como cliente
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showTrocarEmpresa && (
              <button
                onClick={() => {
                  setClienteIdSelecionado(null);
                  setCliente(null);
                  setKpi(null);
                  setKpiAnterior(null);
                  setScore(null);
                  setIndicadoresCalc([]);
                  setAlertas([]);
                  setProximaReuniao(null);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-[#EBF0FF] px-2.5 py-1 text-[11px] font-semibold text-[#1A3CFF] hover:bg-[#D6E0FF] transition-colors"
              >
                ⇄ Trocar empresa
              </button>
            )}
            <button onClick={signOut} className="rounded-md p-1.5 text-[#4A5E80] hover:text-[#DC2626] transition-colors">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1100px] mx-auto px-4 py-6 space-y-6">
        {/* 2. SAUDAÇÃO */}
        <div>
          <p className="text-sm text-[#4A5E80]">Olá, {profile?.nome || 'Cliente'} 👋</p>
          <h1 className="text-2xl font-bold text-[#0D1B35]">
            {cliente?.razao_social || cliente?.nome_empresa}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            {competenciasLiberadas.length > 0 && (
              <span className="text-xs text-[#8A9BBC]">
                {fmtMesAnoLong(competencia)} · Fechamento disponível
              </span>
            )}
          </div>
          {competenciasLiberadas.length > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '8px 0 16px' }}>
              {competenciasLiberadas.map((m) => {
                const isAtivo = m === competencia;
                const label = new Date(m + 'T12:00:00')
                  .toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' })
                  .replace('.', '')
                  .toUpperCase();
                return (
                  <button
                    key={m}
                    onClick={() => setCompetenciaSelecionada(m)}
                    style={{
                      padding: '4px 14px',
                      borderRadius: 20,
                      fontSize: 11,
                      fontWeight: isAtivo ? 700 : 500,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      border: isAtivo ? '1.5px solid #1A3CFF' : '1px solid #DDE4F0',
                      background: isAtivo ? '#1A3CFF' : '#FFFFFF',
                      color: isAtivo ? '#FFFFFF' : '#4A5E80',
                      boxShadow: isAtivo ? '0 2px 8px rgba(26,60,255,0.18)' : 'none',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* 3. TRÊS HERO CARDS */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* FATURAMENTO */}
          <div className="rounded-xl border border-[#DDE4F0] bg-white shadow-sm overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
            <div className="h-1" style={{ background: 'linear-gradient(90deg, #1A3CFF, #0099E6)' }} />
            <div className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5E80] mb-1">Faturamento</p>
              <p className="text-[28px] font-extrabold text-[#0D1B35]" style={{ fontFamily: 'Courier New, monospace' }}>
                {fmtR$(kpi?.faturamento || 0)}
              </p>
              <div className="mt-2">
                {kpiAnterior?.faturamento ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{
                      color: fatVariacao >= 0 ? '#00A86B' : '#DC2626',
                      background: fatVariacao >= 0 ? 'rgba(0,168,107,0.1)' : 'rgba(220,38,38,0.08)',
                    }}
                  >
                    {fatVariacao >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                    {fatVariacao >= 0 ? '▲' : '▼'} {Math.abs(fatVariacao).toFixed(1)}%
                  </span>
                ) : (
                  <span className="text-[11px] text-[#8A9BBC]">sem mês anterior</span>
                )}
              </div>
            </div>
          </div>

          {/* GERAÇÃO DE CAIXA */}
          <div className="rounded-xl border border-[#DDE4F0] bg-white shadow-sm overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
            <div className="h-1" style={{ background: gcAccent }} />
            <div className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5E80] mb-1">Geração de Caixa</p>
              <p className="text-[28px] font-extrabold text-[#0D1B35]" style={{ fontFamily: 'Courier New, monospace' }}>
                {fmtR$(kpi?.gc_valor || 0)}
              </p>
              <p className="text-sm mt-1" style={{ fontFamily: 'Courier New, monospace', color: '#4A5E80' }}>
                {gcPct.toFixed(1)}% do faturamento
              </p>
              <span
                className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                style={{ color: gcAccent, background: gcBadgeBg }}
              >
                {gcLabel}
              </span>
            </div>
          </div>

          {/* SCORE DE SAÚDE */}
          <div className="rounded-xl border border-[#DDE4F0] bg-white shadow-sm overflow-hidden" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
            <div className="h-1" style={{ background: scoreColor }} />
            <div className="p-5 flex flex-col items-center justify-center">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5E80] mb-3">Saúde Financeira</p>
              <div className="relative w-[120px] h-[65px]">
                <svg viewBox="0 0 120 65" className="w-full h-full">
                  <path
                    d="M 10 60 A 50 50 0 0 1 110 60"
                    fill="none"
                    stroke="#E8EEF8"
                    strokeWidth="10"
                    strokeLinecap="round"
                  />
                  <path
                    d="M 10 60 A 50 50 0 0 1 110 60"
                    fill="none"
                    stroke={scoreColor}
                    strokeWidth="10"
                    strokeLinecap="round"
                    strokeDasharray={`${scoreVal * 1.57} 157`}
                    style={{ transition: 'stroke-dasharray 1s ease' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-end justify-center pb-0">
                  <span className="text-xl font-extrabold" style={{ fontFamily: 'Courier New, monospace', color: scoreColor }}>
                    {score !== null ? score : '–'}
                  </span>
                </div>
              </div>
              <span className="mt-1 text-xs font-bold uppercase" style={{ color: scoreColor }}>
                {score !== null ? scoreLabel : 'Sem dados'}
              </span>
              <span className="text-[11px] text-[#8A9BBC] mt-0.5">{fmtMesAno(competencia)}</span>
            </div>
          </div>
        </div>

        {/* 3.5 APRESENTAÇÃO DO MÊS */}
        {hasApresentacao && (
          <div>
            <h2 className="text-sm font-bold text-[#0D1B35] mb-3 flex items-center gap-1.5">
              📊 Apresentação do Mês
            </h2>
            <div
              className="rounded-xl border border-[#DDE4F0] bg-white shadow-sm overflow-hidden flex items-center gap-4 p-5"
              style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}
            >
              <div className="flex-shrink-0 flex items-center justify-center h-14 w-14 rounded-lg bg-[#EBF0FF]">
                <span className="text-[32px] leading-none">📊</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-[#0D1B35]">
                  Relatório de Inteligência Financeira · {fmtMesAno(competencia)}
                </p>
                <p className="text-xs text-[#4A5E80] mt-0.5">
                  Preparado pela equipe GPI · Clique para iniciar
                </p>
              </div>
              <button
                onClick={() => navigate(`/apresentacao/${resolvedClienteId}`)}
                className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:opacity-90"
                style={{ background: '#1A3CFF', borderRadius: '8px' }}
              >
                <Play className="h-4 w-4" /> Iniciar Apresentação
              </button>
            </div>
          </div>
        )}

        {/* 4. SAÚDE FINANCEIRA — KPIs */}
        {kpisAtivos.length > 0 && (
          <div className="rounded-xl border border-[#DDE4F0] bg-white p-5 shadow-sm" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
            <h2 className="text-sm font-bold text-[#0D1B35] mb-4 flex items-center gap-2">
              Saúde Financeira ·{' '}
              <span style={{ color: scoreColor, fontFamily: 'Courier New, monospace' }}>{score ?? '–'}/100</span>
              {' · '}
              <span className="text-xs font-semibold" style={{ color: scoreColor }}>{score !== null ? scoreLabel : ''}</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {kpisAtivos.map((calc: any) => {
                const cfg = STATUS_CONFIG[calc.status as keyof typeof STATUS_CONFIG];
                return (
                  <div
                    key={calc.indicador.id}
                    className="rounded-lg border border-[#DDE4F0] p-3 text-center"
                  >
                    <p className="text-[11px] font-semibold text-[#4A5E80] mb-1 truncate">{calc.indicador.nome}</p>
                    <p className="text-lg font-extrabold text-[#0D1B35]" style={{ fontFamily: 'Courier New, monospace' }}>
                      {calc.pct !== null ? `${calc.pct.toFixed(1)}%` : '–'}
                    </p>
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-[10px] font-bold mt-1"
                      style={{ color: cfg.color, background: cfg.bg }}
                    >
                      {cfg.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 5. PRÓXIMA REUNIÃO */}
        <div className="rounded-xl border border-[#DDE4F0] bg-white p-5 shadow-sm" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
          <span className="inline-block rounded-full bg-[#EBF0FF] px-2.5 py-0.5 text-[10px] font-bold text-[#1A3CFF] uppercase tracking-wider mb-3">
            Próxima Reunião
          </span>
          {proximaReuniao ? (
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#EBF0FF]">
                <Calendar className="h-6 w-6 text-[#1A3CFF]" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#0D1B35]">
                  {new Date(proximaReuniao.data_reuniao + 'T00:00:00').toLocaleDateString('pt-BR', {
                    weekday: 'long', day: 'numeric', month: 'long'
                  })}
                  {proximaReuniao.horario && ` às ${proximaReuniao.horario.slice(0, 5)}`}
                </p>
                <p className="text-xs text-[#4A5E80]">
                  {proximaReuniao.tipo} · {(proximaReuniao as any).profiles?.nome || '—'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-[#4A5E80]">Nenhuma reunião agendada</p>
          )}
        </div>

        {/* 6. ALERTAS DA SEMANA */}
        <div className="rounded-xl border border-[#DDE4F0] bg-white shadow-sm" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
          <button
            onClick={() => setAlertasOpen(!alertasOpen)}
            className="w-full flex items-center justify-between p-5 text-left"
          >
            <h2 className="text-sm font-bold text-[#0D1B35] flex items-center gap-2">
              <Bell className="h-4 w-4 text-[#1A3CFF]" /> Alertas da Semana
            </h2>
            {alertasOpen ? <ChevronUp className="h-4 w-4 text-[#8A9BBC]" /> : <ChevronDown className="h-4 w-4 text-[#8A9BBC]" />}
          </button>
          {alertasOpen && (
            <div className="px-5 pb-5">
              {alertas.length === 0 ? (
                <div>
                  <p className="text-sm text-[#4A5E80]">Alerta da semana ainda não disponível</p>
                  <p className="text-[11px] text-[#8A9BBC] mt-0.5">Disponível toda sexta-feira até 12h</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {alertas.map((a) => {
                    const conteudo = a.conteudo as any;
                    const nivel = conteudo?.nivel || 'info';
                    const nivelIcon = nivel === 'critico' ? <AlertTriangle className="h-4 w-4 text-[#DC2626]" /> :
                      nivel === 'atencao' ? <AlertTriangle className="h-4 w-4 text-[#D97706]" /> :
                      <Info className="h-4 w-4 text-[#1A3CFF]" />;
                    return (
                      <div key={a.id} className="flex items-start gap-2 rounded-lg bg-[#F6F9FF] p-3">
                        {nivelIcon}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[#0D1B35] truncate">
                            {conteudo?.titulo || `Alerta ${a.semana_inicio}`}
                          </p>
                          <p className="text-[11px] text-[#8A9BBC]">
                            {new Date(a.created_at).toLocaleDateString('pt-BR')}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 7. RODAPÉ / CTA */}
        <div className="rounded-xl border border-[#DDE4F0] bg-white p-5 shadow-sm text-center" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
          <p className="text-sm text-[#4A5E80] mb-3">Acompanhe seus números com sua equipe GPI</p>
          {whatsappLink && !espelho && (
            <a
              href={whatsappLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#20BD5A] transition-colors"
            >
              <MessageCircle className="h-4 w-4" />
              💬 Falar com consultor
            </a>
          )}
          {espelho && whatsappLink && (
            <span className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white opacity-40 cursor-not-allowed">
              <MessageCircle className="h-4 w-4" />
              💬 Falar com consultor
            </span>
          )}
        </div>
      </main>
    </div>
  );
}
