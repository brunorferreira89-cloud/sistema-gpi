import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { fetchKpiData } from '@/lib/kpi-utils';
import { fetchMergedIndicadores, calcularIndicadores, calcScore } from '@/lib/kpi-indicadores-utils';
import { Calendar, MessageCircle, LogOut, ChevronDown, ChevronRight, Play, ArrowRight, AlertTriangle, Info, Bell, ChevronUp } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import gpiLogo from '@/assets/gpi-logo-dark.png';
import { PainelPersonalizado } from '@/components/clientes/PainelPersonalizado';
import { SparkLine } from '@/components/ui/spark-line';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { TorreMeta, calcProjetado, calcStatus, fmtTorre, mesSeguinte as getMesSeguinte, fmtCompetencia } from '@/lib/torre-utils';
import { DreBanner } from '@/components/clientes/DreBanner';
import { TorreBanner } from '@/components/clientes/TorreBanner';
import { SpeedometerGauge } from '@/components/ui/speedometer-gauge';
import { DreIndicadoresHeader } from '@/components/clientes/DreIndicadoresHeader';

// ── Colors ──────────────────────────────────────────────────────
const C = {
  primary: '#1A3CFF', pLo: 'rgba(26,60,255,0.06)',
  cyan: '#0099E6',
  green: '#00A86B', greenBg: 'rgba(0,168,107,0.1)',
  red: '#DC2626', redBg: 'rgba(220,38,38,0.08)',
  orange: '#D97706', orangeBg: 'rgba(217,119,6,0.1)',
  bg: '#F0F4FA', surface: '#FFFFFF', surfaceHi: '#F6F9FF', border: '#DDE4F0', borderStr: '#C4CFEA',
  txt: '#0D1B35', txtSec: '#4A5E80', txtMuted: '#8A9BBC',
  mono: "'Courier New', monospace",
};

// ── Helpers ─────────────────────────────────────────────────────
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

