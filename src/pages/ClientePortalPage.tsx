import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchKpiData } from '@/lib/kpi-utils';
import { fetchMergedIndicadores, calcularIndicadores } from '@/lib/kpi-indicadores-utils';
import { TrendingUp, TrendingDown, Calendar, MessageCircle, Bell, CheckCircle, AlertTriangle, Info, ArrowRight, RefreshCw } from 'lucide-react';
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

function fmtR$(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtPct(v: number) {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function saudacao() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
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

export default function ClientePortalPage({ clienteId: propClienteId, espelho }: ClientePortalPageProps = {}) {
  const { profile } = useAuth();

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
  const [score, setScore] = useState<number | null>(null);
  const [alertas, setAlertas] = useState<any[]>([]);
  const [proximaReuniao, setProximaReuniao] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // If prop clienteId (espelho mode), skip empresa selection
  const resolvedClienteId = propClienteId || clienteIdSelecionado;

  // Load empresas for the logged-in user
  useEffect(() => {
    if (propClienteId) return; // espelho mode
    if (!profile?.id) return;

    const loadEmpresas = async () => {
      setLoadingEmpresas(true);
      try {
        // Query portal_usuario_clientes
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

          // Sort: empresa_padrao first, then by razao_social
          empresasList.sort((a, b) => {
            if (a.empresa_padrao && !b.empresa_padrao) return -1;
            if (!a.empresa_padrao && b.empresa_padrao) return 1;
            return (a.razao_social || a.nome_empresa).localeCompare(b.razao_social || b.nome_empresa);
          });

          setEmpresas(empresasList);

          if (empresasList.length === 1) {
            setClienteIdSelecionado(empresasList[0].cliente_id);
          }
          // If 2+, show selection screen (clienteIdSelecionado stays null)
        } else {
          // Fallback: legacy profiles.cliente_id
          if (profile.cliente_id) {
            setClienteIdSelecionado(profile.cliente_id as string);
            setEmpresas([]);
          } else {
            setNoAccess(true);
          }
        }
      } catch {
        // Fallback to legacy
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

  // Load dashboard data when clienteId is resolved
  useEffect(() => {
    if (!resolvedClienteId) return;
    const clienteId = resolvedClienteId;

    const load = async () => {
      setLoading(true);
      try {
        const { data: cli } = await supabase
          .from('clientes')
          .select('*')
          .eq('id', clienteId)
          .single();
        setCliente(cli);

        const [kpiCurr, kpiPrev] = await Promise.all([
          fetchKpiData(clienteId, competencia),
          fetchKpiData(clienteId, getCompetenciaAnterior(competencia)),
        ]);
        setKpi(kpiCurr);
        setKpiAnterior(kpiPrev);

        try {
          const { data: contasRaw } = await supabase
            .from('plano_de_contas')
            .select('id, nome, tipo, nivel, is_total, ordem')
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
            const ativos = calcs.filter((c: any) => c.indicador.ativo);
            if (ativos.length > 0) {
              const totalPontos = ativos.reduce((s: number, c: any) => s + c.pontos, 0);
              setScore(Math.round(totalPontos / ativos.length));
            }
          }
        } catch { /* score optional */ }

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
  }, [resolvedClienteId, competencia]);

  // Loading empresas
  if (loadingEmpresas) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1A3CFF] border-t-transparent" />
      </div>
    );
  }

  // No access
  if (noAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
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
      <div className="flex flex-col items-center py-12 px-4">
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
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1A3CFF] border-t-transparent" />
      </div>
    );
  }

  const fatVariacao = kpiAnterior?.faturamento
    ? ((kpi?.faturamento - kpiAnterior.faturamento) / Math.abs(kpiAnterior.faturamento)) * 100
    : 0;

  const gcPct = kpi?.gc_pct || 0;
  const gcBorder = gcPct >= 10 ? '#00A86B' : gcPct >= 0 ? '#D97706' : '#DC2626';
  const gcBg = gcPct >= 10 ? 'rgba(0,168,107,0.06)' : gcPct >= 0 ? 'rgba(217,119,6,0.06)' : 'rgba(220,38,38,0.06)';

  const scoreColor = (score ?? 0) >= 70 ? '#00A86B' : (score ?? 0) >= 40 ? '#D97706' : '#DC2626';
  const scoreLabel = (score ?? 0) >= 70 ? 'Saudável' : (score ?? 0) >= 40 ? 'Atenção' : 'Crítico';

  const whatsappLink = cliente?.responsavel_whatsapp
    ? `https://wa.me/55${cliente.responsavel_whatsapp.replace(/\D/g, '')}`
    : '#';

  const showTrocarEmpresa = !propClienteId && empresas.length >= 2;

  return (
    <div className="max-w-[1100px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0D1B35]" style={{ fontFamily: 'DM Sans, sans-serif' }}>
            {saudacao()}, {cliente?.responsavel_nome || profile?.nome || 'Cliente'}
            {espelho && (
              <span className="ml-2 inline-block rounded-full bg-[#EBF0FF] px-2 py-0.5 text-[10px] font-medium text-[#1A3CFF] align-middle">
                visualizando como cliente
              </span>
            )}
          </h1>
          <div className="flex items-center gap-2">
            <p className="text-sm text-[#4A5E80]">{cliente?.razao_social || cliente?.nome_empresa}</p>
            {showTrocarEmpresa && (
              <button
                onClick={() => {
                  setClienteIdSelecionado(null);
                  setCliente(null);
                  setKpi(null);
                  setKpiAnterior(null);
                  setScore(null);
                  setAlertas([]);
                  setProximaReuniao(null);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-[#EBF0FF] px-2.5 py-1 text-[11px] font-semibold text-[#1A3CFF] hover:bg-[#D6E0FF] transition-colors"
              >
                <RefreshCw className="h-3 w-3" />
                Trocar empresa
              </button>
            )}
          </div>
        </div>
        <span className="rounded-full bg-[#EBF0FF] px-3 py-1 text-xs font-semibold text-[#1A3CFF]">
          {fmtMesAno(competencia)}
        </span>
      </div>

      {/* Seção 1 — Cards de topo */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1 - Faturamento */}
        <div className="rounded-xl border border-[#DDE4F0] bg-white p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5E80] mb-1">
            Faturamento {fmtMesAno(competencia)}
          </p>
          <p className="text-2xl font-extrabold text-[#0D1B35]" style={{ fontFamily: 'Courier New, monospace' }}>
            {fmtR$(kpi?.faturamento || 0)}
          </p>
          <div className="mt-2 flex items-center gap-1">
            {fatVariacao >= 0 ? (
              <TrendingUp className="h-4 w-4 text-[#00A86B]" />
            ) : (
              <TrendingDown className="h-4 w-4 text-[#DC2626]" />
            )}
            <span
              className="text-xs font-semibold"
              style={{ fontFamily: 'Courier New, monospace', color: fatVariacao >= 0 ? '#00A86B' : '#DC2626' }}
            >
              {fmtPct(fatVariacao)} vs mês anterior
            </span>
          </div>
        </div>

        {/* Card 2 - Geração de Caixa */}
        <div
          className="rounded-xl bg-white p-5 shadow-sm"
          style={{ border: `2px solid ${gcBorder}`, background: gcBg }}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5E80]">
              Geração de Caixa
            </p>
            {gcPct < 0 && <AlertTriangle className="h-3.5 w-3.5 text-[#DC2626]" />}
          </div>
          <p className="text-2xl font-extrabold text-[#0D1B35]" style={{ fontFamily: 'Courier New, monospace' }}>
            {fmtR$(kpi?.gc_valor || 0)}
          </p>
          <p className="text-xs font-semibold mt-1" style={{ fontFamily: 'Courier New, monospace', color: gcBorder }}>
            {gcPct.toFixed(1)}% do faturamento
          </p>
          <p className="text-[10px] text-[#8A9BBC] mt-2">Meta GPI: ≥ 10%</p>
        </div>

        {/* Card 3 - Score de Saúde */}
        <div className="rounded-xl border border-[#DDE4F0] bg-white p-5 shadow-sm flex flex-col items-center justify-center">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#4A5E80] mb-3">
            Score de Saúde Financeira
          </p>
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
                strokeDasharray={`${(score ?? 0) * 1.57} 157`}
              />
            </svg>
            <div className="absolute inset-0 flex items-end justify-center pb-0">
              <span className="text-xl font-extrabold" style={{ fontFamily: 'Courier New, monospace', color: scoreColor }}>
                {score ?? '–'}
              </span>
            </div>
          </div>
          <span
            className="mt-1 text-xs font-bold uppercase"
            style={{ color: scoreColor }}
          >
            {score !== null ? scoreLabel : 'Sem dados'}
          </span>
        </div>
      </div>

      {/* Seção 2 — Alertas Recentes */}
      <div className="rounded-xl border border-[#DDE4F0] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-[#0D1B35] mb-3 flex items-center gap-2">
          <Bell className="h-4 w-4 text-[#1A3CFF]" /> Alertas Recentes
        </h2>
        {alertas.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-[#4A5E80]">
            <CheckCircle className="h-4 w-4 text-[#00A86B]" />
            Nenhum alerta recente. Tudo operando normalmente. ✅
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

      {/* Seção 3 — Próxima Reunião */}
      <div className="rounded-xl border border-[#DDE4F0] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-[#0D1B35] mb-3 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-[#1A3CFF]" /> Próxima Reunião
        </h2>
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
                Consultor: {(proximaReuniao as any).profiles?.nome || '—'}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-[#4A5E80]">Sua próxima reunião será agendada em breve.</p>
        )}
      </div>

      {/* Seção 4 — Acompanhe seus Números */}
      <div className="rounded-xl border border-[#DDE4F0] bg-white p-5 shadow-sm">
        <h2 className="text-sm font-bold text-[#0D1B35] mb-3">📊 Acompanhe seus Números</h2>
        <p className="text-sm text-[#4A5E80] leading-relaxed">
          Seus números são lançados no Nibo diariamente. Nossa equipe audita,
          analisa e apresenta os resultados toda reunião mensal. Dúvidas? Fale
          com seu consultor pelo WhatsApp.
        </p>
        {espelho ? (
          <span
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white opacity-40 cursor-not-allowed"
            title="Disponível apenas no portal do cliente"
          >
            <MessageCircle className="h-4 w-4" />
            💬 Falar com meu consultor
          </span>
        ) : (
          <a
            href={whatsappLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#20BD5A] transition-colors"
          >
            <MessageCircle className="h-4 w-4" />
            💬 Falar com meu consultor
          </a>
        )}
      </div>
    </div>
  );
}