function getMonthShort(comp: string) {
  const d = new Date(comp + 'T12:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
}

// ── DRE tree ────────────────────────────────────────────────────
interface DreNode { conta: ContaRow; children: DreNode[] }

function buildDreTree(contas: ContaRow[]): DreNode[] {
  const map = new Map<string, DreNode>();
  const roots: DreNode[] = [];
  for (const c of contas) map.set(c.id, { conta: c, children: [] });
  for (const c of contas) {
    const node = map.get(c.id)!;
    if (c.conta_pai_id && map.has(c.conta_pai_id)) map.get(c.conta_pai_id)!.children.push(node);
    else roots.push(node);
  }
  const sort = (arr: DreNode[]) => { arr.sort((a, b) => a.conta.ordem - b.conta.ordem); arr.forEach(n => sort(n.children)); };
  sort(roots);
  return roots;
}

function sumNodeLeafs(node: DreNode, valMap: Record<string, number | null>): number | null {
  if (node.conta.nivel === 2) return valMap[node.conta.id] ?? null;
  let total = 0, hasAny = false;
  for (const child of node.children) {
    const v = sumNodeLeafs(child, valMap);
    if (v != null) { total += v; hasAny = true; }
  }
  return hasAny ? total : null;
}

function sumGrupos(grupos: DreNode[], valMap: Record<string, number | null>): number {
  let total = 0;
  for (const g of grupos) {
    const v = sumNodeLeafs(g, valMap);
    if (v != null) total += v;
  }
  return total;
}

function sumNodeProjetado(node: DreNode, valMap: Record<string, number | null>, mMap: Record<string, TorreMeta>): number | null {
  if (node.conta.nivel === 2) {
    const real = valMap[node.conta.id] ?? null;
    if (real == null) return null;
    const meta = mMap[node.conta.id] || null;
    const proj = calcProjetado(real, meta, node.conta.tipo);
    return proj ?? real;
  }
  let total = 0, hasAny = false;
  for (const child of node.children) {
    const v = sumNodeProjetado(child, valMap, mMap);
    if (v != null) { total += v; hasAny = true; }
  }
  return hasAny ? total : null;
}

function sumGruposProjetado(grupos: DreNode[], valMap: Record<string, number | null>, mMap: Record<string, TorreMeta>): number {
  let total = 0;
  for (const g of grupos) {
    const v = sumNodeProjetado(g, valMap, mMap);
    if (v != null) total += v;
  }
  return total;
}

const SEQUENCIA_DRE: { tipo: string; totalizadorApos: string | null }[] = [
  { tipo: 'receita', totalizadorApos: null },
  { tipo: 'custo_variavel', totalizadorApos: 'MC' },
  { tipo: 'despesa_fixa', totalizadorApos: 'RO' },
  { tipo: 'investimento', totalizadorApos: 'RAI' },
  { tipo: 'financeiro', totalizadorApos: 'GC' },
];

const TOTALIZADOR_CONFIG: Record<string, { nome: string; key: string }> = {
  MC: { nome: '= MARGEM DE CONTRIBUIÇÃO', key: 'MC' },
  RO: { nome: '= RESULTADO OPERACIONAL', key: 'RO' },
  RAI: { nome: '= RESULTADO APÓS INVEST.', key: 'RAI' },
  GC: { nome: '= GERAÇÃO DE CAIXA', key: 'GC' },
};

// ── Interfaces ──────────────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════════
export default function ClientePortalPage({ clienteId: propClienteId, espelho }: ClientePortalPageProps = {}) {
  const { profile, user, signOut } = useAuth();
  const navigate = useNavigate();

  // ── Multi-empresa state ───────────────────────────────────────
  const [empresas, setEmpresas] = useState<EmpresaOption[]>([]);
  const [clienteIdSelecionado, setClienteIdSelecionado] = useState<string | null>(null);
  const [loadingEmpresas, setLoadingEmpresas] = useState(!propClienteId);
  const [noAccess, setNoAccess] = useState(false);
  const [empresaDropdownOpen, setEmpresaDropdownOpen] = useState(false);

  // ── Competência state ─────────────────────────────────────────
  const [competenciasLiberadas, setCompetenciasLiberadas] = useState<string[]>([]);
  const [competenciaSelecionada, setCompetenciaSelecionada] = useState<string | null>(null);
  const [loadingCompetencias, setLoadingCompetencias] = useState(false);

  // ── Dashboard state ───────────────────────────────────────────
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

  // ── DRE state ─────────────────────────────────────────────────
  const [dreCollapsed, setDreCollapsed] = useState<Set<string>>(new Set());
  const [dreMonthsActive, setDreMonthsActive] = useState<Set<string>>(new Set());
  const [showAV, setShowAV] = useState(false);
  const [showAH, setShowAH] = useState(false);

  // ── Torre state ───────────────────────────────────────────────
  const [torreTab, setTorreTab] = useState<'gpi' | 'simulacao'>('gpi');
  const [torreCollapsed, setTorreCollapsed] = useState<Set<string>>(new Set());
  const [simLocalMap, setSimLocalMap] = useState<Record<string, { meta_tipo: string; meta_valor: number | null }>>({});
  const [simDirty, setSimDirty] = useState(false);
  const [savingSim, setSavingSim] = useState(false);
  const [torreShowAV, setTorreShowAV] = useState(false);
  const [torreShowAH, setTorreShowAH] = useState(false);
  const [torreMonthsActive, setTorreMonthsActive] = useState<Set<string>>(new Set());

  // ── Countdown ─────────────────────────────────────────────────
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, min: 0, sec: 0 });

  const resolvedClienteId = propClienteId || clienteIdSelecionado;

  // ── Query widgets ─────────────────────────────────────────────
  const { data: portalWidgets = [] } = useQuery({
    queryKey: ['painel-widgets', resolvedClienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('painel_widgets')
        .select('*')
        .eq('cliente_id', resolvedClienteId!)
        .eq('ativo', true)
        .order('ordem', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!resolvedClienteId,
  });

  // ── Load empresas ─────────────────────────────────────────────
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
          const { data: clientes } = await supabase.from('clientes').select('id, nome_empresa, razao_social').in('id', clienteIds);
          const empresasList: EmpresaOption[] = (clientes || []).map((c) => {
            const link = (links as any[]).find((l: any) => l.cliente_id === c.id);
            return { cliente_id: c.id, nome_empresa: c.nome_empresa, razao_social: c.razao_social, empresa_padrao: link?.empresa_padrao ?? false };
          });
          empresasList.sort((a, b) => {
            if (a.empresa_padrao && !b.empresa_padrao) return -1;
            if (!a.empresa_padrao && b.empresa_padrao) return 1;
            return (a.razao_social || a.nome_empresa).localeCompare(b.razao_social || b.nome_empresa);
          });
          setEmpresas(empresasList);
          if (empresasList.length === 1) setClienteIdSelecionado(empresasList[0].cliente_id);
        } else {
          if (profile.cliente_id) { setClienteIdSelecionado(profile.cliente_id as string); setEmpresas([]); }
          else setNoAccess(true);
        }
      } catch {
        if (profile.cliente_id) setClienteIdSelecionado(profile.cliente_id as string);
        else setNoAccess(true);
      } finally { setLoadingEmpresas(false); }
    };
    loadEmpresas();
  }, [propClienteId, profile?.id, profile?.cliente_id]);

  // ── Load competencias & dashboard data ────────────────────────
  useEffect(() => {
    if (!resolvedClienteId) return;
    const clienteId = resolvedClienteId;
    const load = async () => {
      setLoading(true);
      setLoadingCompetencias(true);
      try {
        const { data: cli } = await supabase.from('clientes').select('*').eq('id', clienteId).single();
        setCliente(cli);

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

        if (compDisp.length === 0 && !espelho) { setLoading(false); return; }

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
            if (ativos.length > 0) setScore(calcScore(calcs));
          }
        } catch { /* score optional */ }

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
      } catch { /* errors handled gracefully */ }
      finally { setLoading(false); }
    };
    load();
  }, [resolvedClienteId, competenciaSelecionada, espelho]);

  // ── DRE Data queries ──────────────────────────────────────────
  const competencia = competenciaSelecionada || competenciasLiberadas[0] || getCompetenciaAtual();

  const { data: dreContas } = useQuery({
    queryKey: ['portal-dre-contas', resolvedClienteId],
    enabled: !!resolvedClienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', resolvedClienteId!).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const dreContaIds = useMemo(() => dreContas?.map(c => c.id) || [], [dreContas]);

  // Get year from competencia
  const competenciaYear = competencia.substring(0, 4);

  const { data: dreValoresAnuais } = useQuery({
    queryKey: ['portal-dre-valores', resolvedClienteId, competenciaYear, dreContaIds.length],
    enabled: !!resolvedClienteId && dreContaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('valores_mensais').select('conta_id, competencia, valor_realizado')
        .in('conta_id', dreContaIds)
        .gte('competencia', `${competenciaYear}-01-01`)
        .lte('competencia', `${competenciaYear}-12-31`);
      return data || [];
    },
  });

  // DRE tree
  const dreTree = useMemo(() => dreContas ? buildDreTree(dreContas) : [], [dreContas]);

  const dreGruposPorTipo = useMemo(() => {
    const map: Record<string, DreNode[]> = {};
    for (const node of dreTree) {
      const tipo = node.conta.tipo;
      if (!map[tipo]) map[tipo] = [];
      map[tipo].push(node);
    }
    return map;
  }, [dreTree]);

  // DRE values map: contaId -> competencia -> value
  const dreValoresMap = useMemo(() => {
    const map: Record<string, Record<string, number | null>> = {};
    dreValoresAnuais?.forEach(v => {
      if (!map[v.conta_id]) map[v.conta_id] = {};
      map[v.conta_id][v.competencia] = v.valor_realizado;
    });
    return map;
  }, [dreValoresAnuais]);

  // DRE months with data
  const dreMonthsAll = useMemo(() => {
    const set = new Set<string>();
    dreValoresAnuais?.forEach(v => { if (v.valor_realizado != null) set.add(v.competencia); });
    return Array.from(set).sort();
  }, [dreValoresAnuais]);

  // Initialize active DRE months (last 2 + current competencia)
  useEffect(() => {
    if (dreMonthsAll.length > 0 && dreMonthsActive.size === 0) {
      const last2 = dreMonthsAll.slice(-2);
      setDreMonthsActive(new Set(last2));
    }
  }, [dreMonthsAll]);

  // Initialize DRE collapsed (all N1 collapsed)
  useEffect(() => {
    if (dreContas && dreContas.length > 0 && dreCollapsed.size === 0) {
      const n1Ids = dreContas.filter(c => c.nivel === 1).map(c => c.id);
      setDreCollapsed(new Set(n1Ids));
    }
  }, [dreContas]);

  const getDreMonthMap = useCallback((comp: string): Record<string, number | null> => {
    const map: Record<string, number | null> = {};
    dreContas?.forEach(c => { map[c.id] = dreValoresMap[c.id]?.[comp] ?? null; });
    return map;
  }, [dreContas, dreValoresMap]);

  // ── Torre data ────────────────────────────────────────────────
  const mesProximo = useMemo(() => competencia ? getMesSeguinte(competencia) : '', [competencia]);

  const { data: torreMetas } = useQuery({
    queryKey: ['portal-torre-metas', resolvedClienteId, mesProximo],
    enabled: !!resolvedClienteId && !!mesProximo,
    queryFn: async () => {
      const { data } = await supabase.from('torre_metas').select('conta_id, meta_tipo, meta_valor')
        .eq('cliente_id', resolvedClienteId!)
        .eq('competencia', mesProximo);
      return (data || []) as TorreMeta[];
    },
  });

  const torreMetaMap = useMemo(() => {
    const map: Record<string, TorreMeta> = {};
    torreMetas?.forEach(m => { map[m.conta_id] = m; });
    return map;
  }, [torreMetas]);

  // Torre realized map (current competencia)
  const torreRealMap = useMemo(() => competencia ? getDreMonthMap(competencia) : {}, [competencia, getDreMonthMap]);

  // Torre historical metas (all year) for historical month chips
  const { data: torreMetasAno } = useQuery({
    queryKey: ['portal-torre-metas-ano', resolvedClienteId, competenciaYear],
    enabled: !!resolvedClienteId,
    queryFn: async () => {
      const { data } = await supabase.from('torre_metas').select('conta_id, meta_tipo, meta_valor, competencia')
        .eq('cliente_id', resolvedClienteId!)
        .gte('competencia', `${competenciaYear}-01-01`)
        .lte('competencia', `${competenciaYear}-12-31`);
      return (data || []) as (TorreMeta & { competencia: string })[];
    },
  });

  const torreMetaMapByComp = useMemo(() => {
    const map: Record<string, Record<string, TorreMeta>> = {};
    (torreMetasAno || []).forEach(m => {
      if (!map[m.competencia]) map[m.competencia] = {};
      map[m.competencia][m.conta_id] = m;
    });
    return map;
  }, [torreMetasAno]);

  // Initialize torre collapsed
  useEffect(() => {
    if (dreContas && dreContas.length > 0 && torreCollapsed.size === 0) {
      const n1Ids = dreContas.filter(c => c.nivel === 1).map(c => c.id);
      setTorreCollapsed(new Set(n1Ids));
    }
  }, [dreContas]);

  // ── Simulação data ────────────────────────────────────────────
  const { data: simSaved } = useQuery({
    queryKey: ['portal-simulacao', user?.id, resolvedClienteId, mesProximo],
    enabled: !!user?.id && !!resolvedClienteId && !!mesProximo,
    queryFn: async () => {
      const { data } = await supabase.from('torre_simulacoes' as any)
        .select('conta_id, meta_tipo, meta_valor')
        .eq('usuario_id', user!.id)
        .eq('cliente_id', resolvedClienteId!)
        .eq('competencia', mesProximo);
      return (data || []) as unknown as { conta_id: string; meta_tipo: string; meta_valor: number | null }[];
    },
  });

  // Init sim local map from saved or fallback to torre_metas
  useEffect(() => {
    if (simSaved && simSaved.length > 0) {
      const map: Record<string, { meta_tipo: string; meta_valor: number | null }> = {};
      simSaved.forEach(s => { map[s.conta_id] = { meta_tipo: s.meta_tipo, meta_valor: s.meta_valor }; });
      setSimLocalMap(map);
    } else if (torreMetas && torreMetas.length > 0) {
      const map: Record<string, { meta_tipo: string; meta_valor: number | null }> = {};
      torreMetas.forEach(m => { map[m.conta_id] = { meta_tipo: m.meta_tipo, meta_valor: m.meta_valor }; });
      setSimLocalMap(map);
    }
    setSimDirty(false);
  }, [simSaved, torreMetas]);

  // ── Countdown timer ───────────────────────────────────────────
  useEffect(() => {
    if (!proximaReuniao) return;
    const target = new Date(`${proximaReuniao.data_reuniao}T${proximaReuniao.horario || '09:00:00'}`);
    const update = () => {
      const now = new Date();
      const diff = Math.max(0, target.getTime() - now.getTime());
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const min = Math.floor((diff % 3600000) / 60000);
      const sec = Math.floor((diff % 60000) / 1000);
      setCountdown({ days, hours, min, sec });
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [proximaReuniao]);

  // ── Save simulation ───────────────────────────────────────────
  const handleSaveSimulation = async () => {
    if (!user?.id || !resolvedClienteId || !mesProximo) return;
    setSavingSim(true);
    try {
      const rows = Object.entries(simLocalMap)
        .filter(([, v]) => v.meta_valor !== null)
        .map(([conta_id, v]) => ({
          usuario_id: user.id,
          cliente_id: resolvedClienteId,
          conta_id,
          competencia: mesProximo,
          meta_tipo: v.meta_tipo,
          meta_valor: v.meta_valor,
          updated_at: new Date().toISOString(),
        }));
      if (rows.length > 0) {
        const { error } = await supabase.from('torre_simulacoes' as any).upsert(rows, { onConflict: 'usuario_id,cliente_id,conta_id,competencia' });
        if (error) throw error;
      }
      toast.success('Simulação salva ✓');
      setSimDirty(false);
    } catch (err) {
      toast.error('Erro ao salvar simulação');
    } finally { setSavingSim(false); }
  };

  // ── Card calculations ─────────────────────────────────────────
  const cardData = useMemo(() => {
    if (!dreContas || !dreValoresAnuais || !competencia) return null;

    const leafs = dreContas.filter(c => c.nivel === 2 && !c.is_total);
    const currMap = getDreMonthMap(competencia);
    const prevMap = getDreMonthMap(getCompetenciaAnterior(competencia));

    const sumLeafsByTipo = (map: Record<string, number | null>, tipos: string[]) => {
      let total = 0;
      for (const c of leafs) { if (tipos.includes(c.tipo) && map[c.id] != null) total += map[c.id]!; }
      return total;
    };

    const fat = sumLeafsByTipo(currMap, ['receita']);
    const fatPrev = sumLeafsByTipo(prevMap, ['receita']);
    const custos = sumLeafsByTipo(currMap, ['custo_variavel']);
    const custosPrev = sumLeafsByTipo(prevMap, ['custo_variavel']);
    const mc = fat + custos;
    const mcPrev = fatPrev + custosPrev;
    const despFixas = sumLeafsByTipo(currMap, ['despesa_fixa']);
    const despFixasPrev = sumLeafsByTipo(prevMap, ['despesa_fixa']);
    const ro = mc + despFixas;
    const roPrev = mcPrev + despFixasPrev;
    const invest = sumLeafsByTipo(currMap, ['investimento']);
    const investPrev = sumLeafsByTipo(prevMap, ['investimento']);
    const financ = sumLeafsByTipo(currMap, ['financeiro']);
    const financPrev = sumLeafsByTipo(prevMap, ['financeiro']);
    const gc = ro + invest + financ;
    const gcPrev = roPrev + investPrev + financPrev;

    // Sparklines: last 6 months for each metric
    const getSparkData = (tipos: string[], cumulative?: string[][]) => {
      const months = dreMonthsAll.slice(-6);
      return months.map(m => {
        const map = getDreMonthMap(m);
        if (cumulative) {
          let total = 0;
          for (const ts of cumulative) total += sumLeafsByTipo(map, ts);
          return total;
        }
        return sumLeafsByTipo(map, tipos);
      });
    };

    const pctVar = (curr: number, prev: number) => prev !== 0 ? ((curr - prev) / Math.abs(prev)) * 100 : 0;
    const avPct = (val: number) => fat !== 0 ? (Math.abs(val) / Math.abs(fat)) * 100 : 0;

    return {
      fat, fatPrev, fatVar: pctVar(fat, fatPrev), fatAV: 100, fatSpark: getSparkData(['receita']),
      custos, custosPrev, custosVar: pctVar(custos, custosPrev), custosAV: avPct(custos), custosSpark: getSparkData(['custo_variavel']),
      mc, mcPrev, mcVar: pctVar(mc, mcPrev), mcAV: avPct(mc), mcSpark: getSparkData([], [['receita'], ['custo_variavel']]),
      despFixas, despFixasPrev, despFixasVar: pctVar(despFixas, despFixasPrev), despFixasAV: avPct(despFixas), despFixasSpark: getSparkData(['despesa_fixa']),
      ro, roPrev, roVar: pctVar(ro, roPrev), roAV: avPct(ro), roSpark: getSparkData([], [['receita'], ['custo_variavel'], ['despesa_fixa']]),
      gc, gcPrev, gcVar: pctVar(gc, gcPrev), gcAV: avPct(gc), gcSpark: getSparkData([], [['receita'], ['custo_variavel'], ['despesa_fixa'], ['investimento'], ['financeiro']]),
    };
  }, [dreContas, dreValoresAnuais, competencia, dreMonthsAll, getDreMonthMap]);

  // ── DreIndicadoresHeader months format ─────────────────────────
  const dreIndicadorMonths = useMemo(() => {
    const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const mesesShort = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    return dreMonthsAll.map(m => {
      const d = new Date(m + 'T12:00:00');
      return { value: m, label: `${meses[d.getMonth()]}/${d.getFullYear()}`, shortLabel: mesesShort[d.getMonth()] };
    });
  }, [dreMonthsAll]);

  // ── Gauge data (torre_metas subgroups with metas) ─────────────
  const gaugeData = useMemo(() => {
    if (!dreContas || !torreMetas || torreMetas.length === 0) return [];
    const n1Contas = dreContas.filter(c => c.nivel === 1);
    const result: { nome: string; tipo: string; realizado: number; meta: number; pct: number }[] = [];
    for (const n1 of n1Contas) {
      const meta = torreMetaMap[n1.id];
      if (!meta || meta.meta_valor === null) continue;
      const realVal = torreRealMap[n1.id];
      // Sum children for N1
      const children = dreContas.filter(c => c.conta_pai_id === n1.id && c.nivel === 2);
      let realSum = 0;
      for (const ch of children) { realSum += torreRealMap[ch.id] ?? 0; }
      const proj = calcProjetado(realSum, meta, n1.tipo);
      if (proj === null) continue;
      const pct = Math.abs(proj) !== 0 ? (Math.abs(realSum) / Math.abs(proj)) * 100 : 0;
      result.push({ nome: n1.nome, tipo: n1.tipo, realizado: Math.abs(realSum), meta: Math.abs(proj), pct });
      if (result.length >= 6) break;
    }
    return result;
  }, [dreContas, torreMetas, torreMetaMap, torreRealMap]);

  // ══ EARLY RETURNS ═════════════════════════════════════════════
  if (loadingEmpresas) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: C.bg }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1A3CFF] border-t-transparent" />
      </div>
    );
  }

  if (noAccess) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4" style={{ background: C.bg }}>
        <img src={gpiLogo} alt="GPI" className="h-10 w-auto" />
        <p className="text-sm text-center max-w-sm" style={{ color: C.txtSec }}>
          Nenhuma empresa vinculada ao seu usuário. Entre em contato com a GPI para solicitar acesso.
        </p>
      </div>
    );
  }

  if (!propClienteId && !clienteIdSelecionado && empresas.length >= 2) {
    return (
      <div className="flex flex-col items-center py-12 px-4 min-h-screen" style={{ background: C.bg }}>
        <img src={gpiLogo} alt="GPI" className="h-10 w-auto mb-8" />
        <h1 className="text-xl font-bold mb-1" style={{ color: C.txt }}>Selecione a empresa</h1>
        <p className="text-sm mb-8" style={{ color: C.txtSec }}>Você tem acesso a {empresas.length} empresas</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-[600px]">
          {empresas.map((e) => (
            <button
              key={e.cliente_id}
              onClick={() => setClienteIdSelecionado(e.cliente_id)}
              className="relative rounded-xl bg-white p-6 text-left shadow-sm transition-all hover:shadow-md hover:scale-[1.01]"
              style={{ border: e.empresa_padrao ? `2px solid ${C.primary}` : `1px solid ${C.border}` }}
            >
              {e.empresa_padrao && (
                <span className="absolute top-3 right-3 rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: '#EBF0FF', color: C.primary }}>★ Principal</span>
              )}
              <span className="text-2xl mb-3 block">🏢</span>
              <p className="text-sm font-bold mb-4" style={{ color: C.txt }}>{e.razao_social || e.nome_empresa}</p>
              <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: C.primary }}>Acessar <ArrowRight className="h-3 w-3" /></span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen" style={{ background: C.bg }}>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#1A3CFF] border-t-transparent" />
      </div>
    );
  }

  if (!espelho && competenciasLiberadas.length === 0 && !loadingCompetencias) {
    return (
      <div className="min-h-screen" style={{ background: C.bg }}>
        <header className="sticky top-0 z-30 bg-white px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src={gpiLogo} alt="GPI" className="h-8 w-auto" />
              <span className="text-sm font-semibold" style={{ color: C.txt }}>{cliente?.razao_social || cliente?.nome_empresa || ''}</span>
            </div>
            {!espelho && <button onClick={signOut} className="rounded-md p-1.5 transition-colors" style={{ color: C.txtSec }}><LogOut className="h-4 w-4" /></button>}
          </div>
        </header>
        <div className="max-w-[600px] mx-auto py-16 px-4">
          <div className="rounded-xl bg-white p-10 shadow-sm text-center space-y-4" style={{ border: `1px solid ${C.border}` }}>
            <span className="text-5xl">📊</span>
            <h2 className="text-lg font-bold" style={{ color: C.txt }}>Seus dados estão sendo preparados</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.txtSec }}>Seu consultor está analisando os números e em breve você terá acesso ao seu painel financeiro completo.</p>
          </div>
        </div>
      </div>
    );
  }

  const showTrocarEmpresa = !propClienteId && empresas.length >= 2;
  const empresaAtual = empresas.find(e => e.cliente_id === resolvedClienteId);

  // ── Helper for torre rows ─────────────────────────────────────
  const renderTorreRow = (node: DreNode, metaMap: Record<string, TorreMeta>, realMap: Record<string, number | null>, collapsedSet: Set<string>, toggleFn: (id: string) => void, editable: boolean) => {
    const conta = node.conta;
    const isGrupo = conta.nivel === 0;
    const isSubgrupo = conta.nivel === 1;
    const isCat = conta.nivel === 2;
    const isTotal = !!conta.is_total;
    const hasChildren = node.children.length > 0;
    const isCollapsedItem = collapsedSet.has(conta.id);

    // Hide zero N2s
    if (isCat && !isTotal) {
      const val = realMap[conta.id];
      if (val == null || val === 0) return null;
    }

    const paddingLeft = isGrupo ? 12 : isSubgrupo ? 24 : 48;
    let rowBg = '#FAFCFF', fontWeight = 400, fontSize = 12, textColor = C.txtSec;
    if (isTotal) { rowBg = '#0D1B35'; fontWeight = 700; textColor = '#FFFFFF'; }
    else if (isGrupo) { rowBg = '#F0F4FA'; fontWeight = 700; textColor = C.txt; }
    else if (isSubgrupo) { rowBg = '#FFFFFF'; fontWeight = 600; textColor = C.txt; }

    const meta = metaMap[conta.id] || null;
    const realSel = isCat ? (realMap[conta.id] ?? null) : sumNodeLeafs(node, realMap);
    const projetado = isCat
      ? (realSel != null ? calcProjetado(realSel, meta, conta.tipo) : null)
      : sumNodeProjetado(node, realMap, metaMap);

    // Ajuste%
    let ajustePct: number | null = null;
    if (realSel != null && projetado != null && realSel !== 0) {
      ajustePct = ((projetado - realSel) / Math.abs(realSel)) * 100;
    }

    const isReceita = conta.tipo === 'receita';
    const getAjusteColor = () => {
      if (ajustePct == null || Math.abs(ajustePct) < 0.05) return C.txtMuted;
      if (isReceita) return ajustePct > 0 ? C.green : C.red;
      return ajustePct > 0 ? C.red : C.green;
    };

    const ajusteArrow = ajustePct != null
      ? (ajustePct > 0.05 ? '↑ +' : ajustePct < -0.05 ? '↓ −' : '→ ')
      : '';

    return (
      <Fragment key={conta.id}>
        <tr style={{ background: rowBg, borderBottom: isTotal ? 'none' : `1px solid ${isGrupo ? C.borderStr : '#F8F9FB'}`, borderTop: isGrupo && !isTotal ? `1px solid ${C.borderStr}` : 'none' }}>
          <td style={{ padding: `8px 8px 8px ${paddingLeft}px`, fontWeight, fontSize, color: textColor, whiteSpace: 'nowrap', minWidth: 220, position: 'sticky', left: 0, zIndex: 5, background: rowBg, borderRight: `1px solid ${C.border}` }}>
            <span className="flex items-center gap-1.5">
              {hasChildren && !isTotal && (isGrupo || isSubgrupo) ? (
                <button onClick={() => toggleFn(conta.id)} style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 2, lineHeight: 0, color: C.txtMuted }}>
                  {isCollapsedItem ? <ChevronRight style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
                </button>
              ) : <span style={{ width: 18 }} />}
              {isTotal && <span style={{ color: C.cyan, fontSize: 13 }}>◈</span>}
              <span style={{ letterSpacing: isGrupo && !isTotal ? '0.04em' : undefined, textTransform: isGrupo && !isTotal ? 'uppercase' : undefined }}>{conta.nome}</span>
            </span>
          </td>
          {/* Realizado */}
          <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400), color: realSel != null ? (realSel < 0 ? C.red : (isTotal ? '#FFF' : C.txt)) : C.txtMuted, padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined }}>
            {fmtTorre(realSel)}
          </td>
          {/* Ajuste */}
          <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 500, color: getAjusteColor(), padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined }}>
            {isTotal ? '—' : (ajustePct != null && Math.abs(ajustePct) >= 0.05 ? `${ajusteArrow}${Math.abs(ajustePct).toFixed(1)}%` : '—')}
          </td>
          {/* Meta projetado */}
          <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400), color: projetado != null ? (isTotal ? '#FFF' : C.primary) : C.txtMuted, padding: '8px 10px', background: isTotal ? 'rgba(26,60,255,0.18)' : C.pLo }}>
            {editable && isCat && !isTotal ? (
              <input
                type="text"
                defaultValue={projetado != null ? Math.abs(projetado).toFixed(0) : ''}
                onChange={(e) => {
                  const val = parseFloat(e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.'));
                  if (!isNaN(val)) {
                    const sign = conta.tipo !== 'receita' ? -1 : 1;
                    const pctVal = realSel && realSel !== 0 ? Math.round(((sign * val / realSel) - 1) * 10000) / 100 : 0;
                    setSimLocalMap(prev => ({ ...prev, [conta.id]: { meta_tipo: 'pct', meta_valor: pctVal } }));
                    setSimDirty(true);
                  }
                }}
                style={{ width: 80, textAlign: 'right', fontFamily: C.mono, fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px', outline: 'none', background: C.surfaceHi, color: C.primary }}
              />
            ) : fmtTorre(projetado)}
          </td>
        </tr>
        {/* Children */}
        {hasChildren && !isCollapsedItem && node.children.map(child => renderTorreRow(child, metaMap, realMap, collapsedSet, toggleFn, editable))}
      </Fragment>
    );
  };

  // ── Build torre table ─────────────────────────────────────────
  const renderTorreTable = (metaMap: Record<string, TorreMeta>, realMap: Record<string, number | null>, collapsedSet: Set<string>, toggleFn: (id: string) => void, editable: boolean) => {
    const rows: JSX.Element[] = [];
    const calcTotais = (tipos: string[]) => {
      let total = 0;
      for (const tipo of tipos) {
        for (const g of (dreGruposPorTipo[tipo] || [])) {
          const v = sumNodeProjetado(g, realMap, metaMap);
          if (v != null) total += v;
        }
      }
      return total;
    };

    for (const seq of SEQUENCIA_DRE) {
      const grupos = dreGruposPorTipo[seq.tipo] || [];
      for (const g of grupos) {
        const row = renderTorreRow(g, metaMap, realMap, collapsedSet, toggleFn, editable);
        if (row) rows.push(row);
      }
      if (seq.totalizadorApos) {
        const cfg = TOTALIZADOR_CONFIG[seq.totalizadorApos];
        const tiposAcum = SEQUENCIA_DRE.slice(0, SEQUENCIA_DRE.findIndex(s => s.totalizadorApos === seq.totalizadorApos) + 1).map(s => s.tipo);
        const realTotal = tiposAcum.reduce((acc, t) => acc + sumGrupos(dreGruposPorTipo[t] || [], realMap), 0);
        const projTotal = calcTotais(tiposAcum);
        let ajPct: number | null = realTotal !== 0 ? ((projTotal - realTotal) / Math.abs(realTotal)) * 100 : null;
        rows.push(
          <tr key={`tot-${cfg.key}`} style={{ background: '#0D1B35', borderBottom: 'none' }}>
            <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', position: 'sticky', left: 0, zIndex: 5, background: '#0D1B35', borderRight: `1px solid ${C.border}` }}>
              <span className="flex items-center gap-1.5"><span style={{ color: C.cyan, fontSize: 13 }}>◈</span>{cfg.nome}</span>
            </td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: '#FFFFFF', padding: '8px 10px', background: '#0D1B35' }}>
              {fmtTorre(realTotal)}
            </td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 500, color: C.txtMuted, padding: '8px 10px', background: '#0D1B35' }}>—</td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: '#FFFFFF', padding: '8px 10px', background: 'rgba(26,60,255,0.18)' }}>
              {fmtTorre(projTotal)}
            </td>
          </tr>
        );
      }
    }
    return rows;
  };

  // ══ MAIN RENDER ═══════════════════════════════════════════════
  return (
    <div style={{ width: '100%', background: C.bg, fontFamily: 'DM Sans, sans-serif' }} className="min-h-screen">
      {/* ── SEÇÃO 1: HEADER STICKY ─────────────────────────────── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: '#FFFFFF', borderBottom: `1px solid ${C.border}`, boxShadow: '0 1px 8px rgba(13,27,53,0.06)' }}>
        {/* Linha superior */}
        <div className="flex items-center justify-between" style={{ padding: '10px 24px' }}>
          <div className="flex items-center gap-3">
            <img src={gpiLogo} alt="GPI" className="h-8 w-auto" />
            <span className="text-sm font-semibold" style={{ color: C.txt }}>{cliente?.razao_social || cliente?.nome_empresa}</span>
            <span className="rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ background: '#EBF0FF', color: C.primary }}>Portal do Cliente</span>
          </div>

          {/* Seletor de empresa (centro) */}
          {showTrocarEmpresa && (
            <div className="relative">
              <button
                onClick={() => setEmpresaDropdownOpen(!empresaDropdownOpen)}
                className="inline-flex items-center gap-2 rounded-[10px] px-3 py-1.5 text-xs font-semibold transition-colors"
                style={{ background: C.surfaceHi, border: `1.5px solid ${C.borderStr}`, color: C.txt }}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: C.green }} />
                {empresaAtual?.razao_social || empresaAtual?.nome_empresa || 'Empresa'}
                <ChevronDown className="h-3 w-3" style={{ color: C.txtMuted }} />
              </button>
              {empresaDropdownOpen && (
                <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 rounded-lg bg-white shadow-lg border z-50 min-w-[200px]" style={{ borderColor: C.border }}>
                  {empresas.map(e => (
                    <button
                      key={e.cliente_id}
                      onClick={() => {
                        setClienteIdSelecionado(e.cliente_id);
                        setEmpresaDropdownOpen(false);
                        setCliente(null); setKpi(null); setKpiAnterior(null); setScore(null);
                        setIndicadoresCalc([]); setAlertas([]); setProximaReuniao(null);
                      }}
                      className="w-full text-left px-4 py-2.5 text-xs hover:bg-[#F6F9FF] transition-colors first:rounded-t-lg last:rounded-b-lg"
                      style={{ color: e.cliente_id === resolvedClienteId ? C.primary : C.txt, fontWeight: e.cliente_id === resolvedClienteId ? 700 : 400 }}
                    >
                      {e.empresa_padrao && <span className="mr-1">★</span>}
                      {e.razao_social || e.nome_empresa}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!espelho && (
            <button onClick={signOut} className="rounded-md p-1.5 transition-colors hover:text-[#DC2626]" style={{ color: C.txtSec }}>
              <LogOut className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Linha inferior: chips de competência */}
        {competenciasLiberadas.length > 1 && (
          <div style={{ padding: '0 24px 10px', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.txtMuted, marginRight: 4 }}>Competência</span>
            {competenciasLiberadas.map(m => {
              const isAtivo = m === competencia;
              return (
                <button
                  key={m}
                  onClick={() => setCompetenciaSelecionada(m)}
                  style={{
                    padding: '4px 14px', borderRadius: 20, fontSize: 11, fontWeight: isAtivo ? 700 : 500,
                    cursor: 'pointer', transition: 'all 0.15s',
                    border: isAtivo ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`,
                    background: isAtivo ? C.primary : '#fff',
                    color: isAtivo ? '#FFFFFF' : C.txtSec,
                    boxShadow: isAtivo ? '0 2px 8px rgba(26,60,255,0.22)' : 'none',
                  }}
                >
                  {getMonthShort(m)}/{m.substring(2, 4)}
                </button>
              );
            })}
          </div>
        )}
      </header>

      <main className="space-y-6" style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>

        {/* ── SEÇÃO 2: CARDS DE RESUMO (DreIndicadoresHeader) ── */}
        {dreContas && dreContas.length > 0 && dreValoresAnuais && dreValoresAnuais.length > 0 && (
          <DreIndicadoresHeader
            contas={dreContas}
            valoresAnuais={dreValoresAnuais}
            months={dreIndicadorMonths}
            mesSelecionado={competencia}
            clienteId={resolvedClienteId || undefined}
          />
        )}

        {/* ── SEÇÃO 3: ALERTAS DE META (SPEEDOMETER GAUGES) ── */}
        {gaugeData.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txtMuted, marginBottom: 10 }}>Alertas de Meta</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
              {gaugeData.map((g, i) => (
                <SpeedometerGauge
                  key={i}
                  nome={g.nome}
                  pctAtingido={g.pct}
                  realizado={g.realizado}
                  meta={g.meta}
                  tipo={g.tipo}
                  fmtR$={fmtR$}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── SEÇÃO 4: DRE FINANCEIRA ────────────────────────── */}
        {dreContas && dreContas.length > 0 && dreValoresAnuais && dreValoresAnuais.length > 0 && (
          <div>
            {/* DRE Banner */}
            <div style={{ marginBottom: 12 }}>
              <DreBanner
                faturamento={cardData?.fat}
                mcPct={cardData ? (cardData.fat !== 0 ? (cardData.mc / Math.abs(cardData.fat)) * 100 : null) : null}
                gcPct={cardData ? (cardData.fat !== 0 ? (cardData.gc / Math.abs(cardData.fat)) * 100 : null) : null}
              />
            </div>

          <div className="rounded-[14px] bg-white overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            {/* Toolbar */}
            <div className="flex items-center justify-between" style={{ padding: '12px 16px', borderBottom: `1px solid #F0F4FA` }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                {dreMonthsAll.map(m => {
                  const isActive = dreMonthsActive.has(m);
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        setDreMonthsActive(prev => {
                          const next = new Set(prev);
                          if (next.has(m)) next.delete(m);
                          else next.add(m);
                          return next;
                        });
                      }}
                      style={{
                        padding: '4px 10px', borderRadius: 14, fontSize: 10, fontWeight: isActive ? 700 : 500,
                        cursor: 'pointer', transition: 'all 0.15s',
                        border: isActive ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`,
                        background: isActive ? C.primary : '#fff',
                        color: isActive ? '#FFFFFF' : C.txtSec,
                      }}
                    >
                      {getMonthShort(m)}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center gap-1.5">
                {[
                  { key: 'av', label: 'AV%', active: showAV, toggle: () => setShowAV(v => !v) },
                  { key: 'ah', label: 'AH%', active: showAH, toggle: () => setShowAH(v => !v) },
                ].map(b => (
                  <button
                    key={b.key}
                    onClick={b.toggle}
                    style={{
                      padding: '4px 12px', borderRadius: 6, fontSize: 12, fontWeight: 500,
                      border: `1px solid ${b.active ? C.primary : C.border}`,
                      background: b.active ? '#E8EEF8' : '#F0F4FA',
                      color: b.active ? C.primary : C.txtSec,
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {b.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F0F4FA', borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txtMuted, position: 'sticky', left: 0, zIndex: 10, background: '#F0F4FA', borderRight: `1px solid ${C.border}`, minWidth: 220 }}>
                      CONTA DRE
                    </th>
                    {Array.from(dreMonthsActive).sort().map(m => {
                      const isSel = m === competencia;
                      return (
                        <Fragment key={m}>
                          <th style={{
                            textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em',
                            color: isSel ? C.primary : C.txtMuted, textTransform: 'uppercase',
                            background: isSel ? C.pLo : '#F0F4FA', minWidth: 90,
                          }}>
                            {isSel && '▲ '}{getMonthShort(m)}
                          </th>
                          {showAV && <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 9, fontWeight: 600, color: C.txtMuted, background: isSel ? C.pLo : '#F0F4FA', minWidth: 55 }}>AV%</th>}
                          {showAH && <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 9, fontWeight: 600, color: C.txtMuted, background: isSel ? C.pLo : '#F0F4FA', minWidth: 55 }}>AH%</th>}
                        </Fragment>
                      );
                    })}
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: C.txtMuted, textTransform: 'uppercase', background: '#F0F4FA', minWidth: 100 }}>
                      ACUMULADO
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows: JSX.Element[] = [];
                    const activeMonths = Array.from(dreMonthsActive).sort();

                    const renderDreRow = (node: DreNode): JSX.Element | null => {
                      const conta = node.conta;
                      const isGrupo = conta.nivel === 0;
                      const isSubgrupo = conta.nivel === 1;
                      const isCat = conta.nivel === 2;
                      const isTotal = !!conta.is_total;
                      const hasChildren = node.children.length > 0;
                      const isCollapsed = dreCollapsed.has(conta.id);

                      if (isCat && !isTotal) {
                        const hasAnyVal = dreMonthsAll.some(m => {
                          const v = dreValoresMap[conta.id]?.[m];
                          return v != null && v !== 0;
                        });
                        if (!hasAnyVal) return null;
                      }

                      const paddingLeft = isGrupo ? 12 : isSubgrupo ? 24 : 48;
                      let rowBg = '#FAFCFF', fontWeight = 400, textColor = C.txtSec;
                      if (isTotal) { rowBg = '#0D1B35'; fontWeight = 700; textColor = '#FFFFFF'; }
                      else if (isGrupo) { rowBg = '#F0F4FA'; fontWeight = 700; textColor = C.txt; }
                      else if (isSubgrupo) { rowBg = '#FFFFFF'; fontWeight = 600; textColor = C.txt; }

                      // Acumulado
                      let acum = 0;
                      dreMonthsAll.forEach(m => {
                        const map = getDreMonthMap(m);
                        const v = isCat ? (map[conta.id] ?? 0) : (sumNodeLeafs(node, map) ?? 0);
                        acum += v;
                      });

                      return (
                        <Fragment key={conta.id}>
                          <tr style={{ background: rowBg, borderBottom: isTotal ? 'none' : `1px solid ${isGrupo ? C.borderStr : '#F8F9FB'}`, borderTop: isGrupo && !isTotal ? `1px solid ${C.borderStr}` : 'none' }}>
                            <td style={{ padding: `8px 8px 8px ${paddingLeft}px`, fontWeight, fontSize: 12, color: textColor, whiteSpace: 'nowrap', minWidth: 220, position: 'sticky', left: 0, zIndex: 5, background: rowBg, borderRight: `1px solid ${C.border}` }}>
                              <span className="flex items-center gap-1.5">
                                {hasChildren && !isTotal && (isGrupo || isSubgrupo) ? (
                                  <button onClick={() => { setDreCollapsed(prev => { const n = new Set(prev); if (n.has(conta.id)) n.delete(conta.id); else n.add(conta.id); return n; }); }} style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 2, lineHeight: 0, color: C.txtMuted }}>
                                    {isCollapsed ? <ChevronRight style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
                                  </button>
                                ) : <span style={{ width: 18 }} />}
                                {isTotal && <span style={{ color: C.cyan, fontSize: 13 }}>◈</span>}
                                <span style={{ letterSpacing: isGrupo && !isTotal ? '0.04em' : undefined, textTransform: isGrupo && !isTotal ? 'uppercase' : undefined }}>{conta.nome}</span>
                              </span>
                            </td>
                            {activeMonths.map(m => {
                              const map = getDreMonthMap(m);
                              const val = isCat ? (map[conta.id] ?? null) : sumNodeLeafs(node, map);
                              const isSel = m === competencia;
                              const fat = sumGrupos(dreGruposPorTipo['receita'] || [], map);

                              // AH: compare to previous month
                              const prevComp = getCompetenciaAnterior(m);
                              const prevMap = getDreMonthMap(prevComp);
                              const prevVal = isCat ? (prevMap[conta.id] ?? null) : sumNodeLeafs(node, prevMap);

                              return (
                                <Fragment key={m}>
                                  <td style={{
                                    textAlign: 'right', fontFamily: C.mono, fontSize: 12,
                                    fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400),
                                    color: val != null ? (val < 0 ? C.red : (isTotal ? '#FFF' : (isSel ? C.primary : C.txt))) : C.txtMuted,
                                    padding: '8px 10px',
                                    background: isSel ? (isTotal ? '#0D1B35' : C.pLo) : (isTotal ? '#0D1B35' : undefined),
                                  }}>
                                    {fmtTorre(val)}
                                  </td>
                                  {showAV && (
                                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 10, color: C.txtMuted, padding: '8px 6px', background: isSel ? C.pLo : (isTotal ? '#0D1B35' : undefined) }}>
                                      {val != null && fat !== 0 ? `${((Math.abs(val) / Math.abs(fat)) * 100).toFixed(1)}%` : '—'}
                                    </td>
                                  )}
                                  {showAH && (
                                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 10, padding: '8px 6px', background: isSel ? C.pLo : (isTotal ? '#0D1B35' : undefined), color: val != null && prevVal != null && prevVal !== 0 ? (((val - prevVal) / Math.abs(prevVal)) >= 0 ? C.green : C.red) : C.txtMuted }}>
                                      {val != null && prevVal != null && prevVal !== 0 ? `${(((val - prevVal) / Math.abs(prevVal)) * 100).toFixed(1)}%` : '—'}
                                    </td>
                                  )}
                                </Fragment>
                              );
                            })}
                            {/* Acumulado */}
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400), color: acum < 0 ? C.red : (isTotal ? '#FFF' : C.txt), padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined }}>
                              {fmtTorre(acum)}
                            </td>
                          </tr>
                          {hasChildren && !isCollapsed && node.children.map(child => renderDreRow(child))}
                        </Fragment>
                      );
                    };

                    for (const seq of SEQUENCIA_DRE) {
                      const grupos = dreGruposPorTipo[seq.tipo] || [];
                      for (const g of grupos) {
                        const row = renderDreRow(g);
                        if (row) rows.push(row);
                      }
                      if (seq.totalizadorApos) {
                        const cfg = TOTALIZADOR_CONFIG[seq.totalizadorApos];
                        const tiposAcum = SEQUENCIA_DRE.slice(0, SEQUENCIA_DRE.findIndex(s => s.totalizadorApos === seq.totalizadorApos) + 1).map(s => s.tipo);

                        rows.push(
                          <tr key={`tot-${cfg.key}`} style={{ background: '#0D1B35' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', position: 'sticky', left: 0, zIndex: 5, background: '#0D1B35', borderRight: `1px solid ${C.border}` }}>
                              <span className="flex items-center gap-1.5"><span style={{ color: C.cyan, fontSize: 13 }}>◈</span>{cfg.nome}</span>
                            </td>
                            {activeMonths.map(m => {
                              const map = getDreMonthMap(m);
                              const total = tiposAcum.reduce((acc, t) => acc + sumGrupos(dreGruposPorTipo[t] || [], map), 0);
                              const isSel = m === competencia;
                              const fat = sumGrupos(dreGruposPorTipo['receita'] || [], map);
                              const prevMap = getDreMonthMap(getCompetenciaAnterior(m));
                              const prevTotal = tiposAcum.reduce((acc, t) => acc + sumGrupos(dreGruposPorTipo[t] || [], prevMap), 0);

                              return (
                                <Fragment key={m}>
                                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: '#FFFFFF', padding: '8px 10px', background: isSel ? 'rgba(26,60,255,0.18)' : '#0D1B35' }}>
                                    {fmtTorre(total)}
                                  </td>
                                  {showAV && <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 10, fontWeight: 600, color: total >= 0 ? '#00E68A' : '#FF6B6B', padding: '8px 6px', background: isSel ? 'rgba(26,60,255,0.18)' : '#0D1B35' }}>{fat !== 0 ? `${((Math.abs(total) / Math.abs(fat)) * 100).toFixed(1)}%` : '—'}</td>}
                                  {showAH && <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 10, fontWeight: 600, color: prevTotal !== 0 ? (((total - prevTotal) / Math.abs(prevTotal)) >= 0 ? '#00E68A' : '#FF6B6B') : C.txtMuted, padding: '8px 6px', background: isSel ? 'rgba(26,60,255,0.18)' : '#0D1B35' }}>{prevTotal !== 0 ? `${(((total - prevTotal) / Math.abs(prevTotal)) * 100).toFixed(1)}%` : '—'}</td>}
                                </Fragment>
                              );
                            })}
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: '#FFFFFF', padding: '8px 10px', background: '#0D1B35' }}>
                              {fmtTorre(tiposAcum.reduce((acc, t) => acc + dreMonthsAll.reduce((s, m) => s + sumGrupos(dreGruposPorTipo[t] || [], getDreMonthMap(m)), 0), 0))}
                            </td>
                          </tr>
                        );
                      }
                    }
                    return rows;
                  })()}
                </tbody>
              </table>
            </div>
          </div>
          </div>
        )}

        {/* ── SEÇÃO 5: APRESENTAÇÃO DO MÊS ───────────────────── */}
        {competencia && (
          <div className="rounded-[14px] bg-white flex items-center justify-between" style={{ border: `1px solid ${C.border}`, padding: '18px 24px' }}>
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center rounded-lg" style={{ width: 44, height: 44, background: 'rgba(26,60,255,0.08)', border: '1px solid rgba(26,60,255,0.2)' }}>
                <span className="text-xl">📊</span>
              </div>
              <div>
                <p className="text-sm font-bold" style={{ color: C.txt }}>Apresentação do Mês — {fmtMesAno(competencia)}</p>
                <p className="text-[11px]" style={{ color: C.txtMuted }}>Relatório consultivo preparado pela equipe GPI</p>
                {hasApresentacao ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold mt-1" style={{ color: C.green }}>● Disponível para visualizar</span>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold mt-1" style={{ color: C.orange }}>● Em preparação</span>
                    <p className="text-[10px] mt-0.5" style={{ color: C.txtMuted }}>Seu consultor está preparando o relatório deste mês</p>
                  </>
                )}
              </div>
            </div>
            {!espelho && (
              <button
                onClick={() => hasApresentacao ? navigate(`/apresentacao/${resolvedClienteId}`) : undefined}
                disabled={!hasApresentacao}
                className="inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all"
                style={{ background: C.primary, boxShadow: '0 2px 8px rgba(26,60,255,0.18)', opacity: hasApresentacao ? 1 : 0.5, cursor: hasApresentacao ? 'pointer' : 'not-allowed' }}
              >
                <Play className="h-4 w-4" /> Iniciar Apresentação
              </button>
            )}
          </div>
        )}

        {/* ── SEÇÃO 6: TORRE DE CONTROLE ──────────────────────── */}
        {dreContas && dreContas.length > 0 && (torreMetas || []).length > 0 && (
          <div>
            {/* Torre Banner */}
            <div style={{ marginBottom: 12 }}>
              <TorreBanner />
            </div>
          <div className="rounded-[14px] bg-white overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
              <p className="text-[11px]" style={{ color: C.txtMuted }}>Planejamento definido pela equipe GPI para o próximo mês</p>
            </div>

            {/* Tabs */}
            <div className="flex" style={{ borderBottom: `1px solid ${C.border}` }}>
              {[
                { key: 'gpi' as const, label: 'Metas GPI' },
                { key: 'simulacao' as const, label: 'Minha Simulação' },
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setTorreTab(tab.key)}
                  style={{
                    padding: '10px 20px', fontSize: 12, fontWeight: torreTab === tab.key ? 700 : 500,
                    color: torreTab === tab.key ? C.primary : C.txtSec,
                    background: torreTab === tab.key ? '#fff' : C.surfaceHi,
                    borderBottom: torreTab === tab.key ? `2px solid ${C.primary}` : '2px solid transparent',
                    cursor: 'pointer', border: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Simulação banner */}
            {torreTab === 'simulacao' && (
              <div className="flex items-center justify-between" style={{ padding: '10px 20px', background: 'rgba(217,119,6,0.06)', borderBottom: '1px solid rgba(217,119,6,0.2)' }}>
                <p className="text-xs" style={{ color: '#92400E' }}>⚠ Modo Simulação — suas alterações não afetam as metas definidas pela GPI</p>
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-[11px] font-semibold transition-colors"
                  style={{ border: `1px solid ${C.orange}`, color: C.orange, background: 'transparent' }}
                >
                  ↓ Exportar PDF
                </button>
              </div>
            )}

            {/* Torre table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F0F4FA', borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txtMuted, position: 'sticky', left: 0, zIndex: 10, background: '#F0F4FA', borderRight: `1px solid ${C.border}`, minWidth: 220 }}>CONTA DRE</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, minWidth: 100 }}>REALIZADO {getMonthShort(competencia)}</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, minWidth: 80 }}>AJUSTE</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.primary, minWidth: 110, background: C.pLo }}>META {getMonthShort(mesProximo)}</th>
                  </tr>
                </thead>
                <tbody>
                  {torreTab === 'gpi'
                    ? renderTorreTable(torreMetaMap, torreRealMap, torreCollapsed, (id) => setTorreCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }), false)
                    : renderTorreTable(
                        // Build TorreMeta from simLocalMap
                        Object.fromEntries(Object.entries(simLocalMap).map(([k, v]) => [k, { conta_id: k, meta_tipo: v.meta_tipo as any, meta_valor: v.meta_valor }])),
                        torreRealMap,
                        torreCollapsed,
                        (id) => setTorreCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
                        true
                      )
                  }
                </tbody>
              </table>
            </div>

            {/* Save simulation button */}
            {torreTab === 'simulacao' && simDirty && (
              <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, textAlign: 'right' }}>
                <button
                  onClick={handleSaveSimulation}
                  disabled={savingSim}
                  className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white transition-all"
                  style={{ background: C.primary, opacity: savingSim ? 0.6 : 1 }}
                >
                  {savingSim ? 'Salvando...' : 'Salvar simulação'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── MEU PAINEL (widgets) ────────────────────────────── */}
        {portalWidgets.length > 0 && resolvedClienteId && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, paddingBottom: 10, borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 16 }}>📊</span>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: C.txt, margin: 0 }}>Meu Painel</h2>
              <span style={{ fontSize: 10, color: C.txtMuted, fontWeight: 500, marginLeft: 4 }}>Indicadores personalizados pela GPI</span>
            </div>
            <PainelPersonalizado clienteId={resolvedClienteId} competencia={competencia} modoConfig={false} modoPortal={true} />
          </section>
        )}

        {/* ── SEÇÃO 7: PRÓXIMA REUNIÃO ───────────────────────── */}
        <div className="rounded-[14px] bg-white overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
          <div className="flex items-center gap-3" style={{ padding: '14px 20px', background: C.surfaceHi, borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center justify-center rounded-lg" style={{ width: 36, height: 36, background: 'rgba(0,153,230,0.1)' }}>
              <Calendar className="h-5 w-5" style={{ color: C.cyan }} />
            </div>
            <div>
              <p className="text-[13px] font-bold" style={{ color: C.txt }}>Próxima Reunião</p>
              {proximaReuniao && (
                <p className="text-[11px]" style={{ color: C.txtMuted }}>{proximaReuniao.titulo} · {proximaReuniao.tipo}</p>
              )}
            </div>
          </div>
          <div style={{ padding: 20 }}>
            {proximaReuniao ? (
              <div className="text-center">
                <div className="flex items-center justify-center gap-3 mb-4">
                  {[
                    { value: countdown.days, label: 'DIAS' },
                    { value: countdown.hours, label: 'HORAS' },
                    { value: countdown.min, label: 'MIN' },
                    { value: countdown.sec, label: 'SEG' },
                  ].map((block, i) => (
                    <div key={i} className="rounded-[10px] text-center" style={{ background: C.surfaceHi, border: `1.5px solid ${C.border}`, padding: '10px 14px', minWidth: 60 }}>
                      <p style={{ fontFamily: C.mono, fontWeight: 800, fontSize: 22, color: C.primary }}>{String(block.value).padStart(2, '0')}</p>
                      <p style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.txtMuted }}>{block.label}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[13px] font-bold" style={{ color: C.txt }}>{proximaReuniao.titulo}</p>
                <p className="text-[11px]" style={{ color: C.txtMuted }}>
                  {new Date(proximaReuniao.data_reuniao + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                  {proximaReuniao.horario && ` às ${proximaReuniao.horario.slice(0, 5)}`}
                  {' · '}{proximaReuniao.tipo}
                </p>
              </div>
            ) : (
              <p className="text-sm text-center" style={{ color: C.txtSec }}>Nenhuma reunião agendada</p>
            )}
          </div>
        </div>

      </main>
    </div>
  );
}
