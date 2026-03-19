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
  segmento: string | null;
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
  const [editingSimId, setEditingSimId] = useState<string | null>(null);
  const [editingSimVal, setEditingSimVal] = useState<string>('');
  const [editingSimTipo, setEditingSimTipo] = useState<'pct' | 'delta' | 'valor'>('pct');
  const [torreShowAV, setTorreShowAV] = useState(false);
  const [torreShowAH, setTorreShowAH] = useState(false);
  const [torreMonthsActive, setTorreMonthsActive] = useState<Set<string>>(new Set());

  // ── Countdown ─────────────────────────────────────────────────
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, min: 0, sec: 0 });
  const [showDreMobile, setShowDreMobile] = useState(false);
  const [showTorreMobile, setShowTorreMobile] = useState(false);

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
          const { data: clientes } = await supabase.from('clientes').select('id, nome_empresa, razao_social, segmento').in('id', clienteIds);
          const empresasList: EmpresaOption[] = (clientes || []).map((c) => {
            const link = (links as any[]).find((l: any) => l.cliente_id === c.id);
            return { cliente_id: c.id, nome_empresa: c.nome_empresa, razao_social: c.razao_social, empresa_padrao: link?.empresa_padrao ?? false, segmento: (c as any).segmento ?? null };
          });
          empresasList.sort((a, b) => {
            if (a.empresa_padrao && !b.empresa_padrao) return -1;
            if (!a.empresa_padrao && b.empresa_padrao) return 1;
            return (a.razao_social || a.nome_empresa).localeCompare(b.razao_social || b.nome_empresa);
          });
          setEmpresas(empresasList);
        } else {
          if (profile.cliente_id) {
            const { data: fallbackCli } = await supabase.from('clientes').select('id, nome_empresa, razao_social, segmento').eq('id', profile.cliente_id).single();
            if (fallbackCli) {
              setEmpresas([{ cliente_id: fallbackCli.id, nome_empresa: fallbackCli.nome_empresa, razao_social: fallbackCli.razao_social, empresa_padrao: true, segmento: (fallbackCli as any).segmento ?? null }]);
            } else { setNoAccess(true); }
          } else setNoAccess(true);
        }
      } catch {
        if (profile.cliente_id) {
          const { data: fallbackCli } = await supabase.from('clientes').select('id, nome_empresa, razao_social, segmento').eq('id', profile.cliente_id).single();
          if (fallbackCli) {
            setEmpresas([{ cliente_id: fallbackCli.id, nome_empresa: fallbackCli.nome_empresa, razao_social: fallbackCli.razao_social, empresa_padrao: true, segmento: (fallbackCli as any).segmento ?? null }]);
          } else setNoAccess(true);
        } else setNoAccess(true);
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

  if (!propClienteId && !clienteIdSelecionado && empresas.length >= 1) {
    const FLOATER_TEXTS = [
      'R$217.663','55,0%','+19,9%','GC: 10%','CMV<38%','R$86.677','MC: 76%','DRE',
      'RO: 40%','R$45.462','▲12,4%','▼3,3%','=R$ Meta','Fev/2026','AV%','R$112.858',
      '−102,2%','+66,9%','CMO<25%','Δ%','R$38.384','Margem','Caixa','▲R$21k',
      'Lucro','GC>10%','DRE 2026','▼39%','Meta ✓','Receita','Custo','Despesa',
      '102%','−66,9%','76,8%','23,2%'
    ];
    const FLOATER_COLORS = [
      'rgba(26,60,255,0.28)','rgba(0,153,230,0.25)','rgba(0,168,107,0.22)',
      'rgba(217,119,6,0.20)','rgba(220,38,38,0.18)'
    ];
    const CARD_COLORS = [C.primary, '#00A86B', '#0099E6', '#D97706'];
    const segEmoji = (seg: string | null) => {
      if (!seg) return '🏢';
      const s = seg.toLowerCase();
      if (s.includes('aliment')) return '🍕';
      if (s.includes('saude') || s.includes('saúde')) return '🏥';
      if (s.includes('beleza') || s.includes('estet') || s.includes('estét')) return '💅';
      return '🏢';
    };

    const floaters = Array.from({ length: 80 }, (_, i) => {
      const text = FLOATER_TEXTS[i % FLOATER_TEXTS.length];
      const colorIdx = i % FLOATER_COLORS.length;
      const color = FLOATER_COLORS[colorIdx];
      const baseFontSizes = [[13,24],[12,22],[11,20],[12,23],[11,21]];
      const [minFs, maxFs] = baseFontSizes[colorIdx];
      const fontSize = minFs + Math.random() * (maxFs - minFs);
      const left = 2 + Math.random() * 96;
      const dur = 8 + Math.random() * 18;
      const delay = Math.random() * 20;
      const fw = i % 2 === 0 ? 700 : 900;
      return { text, color, fontSize, left, dur, delay, fw };
    });

    const scanLines = Array.from({ length: 6 }, (_, i) => ({
      top: 10 + i * 15 + Math.random() * 5,
      dur: 8 + Math.random() * 14,
      delay: Math.random() * 6,
    }));

    const pulseRings = Array.from({ length: 3 }, (_, i) => ({
      dur: 4 + i * 0.5,
      delay: i * 1.3,
    }));

    return (
      <div style={{ position: 'fixed', inset: 0, background: C.bg, fontFamily: 'DM Sans, sans-serif', overflow: 'auto' }}>
        <style>{`
          @keyframes sel-float-up { 0%{transform:translateY(105vh);opacity:0} 8%{opacity:1} 88%{opacity:1} 100%{transform:translateY(-15vh);opacity:0} }
          @keyframes sel-slide-right { from{transform:translateX(-100%)} to{transform:translateX(200%)} }
          @keyframes sel-ring-exp { 0%{transform:scale(.5);opacity:.7} 100%{transform:scale(2.8);opacity:0} }
          @keyframes sel-radar-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
          .sel-card-empresa { transition: all .2s; }
          .sel-card-empresa:hover { border-color: ${C.primary} !important; box-shadow: 0 8px 28px rgba(26,60,255,0.12); transform: translateY(-2px); }
          .sel-card-empresa:hover .sel-arrow { transform: translateX(3px); }
          .sel-arrow { transition: transform .2s; }
          @media(max-width:768px) {
            .sel-grid-empresas { grid-template-columns: 1fr !important; }
            .sel-hero-title { font-size: 22px !important; }
            .sel-svg-deco { display: none !important; }
            .sel-floater-item { font-size: 14px !important; }
          }
        `}</style>

        {/* BG: Grid HUD */}
        <div style={{ position: 'fixed', inset: 0, zIndex: 0, backgroundImage: 'repeating-linear-gradient(0deg,rgba(26,60,255,0.05) 0 1px,transparent 1px 28px),repeating-linear-gradient(90deg,rgba(26,60,255,0.05) 0 1px,transparent 1px 28px)', backgroundSize: '28px 28px', pointerEvents: 'none' }} />

        {/* BG: Glows */}
        <div style={{ position: 'fixed', top: '-5%', left: '-5%', width: 500, height: 400, background: 'radial-gradient(ellipse,rgba(26,60,255,0.10),transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />
        <div style={{ position: 'fixed', bottom: '-5%', right: '-5%', width: 400, height: 300, background: 'radial-gradient(ellipse,rgba(0,153,230,0.09),transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />
        <div style={{ position: 'fixed', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', width: 600, height: 400, background: 'radial-gradient(ellipse,rgba(26,60,255,0.05),transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />
        <div style={{ position: 'fixed', top: '10%', right: '10%', width: 300, height: 250, background: 'radial-gradient(ellipse,rgba(0,168,107,0.06),transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />

        {/* BG: Floaters */}
        <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1, overflow: 'hidden' }}>
          {floaters.map((f, i) => (
            <span key={i} className="sel-floater-item" style={{ position: 'absolute', left: `${f.left}%`, bottom: 0, fontFamily: "'Courier New', monospace", fontWeight: f.fw, fontSize: f.fontSize, color: f.color, animation: `sel-float-up ${f.dur}s linear ${f.delay}s infinite`, whiteSpace: 'nowrap' }}>{f.text}</span>
          ))}
        </div>

        {/* BG: Scan lines */}
        {scanLines.map((s, i) => (
          <div key={`scan-${i}`} style={{ position: 'fixed', top: `${s.top}%`, left: 0, width: '100%', height: 1.5, background: 'linear-gradient(90deg,transparent,rgba(26,60,255,0.10),transparent)', animation: `sel-slide-right ${s.dur}s linear ${s.delay}s infinite`, pointerEvents: 'none', zIndex: 1 }} />
        ))}

        {/* BG: Pulse rings */}
        <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 1 }}>
          {pulseRings.map((r, i) => (
            <div key={`ring-${i}`} style={{ position: 'absolute', top: '50%', left: '50%', width: 200, height: 200, marginTop: -100, marginLeft: -100, borderRadius: '50%', border: '1px solid rgba(26,60,255,0.07)', animation: `sel-ring-exp ${r.dur}s ease-out ${r.delay}s infinite` }} />
          ))}
        </div>

        {/* BG: SVG decorativo */}
        <svg className="sel-svg-deco" style={{ position: 'fixed', right: '4%', top: '50%', transform: 'translateY(-50%)', opacity: 0.055, pointerEvents: 'none', zIndex: 1 }} width="340" height="340" viewBox="0 0 340 340">
          <circle cx="170" cy="170" r="150" fill="none" stroke="#1A3CFF" strokeWidth="0.8" />
          <circle cx="170" cy="170" r="110" fill="none" stroke="#1A3CFF" strokeWidth="0.6" />
          <circle cx="170" cy="170" r="70" fill="none" stroke="#1A3CFF" strokeWidth="0.5" />
          <circle cx="170" cy="170" r="30" fill="none" stroke="#1A3CFF" strokeWidth="0.4" />
          <line x1="20" y1="170" x2="320" y2="170" stroke="#1A3CFF" strokeWidth="0.3" />
          <line x1="170" y1="20" x2="170" y2="320" stroke="#1A3CFF" strokeWidth="0.3" />
          <line x1="170" y1="170" x2="170" y2="20" stroke="#1A3CFF" strokeWidth="1.2" opacity="0.5">
            <animateTransform attributeName="transform" type="rotate" values="0 170 170;360 170 170" dur="6s" repeatCount="indefinite" />
          </line>
        </svg>

        {/* ── CONTENT ─────────────────────────── */}
        <div style={{ position: 'relative', zIndex: 10, maxWidth: 700, margin: '0 auto', padding: '32px 20px 40px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 28 }}>
            <div style={{ background: '#FFFFFF', borderRadius: 14, padding: '10px 18px', boxShadow: '0 8px 24px rgba(26,60,255,0.13)' }}>
              <img src={gpiLogo} alt="GPI" style={{ height: 32, width: 'auto', display: 'block' }} />
            </div>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.txt, letterSpacing: '-0.01em' }}>GPI Inteligência Financeira</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: C.txtMuted, textTransform: 'uppercase', letterSpacing: '0.12em' }}>Portal do Cliente</span>
          </div>

          {/* Hero text */}
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{ width: 32, height: 2, background: `linear-gradient(90deg,${C.primary},${C.cyan})`, borderRadius: 2 }} />
              <span style={{ fontSize: 10, fontWeight: 600, color: C.txtMuted, letterSpacing: '0.05em' }}>Bem-vindo ao seu portal financeiro</span>
              <span style={{ width: 32, height: 2, background: `linear-gradient(90deg,${C.cyan},${C.primary})`, borderRadius: 2 }} />
            </div>
            <h1 className="sel-hero-title" style={{ fontSize: 28, fontWeight: 800, color: C.txt, lineHeight: 1.2, marginBottom: 8 }}>
              Selecione a empresa que<br />você quer <span style={{ color: C.primary }}>analisar</span>
            </h1>
            <p style={{ fontSize: 13, color: C.txtSec, maxWidth: 420, margin: '0 auto' }}>
              Escolha abaixo qual empresa deseja visualizar os resultados financeiros.
            </p>
          </div>

          {/* Badge online */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 600, color: C.green, background: C.greenBg, padding: '5px 14px', borderRadius: 20 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, animation: 'hdr-glow-pulse 2s ease-in-out infinite' }} />
              Sistemas online · Dados atualizados
            </span>
          </div>

          {/* Grid empresas */}
          <div className="sel-grid-empresas" style={{ display: 'grid', gridTemplateColumns: empresas.length === 1 ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 32 }}>
            {empresas.map((e, idx) => (
              <button
                key={e.cliente_id}
                className="sel-card-empresa"
                onClick={() => setClienteIdSelecionado(e.cliente_id)}
                style={{ background: '#FFFFFF', border: `1.5px solid ${C.border}`, borderRadius: 16, padding: 18, cursor: 'pointer', textAlign: 'left', position: 'relative' }}
              >
                {/* Top row */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ width: 38, height: 38, background: C.bg, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                    {segEmoji(e.segmento)}
                  </div>
                  {e.empresa_padrao && (
                    <span style={{ fontSize: 9, fontWeight: 700, color: C.primary, background: 'rgba(26,60,255,0.08)', padding: '3px 8px', borderRadius: 8 }}>★ Principal</span>
                  )}
                </div>
                {/* Name */}
                <p style={{ fontSize: 13, fontWeight: 700, color: C.txt, marginBottom: 4, lineHeight: 1.3 }}>{e.razao_social || e.nome_empresa}</p>
                <p style={{ fontSize: 10, color: C.txtMuted, marginBottom: 12 }}>
                  {e.segmento ? e.segmento.charAt(0).toUpperCase() + e.segmento.slice(1).replace(/_/g, ' ') : 'Empresa'}
                </p>
                {/* Footer */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.primary, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    Acessar <span className="sel-arrow" style={{ display: 'inline-block' }}>→</span>
                  </span>
                  <SparkLine data={[40 + idx * 5, 42 + idx * 3, 38 + idx * 7, 45 + idx * 2, 50 + idx * 4, 48 + idx * 6]} color={e.empresa_padrao ? C.primary : CARD_COLORS[(idx + 1) % CARD_COLORS.length]} width={80} height={24} />
                </div>
              </button>
            ))}
          </div>

          {/* Footer */}
          <p style={{ textAlign: 'center', fontSize: 10, color: C.txtMuted }}>
            GPI Inteligência Financeira · 🔒 Confidencial · São Luís MA
          </p>
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
      {/* ── SEÇÃO 1: HEADER PREMIUM ──────────────────────────── */}
      <style>{`
        @keyframes hdr-pulse-expand { 0% { transform: scale(0.8); opacity: .6 } 100% { transform: scale(1.8); opacity: 0 } }
        @keyframes hdr-float-up { from { transform: translateY(0) scale(1); opacity: .6 } to { transform: translateY(-140px) scale(0.1); opacity: 0 } }
        @keyframes hdr-slide-right { from { transform: translateX(-100%) } to { transform: translateX(200%) } }
        @keyframes hdr-radar-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes hdr-glow-pulse { 0%,100%{ opacity:.5 } 50%{ opacity:1 } }
        @keyframes portal-modal-in { from { transform: translateY(100%) } to { transform: translateY(0) } }
        @media (max-width: 768px) {
          .portal-topbar { padding: 10px 16px 0 !important; }
          .portal-badge-online { display: none !important; }
          .portal-hero { flex-direction: column !important; gap: 12px !important; padding: 12px 16px 16px !important; }
          .portal-client-name { font-size: 20px !important; }
          .portal-pills { gap: 5px !important; }
          .portal-pills > span { font-size: 9px !important; padding: 2px 8px !important; }
          .portal-gc-card { display: none !important; }
          .portal-right-block { flex-direction: column !important; width: 100% !important; }
          .portal-empresa-sel { width: 100% !important; min-width: unset !important; }
          .portal-chips-row { overflow-x: auto !important; flex-wrap: nowrap !important; padding: 0 16px 8px !important; -ms-overflow-style: none; scrollbar-width: none; }
          .portal-chips-row::-webkit-scrollbar { display: none; }
          .portal-footer { padding: 6px 16px !important; }
          .portal-footer-extra { display: none !important; }
          .portal-main { padding: 12px !important; }
          .portal-main > * + * { margin-top: 12px; }
          .portal-cards-wrapper .dre-header-grid { display: flex !important; overflow-x: auto !important; scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch; scrollbar-width: none; gap: 10px !important; padding: 4px 0 8px; }
          .portal-cards-wrapper .dre-header-grid::-webkit-scrollbar { display: none; }
          .portal-cards-wrapper .dre-header-grid > div { min-width: 220px !important; flex-shrink: 0 !important; scroll-snap-align: start; }
          .portal-cards-wrapper > div { margin-bottom: 8px; }
          .portal-swipe-hint { display: block !important; }
          .portal-gauges-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 10px !important; }
          .portal-dre-desktop { display: none !important; }
          .portal-mobile-btn { display: flex !important; }
          .portal-torre-desktop { display: none !important; }
          .portal-apresentacao { flex-direction: column !important; align-items: stretch !important; padding: 14px 16px !important; }
          .portal-apresentacao-btn { width: 100% !important; margin-top: 10px !important; }
          .portal-reuniao .cd-num { font-size: 18px !important; }
          .portal-reuniao .cd-box { padding: 8px 10px !important; min-width: 50px !important; }
          .portal-fullscreen-modal { animation: portal-modal-in 0.25s ease-out; }
        }
      `}</style>
      <header style={{ position: 'sticky', top: 0, zIndex: 40, background: '#FFFFFF', borderBottom: '1.5px solid #DDE4F0', boxShadow: '0 4px 32px rgba(13,27,53,0.08)', overflow: 'hidden' }}>

        {/* ── Visual effect layers ── */}
        {/* 1. HUD grid */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', backgroundImage: 'linear-gradient(rgba(26,60,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(26,60,255,0.035) 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
        {/* 2. Radial glows */}
        <div style={{ position: 'absolute', top: -40, left: '20%', width: 600, height: 320, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(26,60,255,0.09) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -30, right: '5%', width: 350, height: 220, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,153,230,0.07) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: -20, left: '2%', width: 240, height: 200, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,168,107,0.06) 0%, transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', top: '40%', left: '50%', width: 200, height: 160, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(26,60,255,0.05) 0%, transparent 70%)', pointerEvents: 'none', transform: 'translateX(-50%)' }} />
        {/* 3. Pulse rings */}
        {[{ top: '30%', left: '15%', delay: '0s' }, { top: '60%', right: '25%', delay: '1s' }, { top: '20%', right: '40%', delay: '2s' }].map((r, i) => (
          <div key={`ring-${i}`} style={{ position: 'absolute', ...r, width: 60, height: 60, border: '1px solid rgba(26,60,255,0.08)', borderRadius: '50%', animation: `hdr-pulse-expand 3s ease-out ${r.delay} infinite`, pointerEvents: 'none' }} />
        ))}
        {/* 4. Floating particles */}
        {[
          { left: '5%', s: 4, c: 'rgba(26,60,255,0.12)', dur: '8s', del: '0s', round: true },
          { left: '12%', s: 3, c: 'rgba(0,153,230,0.10)', dur: '11s', del: '2s', round: false },
          { left: '20%', s: 5, c: 'rgba(0,168,107,0.09)', dur: '9s', del: '1s', round: true },
          { left: '28%', s: 3, c: 'rgba(217,119,6,0.08)', dur: '13s', del: '3s', round: false },
          { left: '35%', s: 4, c: 'rgba(26,60,255,0.10)', dur: '10s', del: '0.5s', round: true },
          { left: '42%', s: 3, c: 'rgba(0,153,230,0.10)', dur: '12s', del: '4s', round: false },
          { left: '50%', s: 5, c: 'rgba(0,168,107,0.09)', dur: '7s', del: '1.5s', round: true },
          { left: '57%', s: 3, c: 'rgba(26,60,255,0.12)', dur: '14s', del: '2.5s', round: false },
          { left: '63%', s: 4, c: 'rgba(217,119,6,0.08)', dur: '9s', del: '3.5s', round: true },
          { left: '70%', s: 3, c: 'rgba(0,153,230,0.10)', dur: '11s', del: '0.8s', round: false },
          { left: '76%', s: 5, c: 'rgba(26,60,255,0.10)', dur: '8s', del: '4.5s', round: true },
          { left: '82%', s: 3, c: 'rgba(0,168,107,0.09)', dur: '15s', del: '1.2s', round: false },
          { left: '88%', s: 4, c: 'rgba(217,119,6,0.08)', dur: '10s', del: '5s', round: true },
          { left: '93%', s: 3, c: 'rgba(26,60,255,0.12)', dur: '12s', del: '2.8s', round: false },
          { left: '8%', s: 3, c: 'rgba(0,153,230,0.10)', dur: '16s', del: '6s', round: true },
          { left: '25%', s: 4, c: 'rgba(0,168,107,0.09)', dur: '13s', del: '3.2s', round: false },
          { left: '45%', s: 3, c: 'rgba(26,60,255,0.10)', dur: '19s', del: '1.8s', round: true },
          { left: '60%', s: 5, c: 'rgba(217,119,6,0.08)', dur: '11s', del: '4.2s', round: false },
          { left: '72%', s: 3, c: 'rgba(0,153,230,0.10)', dur: '14s', del: '0.3s', round: true },
          { left: '85%', s: 4, c: 'rgba(26,60,255,0.12)', dur: '17s', del: '5.5s', round: false },
          { left: '15%', s: 3, c: 'rgba(0,168,107,0.09)', dur: '10s', del: '7s', round: true },
          { left: '55%', s: 4, c: 'rgba(217,119,6,0.08)', dur: '12s', del: '2.2s', round: false },
        ].map((p, i) => (
          <div key={`ptcl-${i}`} style={{ position: 'absolute', bottom: 4, left: p.left, width: p.s, height: p.s, background: p.c, borderRadius: p.round ? '50%' : 2, animation: `hdr-float-up ${p.dur} linear ${p.del} infinite`, pointerEvents: 'none' }} />
        ))}
        {/* 5. Scan lines */}
        {[{ dur: '10s', del: '0s' }, { dur: '16s', del: '3s' }, { dur: '22s', del: '7s' }].map((s, i) => (
          <div key={`scan-${i}`} style={{ position: 'absolute', top: `${20 + i * 30}%`, left: 0, right: 0, height: 1, background: 'linear-gradient(90deg, transparent, rgba(26,60,255,0.08), transparent)', animation: `hdr-slide-right ${s.dur} linear ${s.del} infinite`, pointerEvents: 'none' }} />
        ))}
        {/* 6. SVG decorative geometry */}
        <div style={{ position: 'absolute', right: 20, top: '50%', transform: 'translateY(-50%)', opacity: 0.045, pointerEvents: 'none' }}>
          <svg width="120" height="120" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="55" fill="none" stroke="#1A3CFF" strokeWidth="0.8" />
            <circle cx="60" cy="60" r="40" fill="none" stroke="#1A3CFF" strokeWidth="0.5" />
            <circle cx="60" cy="60" r="25" fill="none" stroke="#0099E6" strokeWidth="0.5" />
            <line x1="60" y1="5" x2="60" y2="115" stroke="#1A3CFF" strokeWidth="0.3" />
            <line x1="5" y1="60" x2="115" y2="60" stroke="#1A3CFF" strokeWidth="0.3" />
            <line x1="60" y1="60" x2="110" y2="60" stroke="#0099E6" strokeWidth="1">
              <animateTransform attributeName="transform" type="rotate" from="0 60 60" to="360 60 60" dur="8s" repeatCount="indefinite" />
            </line>
          </svg>
        </div>

        {/* ── LINHA 1: TOP BAR ── */}
        <div className="portal-topbar" style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 32px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={gpiLogo} alt="GPI" style={{ height: 32 }} />
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.txt }}>GPI Inteligência Financeira</span>
              <span style={{ display: 'block', fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.txtMuted }}>Portal do Cliente</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="portal-badge-online" style={{ fontSize: 9, fontWeight: 600, color: C.green, background: 'rgba(0,168,107,0.12)', border: '1px solid rgba(0,168,107,0.25)', borderRadius: 6, padding: '3px 10px', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, animation: 'pulse 2s infinite', boxShadow: '0 0 6px rgba(0,168,107,0.8)' }} />
              Sistemas online
            </span>
            {/* Bell */}
            <button style={{ position: 'relative', width: 32, height: 32, borderRadius: 8, background: '#F6F9FF', border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
              <Bell style={{ width: 15, height: 15, color: C.txtSec }} />
              {alertas.length > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 7, height: 7, borderRadius: '50%', background: C.red, border: '1.5px solid #fff' }} />}
            </button>
            {/* WhatsApp */}
            <button
              onClick={() => { window.open(`https://wa.me/?text=${encodeURIComponent('Olá, preciso de ajuda com meu painel financeiro GPI.')}`, '_blank'); }}
              style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(0,168,107,0.07)', border: '1px solid rgba(0,168,107,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            >
              <MessageCircle style={{ width: 15, height: 15, color: C.green }} />
            </button>
            {/* Logout */}
            {!espelho && (
              <button onClick={signOut} className="rounded-md p-1.5 transition-colors hover:text-[#DC2626]" style={{ color: C.txtSec }}>
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* ── LINHA 2: HERO CONTENT ── */}
        <div className="portal-hero" style={{ position: 'relative', zIndex: 1, padding: '16px 32px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
          {/* Bloco esquerdo */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Saudação */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ width: 16, height: 2.5, borderRadius: 2, background: 'linear-gradient(90deg, #1A3CFF, #0099E6)' }} />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txtMuted }}>
                Olá, {profile?.nome || 'Cliente'} — bem-vindo ao seu painel financeiro
              </span>
            </div>
            {/* Nome do cliente */}
            <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
              <h1 className="portal-client-name" style={{ fontSize: 27, fontWeight: 800, color: C.txt, margin: 0, lineHeight: 1.2 }}>
                {cliente?.razao_social || cliente?.nome_empresa || ''}
              </h1>
              <div style={{ width: '40%', height: 2.5, borderRadius: 2, background: 'linear-gradient(90deg, #1A3CFF, transparent)', marginTop: 4 }} />
            </div>
            {/* Pills */}
            <div className="portal-pills" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {cliente?.segmento && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 8, background: 'rgba(0,153,230,0.08)', color: '#0099E6' }}>🏥 {cliente.segmento}</span>
              )}
              {cliente?.faturamento_faixa && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 8, background: 'rgba(0,168,107,0.07)', color: '#00A86B' }}>📈 {cliente.faturamento_faixa}</span>
              )}
              <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 8, background: '#F0F4FA', color: '#4A5E80' }}>📅 {fmtMesAnoLong(competencia)}</span>
              {alertas.length > 0 && (
                <span style={{ fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 8, background: 'rgba(217,119,6,0.07)', color: '#D97706' }}>⚠ {alertas.length} alerta{alertas.length > 1 ? 's' : ''} ativo{alertas.length > 1 ? 's' : ''}</span>
              )}
            </div>
          </div>
          {/* Bloco direito */}
          <div className="portal-right-block" style={{ display: 'flex', gap: 10, flexShrink: 0, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {/* Card Score GC */}
            {cardData && (
              <div className="portal-gc-card" style={{ background: '#F6F9FF', border: `1px solid ${C.border}`, borderRadius: 12, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                {/* Mini gauge SVG */}
                <svg width="52" height="52" viewBox="0 0 52 52">
                  <circle cx="26" cy="26" r="22" fill="none" stroke="#F0F4FA" strokeWidth="4" />
                  <circle cx="26" cy="26" r="22" fill="none"
                    stroke={cardData.gc > 0 ? C.green : cardData.gcAV > -10 ? C.orange : C.red}
                    strokeWidth="4" strokeLinecap="round"
                    strokeDasharray={`${Math.min(Math.abs(cardData.gcAV), 100) / 100 * 138.2} 138.2`}
                    transform="rotate(-90 26 26)"
                  />
                  <text x="26" y="28" textAnchor="middle" style={{ fontSize: 9, fontWeight: 800, fontFamily: C.mono, fill: cardData.gc > 0 ? C.green : cardData.gcAV > -10 ? C.orange : C.red }}>
                    {cardData.gcAV.toFixed(0)}%
                  </text>
                </svg>
                <div>
                  <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.txtMuted, display: 'block' }}>Geração de Caixa</span>
                  <span style={{ fontSize: 14, fontWeight: 800, fontFamily: C.mono, color: cardData.gc > 0 ? C.green : cardData.gcAV > -10 ? C.orange : C.red, display: 'block' }}>
                    {cardData.gcAV.toFixed(1)}%
                  </span>
                  <span style={{ fontSize: 9.5, color: C.txtMuted }}>
                    {cardData.gc > 0 ? '✓ Saudável' : cardData.gcAV > -10 ? '⚠ Atenção' : '✗ Crítico'}
                  </span>
                </div>
              </div>
            )}
            {/* Seletor empresa */}
            {showTrocarEmpresa && (
              <div className="portal-empresa-sel" style={{ background: '#F6F9FF', border: `1.5px solid ${C.borderStr}`, borderRadius: 12, padding: '10px 16px', minWidth: 180 }}>
                <span style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.txtMuted, display: 'block', marginBottom: 6 }}>🏢 Empresa ativa</span>
                <div className="relative">
                  <button
                    onClick={() => setEmpresaDropdownOpen(!empresaDropdownOpen)}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', background: 'none', border: 'none', padding: 0, width: '100%' }}
                  >
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, boxShadow: '0 0 4px rgba(0,168,107,0.6)' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: C.txt, flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {empresaAtual?.razao_social || empresaAtual?.nome_empresa || 'Empresa'}
                    </span>
                    <ChevronDown style={{ width: 14, height: 14, color: C.txtMuted }} />
                  </button>
                  {empresaDropdownOpen && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', borderRadius: 8, border: `1px solid ${C.border}`, boxShadow: '0 4px 16px rgba(13,27,53,0.12)', zIndex: 50 }}>
                      {empresas.map(e => (
                        <button
                          key={e.cliente_id}
                          onClick={() => {
                            setClienteIdSelecionado(e.cliente_id);
                            setEmpresaDropdownOpen(false);
                            setCliente(null); setKpi(null); setKpiAnterior(null); setScore(null);
                            setIndicadoresCalc([]); setAlertas([]); setProximaReuniao(null);
                          }}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                            padding: '8px 12px', fontSize: 11, cursor: 'pointer', border: 'none',
                            background: e.cliente_id === resolvedClienteId ? 'rgba(26,60,255,0.04)' : 'transparent',
                            color: e.cliente_id === resolvedClienteId ? C.primary : C.txt,
                            fontWeight: e.cliente_id === resolvedClienteId ? 700 : 400,
                            transition: 'background 0.15s',
                          }}
                          onMouseEnter={ev => { (ev.currentTarget as HTMLElement).style.background = 'rgba(26,60,255,0.04)'; }}
                          onMouseLeave={ev => { if (e.cliente_id !== resolvedClienteId) (ev.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: e.cliente_id === resolvedClienteId ? C.primary : C.border, boxShadow: e.cliente_id === resolvedClienteId ? '0 0 0 2px rgba(26,60,255,0.2)' : 'none' }} />
                          {e.empresa_padrao && <span style={{ fontSize: 9 }}>★</span>}
                          {e.razao_social || e.nome_empresa}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>


        {/* ── LINHA 4: CHIPS DE COMPETÊNCIA ── */}
        {competenciasLiberadas.length > 1 && (
          <div className="portal-chips-row" style={{ position: 'relative', zIndex: 1, padding: '0 32px 10px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: C.txtMuted, marginRight: 4 }}>📆 Competência</span>
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

        {/* ── LINHA 5: FOOTER DO HEADER ── */}
        <div className="portal-footer" style={{ position: 'relative', zIndex: 1, background: '#F6F9FF', borderTop: `1px solid ${C.border}`, padding: '6px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: C.txtMuted }}>
            <span>🕐 Atualizado em {new Date().toLocaleDateString('pt-BR')}</span>
            <span className="portal-footer-extra" style={{ width: 1, height: 12, background: C.border }} />
            {proximaReuniao && (
              <span className="portal-footer-extra" style={{ display: 'contents' }}>
                <span>📅 Próxima reunião: {new Date(proximaReuniao.data_reuniao + 'T12:00:00').toLocaleDateString('pt-BR')} às {proximaReuniao.horario?.substring(0, 5) || '09:00'}</span>
                <span style={{ width: 1, height: 12, background: C.border }} />
              </span>
            )}
            <span className="portal-footer-extra">📊 {dreMonthsAll.length} meses disponíveis</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="portal-footer-extra" style={{ fontSize: 9, fontWeight: 600, color: C.primary, background: 'rgba(26,60,255,0.06)', padding: '2px 8px', borderRadius: 4 }}>GPI Inteligência Financeira</span>
            <span style={{ fontSize: 9, color: C.txtMuted }}>🔒 Confidencial</span>
          </div>
        </div>
      </header>

      <main className="space-y-6 portal-main" style={{ padding: '24px', maxWidth: 1200, margin: '0 auto' }}>

        {/* ── SEÇÃO 2: CARDS DE RESUMO (DreIndicadoresHeader) ── */}
        {dreContas && dreContas.length > 0 && dreValoresAnuais && dreValoresAnuais.length > 0 && (
          <div className="portal-cards-wrapper">
            <DreIndicadoresHeader
              contas={dreContas}
              valoresAnuais={dreValoresAnuais}
              months={dreIndicadorMonths}
              mesSelecionado={competencia}
              clienteId={resolvedClienteId || undefined}
            />
            <p className="portal-swipe-hint" style={{ display: 'none', fontSize: 9, color: C.txtMuted, textAlign: 'center', marginTop: 4 }}>← deslize para ver mais →</p>
          </div>
        )}

        {/* ── SEÇÃO 3: ALERTAS DE META (SPEEDOMETER GAUGES) ── */}
        {gaugeData.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txtMuted, marginBottom: 10 }}>Alertas de Meta</p>
            <div className="portal-gauges-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
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
          <>
          <button className="portal-mobile-btn" onClick={() => setShowDreMobile(true)} style={{ display: 'none', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>📊</span>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: C.txt, margin: 0 }}>DRE Financeira</p>
                <p style={{ fontSize: 11, color: C.txtMuted, margin: 0 }}>Demonstrativo completo</p>
              </div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.primary }}>Ver análise →</span>
          </button>
          <div className="portal-dre-desktop">
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
          </>
        )}

        {/* ── SEÇÃO 5: APRESENTAÇÃO DO MÊS ───────────────────── */}
        {competencia && (
          <div className="portal-apresentacao rounded-[14px] bg-white flex items-center justify-between" style={{ border: `1px solid ${C.border}`, padding: '18px 24px' }}>
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
                className="portal-apresentacao-btn inline-flex items-center gap-1.5 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all"
                style={{ background: C.primary, boxShadow: '0 2px 8px rgba(26,60,255,0.18)', opacity: hasApresentacao ? 1 : 0.5, cursor: hasApresentacao ? 'pointer' : 'not-allowed' }}
              >
                <Play className="h-4 w-4" /> Iniciar Apresentação
              </button>
            )}
          </div>
        )}

        {/* ── SEÇÃO 6: TORRE DE CONTROLE ──────────────────────── */}
        {dreContas && dreContas.length > 0 && (torreMetas || []).length > 0 && (
          <>
          <button className="portal-mobile-btn" onClick={() => setShowTorreMobile(true)} style={{ display: 'none', width: '100%', alignItems: 'center', justifyContent: 'space-between', background: '#fff', border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 16px', cursor: 'pointer' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 18 }}>🎯</span>
              <div style={{ textAlign: 'left' }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: C.txt, margin: 0 }}>Torre de Controle</p>
                <p style={{ fontSize: 11, color: C.txtMuted, margin: 0 }}>Metas e simulações</p>
              </div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.primary }}>Ver metas →</span>
          </button>
          <div className="portal-torre-desktop">
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

            {/* Simulação banner + info card */}
            {torreTab === 'simulacao' && (
              <>
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
                <div style={{ margin: '12px 20px', padding: '12px 16px', background: '#F6F9FF', border: '1px solid #DDE4F0', borderRadius: 10 }}>
                  <p style={{ fontSize: 11.5, color: '#4A5E80', lineHeight: 1.6 }}>
                    💡 Aqui você pode criar sua própria simulação financeira. Ajuste os percentuais como quiser, salve e exporte em PDF. Suas alterações não afetam as metas definidas pela GPI na reunião. Simule quantas vezes precisar!
                  </p>
                </div>
              </>
            )}

            {/* Torre toolbar (AV%/AH% toggles + month chips) */}
            <div className="flex items-center justify-between flex-wrap gap-2" style={{ padding: '10px 16px', borderBottom: `1px solid #F0F4FA` }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                {dreMonthsAll.filter(m => m !== competencia).map(m => {
                  const isActive = torreMonthsActive.has(m);
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        setTorreMonthsActive(prev => {
                          const next = new Set(prev);
                          if (next.has(m)) next.delete(m); else next.add(m);
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
                  { key: 'av', label: 'AV%', active: torreShowAV, toggle: () => setTorreShowAV(v => !v) },
                  { key: 'ah', label: 'AH%', active: torreShowAH, toggle: () => setTorreShowAH(v => !v) },
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

            {/* Torre table */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#F0F4FA', borderBottom: `1px solid ${C.border}` }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txtMuted, position: 'sticky', left: 0, zIndex: 10, background: '#F0F4FA', borderRight: `1px solid ${C.border}`, minWidth: 220 }}>CONTA DRE</th>
                    {Array.from(torreMonthsActive).sort().map(m => (
                      <Fragment key={`th-hist-${m}`}>
                        <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, minWidth: 90 }}>REAL {getMonthShort(m)}</th>
                        {torreMetaMapByComp[m] && <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.primary, minWidth: 90, background: C.pLo }}>META {getMonthShort(m)}</th>}
                      </Fragment>
                    ))}
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, minWidth: 100 }}>REALIZADO {getMonthShort(competencia)}</th>
                    {torreShowAV && <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 10, fontWeight: 700, color: C.txtMuted, minWidth: 50 }}>AV%</th>}
                    {torreShowAH && <th style={{ textAlign: 'right', padding: '8px 6px', fontSize: 10, fontWeight: 700, color: C.txtMuted, minWidth: 50 }}>AH%</th>}
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, minWidth: 80 }}>AJUSTE</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, minWidth: 80 }}>R$</th>
                    <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.primary, minWidth: 110, background: C.pLo }}>META {getMonthShort(mesProximo)}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const activeMetaMap = torreTab === 'gpi' ? torreMetaMap : Object.fromEntries(Object.entries(simLocalMap).map(([k, v]) => [k, { conta_id: k, meta_tipo: v.meta_tipo as any, meta_valor: v.meta_valor }]));
                    const editable = torreTab === 'simulacao';
                    const toggleFn = (id: string) => setTorreCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
                    const prevComp = getCompetenciaAnterior(competencia);
                    const prevRealMap = getDreMonthMap(prevComp);
                    const fatReal = sumGrupos(dreGruposPorTipo['receita'] || [], torreRealMap);

                    const renderRow = (node: DreNode): JSX.Element | null => {
                      const conta = node.conta;
                      const isGrupo = conta.nivel === 0;
                      const isSubgrupo = conta.nivel === 1;
                      const isCat = conta.nivel === 2;
                      const isTotal = !!conta.is_total;
                      const hasChildren = node.children.length > 0;
                      const isCollapsedItem = torreCollapsed.has(conta.id);

                      if (isCat && !isTotal) {
                        const val = torreRealMap[conta.id];
                        if (val == null || val === 0) return null;
                      }

                      const paddingLeft = isGrupo ? 12 : isSubgrupo ? 24 : 48;
                      let rowBg = '#FAFCFF', fontWeight = 400, fontSize = 12, textColor = C.txtSec;
                      if (isTotal) { rowBg = '#0D1B35'; fontWeight = 700; textColor = '#FFFFFF'; }
                      else if (isGrupo) { rowBg = '#F0F4FA'; fontWeight = 700; textColor = C.txt; }
                      else if (isSubgrupo) { rowBg = '#FFFFFF'; fontWeight = 600; textColor = C.txt; }

                      const meta = activeMetaMap[conta.id] || null;
                      const realSel = isCat ? (torreRealMap[conta.id] ?? null) : sumNodeLeafs(node, torreRealMap);
                      const projetado = isCat
                        ? (realSel != null ? calcProjetado(realSel, meta, conta.tipo) : null)
                        : sumNodeProjetado(node, torreRealMap, activeMetaMap);

                      let ajustePct: number | null = null;
                      if (realSel != null && projetado != null && realSel !== 0) ajustePct = ((projetado - realSel) / Math.abs(realSel)) * 100;
                      const varR$ = realSel != null && projetado != null ? projetado - realSel : null;
                      const isReceita = conta.tipo === 'receita';
                      const getAjusteColor = () => { if (ajustePct == null || Math.abs(ajustePct) < 0.05) return C.txtMuted; return isReceita ? (ajustePct! > 0 ? C.green : C.red) : (ajustePct! > 0 ? C.red : C.green); };
                      // R$ visual: + green when META column value increases, - red when it decreases
                      const getVarColor = () => {
                        if (varR$ == null || Math.abs(varR$) < 1) return C.txtMuted;
                        const metaAbsUp = projetado != null && realSel != null && Math.abs(projetado) > Math.abs(realSel);
                        return metaAbsUp ? C.green : C.red;
                      };
                      const varVisualSign = varR$ != null && projetado != null && realSel != null
                        ? (Math.abs(projetado) > Math.abs(realSel) ? '+' : '−')
                        : '+';
                      const ajusteArrow = ajustePct != null ? (ajustePct > 0.05 ? '↑ +' : ajustePct < -0.05 ? '↓ −' : '→ ') : '';
                      const avVal = realSel != null && fatReal !== 0 ? (Math.abs(realSel) / Math.abs(fatReal)) * 100 : null;
                      const prevVal = isCat ? (prevRealMap[conta.id] ?? null) : sumNodeLeafs(node, prevRealMap);
                      const ahVal = realSel != null && prevVal != null && prevVal !== 0 ? ((realSel - prevVal) / Math.abs(prevVal)) * 100 : null;

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
                            {/* Historical month columns */}
                            {Array.from(torreMonthsActive).sort().map(m => {
                              const histMap = getDreMonthMap(m);
                              const histVal = isCat ? (histMap[conta.id] ?? null) : sumNodeLeafs(node, histMap);
                              const histMetaMap = torreMetaMapByComp[m] || {};
                              const histMeta = histMetaMap[conta.id] || null;
                              const histProj = histMeta && histVal != null ? calcProjetado(histVal, histMeta, conta.tipo) : null;
                              return (
                                <Fragment key={`hist-${m}`}>
                                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: isTotal ? 800 : 400, color: histVal != null ? (histVal < 0 ? C.red : (isTotal ? '#FFF' : C.txtSec)) : C.txtMuted, padding: '8px 8px', background: isTotal ? '#0D1B35' : undefined }}>{fmtTorre(histVal)}</td>
                                  {torreMetaMapByComp[m] && <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: isTotal ? 800 : 400, color: histProj != null ? (isTotal ? '#FFF' : C.primary) : C.txtMuted, padding: '8px 8px', background: isTotal ? 'rgba(26,60,255,0.18)' : C.pLo }}>{fmtTorre(histProj)}</td>}
                                </Fragment>
                              );
                            })}
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400), color: realSel != null ? (realSel < 0 ? C.red : (isTotal ? '#FFF' : C.txt)) : C.txtMuted, padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined }}>{fmtTorre(realSel)}</td>
                            {torreShowAV && <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 10, color: isTotal ? '#00E68A' : C.txtMuted, padding: '8px 6px', background: isTotal ? '#0D1B35' : undefined }}>{avVal != null ? `${avVal.toFixed(1)}%` : '—'}</td>}
                            {torreShowAH && <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 10, color: ahVal != null ? (ahVal >= 0 ? C.green : C.red) : C.txtMuted, padding: '8px 6px', background: isTotal ? '#0D1B35' : undefined }}>{ahVal != null ? `${ahVal >= 0 ? '+' : ''}${ahVal.toFixed(1)}%` : '—'}</td>}
                            {/* AJUSTE — editable for sim groups, subgrupos and categories */}
                            {(() => {
                              const canEdit = editable && (isCat || isSubgrupo || isGrupo) && !isTotal;
                              const isEditing = editingSimId === conta.id;
                              const curMeta = simLocalMap[conta.id];
                              const curTipo = isEditing ? editingSimTipo : ((curMeta?.meta_tipo as 'pct' | 'delta' | 'valor') || 'pct');

                              // Compute display pct based on meta type
                              let displayPct: number | null = ajustePct;
                              if (curMeta && curMeta.meta_valor != null && realSel != null) {
                                if (curMeta.meta_tipo === 'pct') displayPct = curMeta.meta_valor;
                                else if (curMeta.meta_tipo === 'delta') displayPct = realSel !== 0 ? (curMeta.meta_valor / Math.abs(realSel)) * 100 : 0;
                                else if (curMeta.meta_tipo === 'valor') displayPct = realSel !== 0 ? ((curMeta.meta_valor - Math.abs(realSel)) / Math.abs(realSel)) * 100 : 0;
                              }
                              if (isCat && displayPct == null) displayPct = ajustePct;
                              // Same magnitude logic as R$ column: green if |META|>|REAL|, red otherwise
                              const dpMetaAbsUp = projetado != null && realSel != null && Math.abs(projetado) > Math.abs(realSel);
                              const dpColor = () => { if (displayPct == null || Math.abs(displayPct) < 0.05) return C.txtMuted; return dpMetaAbsUp ? C.green : C.red; };
                              const dpArrow = displayPct != null ? (dpMetaAbsUp ? '↑ +' : (Math.abs(displayPct) < 0.05 ? '→ ' : '↓ −')) : '';

                              const tipoButtons: { tipo: 'pct' | 'delta' | 'valor'; label: string }[] = [
                                { tipo: 'pct', label: '%' }, { tipo: 'delta', label: 'R$' }, { tipo: 'valor', label: '=R$' },
                              ];

                              const propagateDown = (n: DreNode, tipo: 'pct' | 'delta' | 'valor', valor: number) => {
                                const updates: Record<string, { meta_tipo: string; meta_valor: number }> = {};
                                const walk = (nd: DreNode) => { for (const ch of nd.children) { updates[ch.conta.id] = { meta_tipo: tipo, meta_valor: valor }; if (ch.children.length > 0) walk(ch); } };
                                walk(n);
                                return updates;
                              };

                              const commitSim = () => {
                                const cleaned = editingSimVal.replace(/[^\d.,-]/g, '').replace(',', '.');
                                const num = cleaned === '' ? null : parseFloat(cleaned);
                                const val = (num != null && !isNaN(num)) ? num : null;
                                const updates: Record<string, { meta_tipo: string; meta_valor: number | null }> = { [conta.id]: { meta_tipo: editingSimTipo, meta_valor: val } };
                                if (val != null && (isGrupo || isSubgrupo) && hasChildren) {
                                  Object.assign(updates, propagateDown(node, editingSimTipo, val));
                                }
                                setSimLocalMap(prev => ({ ...prev, ...updates }));
                                setSimDirty(true);
                                setEditingSimId(null);
                              };

                              const switchSimTipo = (newTipo: 'pct' | 'delta' | 'valor') => {
                                if (newTipo === editingSimTipo) return;
                                setEditingSimTipo(newTipo);
                                // Also update existing meta type if already has value
                                if (curMeta && curMeta.meta_valor != null) {
                                  const updates: Record<string, { meta_tipo: string; meta_valor: number | null }> = { [conta.id]: { meta_tipo: newTipo, meta_valor: curMeta.meta_valor } };
                                  if ((isGrupo || isSubgrupo) && hasChildren) Object.assign(updates, propagateDown(node, newTipo, curMeta.meta_valor));
                                  setSimLocalMap(prev => ({ ...prev, ...updates }));
                                  setSimDirty(true);
                                }
                              };

                              const renderTipoToggle = () => (
                                <span style={{ display: 'inline-flex', gap: 1, marginRight: 4 }}>
                                  {tipoButtons.map(b => (
                                    <button key={b.tipo} onClick={e => { e.stopPropagation(); switchSimTipo(b.tipo); }}
                                      style={{ fontSize: 8, fontWeight: 700, cursor: 'pointer', padding: '1px 4px', borderRadius: 4, background: curTipo === b.tipo ? C.primary : 'rgba(26,60,255,0.08)', color: curTipo === b.tipo ? '#FFFFFF' : '#4A5E80', border: 'none', transition: 'all 0.12s' }}>
                                      {b.label}
                                    </button>
                                  ))}
                                </span>
                              );

                              const prefix = editingSimTipo === 'pct' ? '' : editingSimTipo === 'delta' ? 'R$ ' : '=R$ ';
                              const suffix = editingSimTipo === 'pct' ? '%' : '';

                              return (
                                <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 500, color: dpColor(), padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined, cursor: canEdit ? 'pointer' : undefined, position: 'relative' }}
                                  onClick={() => { if (canEdit && !isEditing) { setEditingSimId(conta.id); setEditingSimVal(curMeta?.meta_valor?.toString() ?? ''); setEditingSimTipo((curMeta?.meta_tipo as 'pct' | 'delta' | 'valor') || 'pct'); } }}
                                  onMouseEnter={e => { if (canEdit && !isEditing) (e.currentTarget as HTMLElement).style.background = 'rgba(26,60,255,0.04)'; }}
                                  onMouseLeave={e => { if (canEdit && !isEditing) (e.currentTarget as HTMLElement).style.background = ''; }}
                                >
                                  {isEditing ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                      {renderTipoToggle()}
                                      <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                                        {prefix && <span style={{ fontSize: 10, color: C.txtMuted, marginRight: 2 }}>{prefix}</span>}
                                        <input
                                          value={editingSimVal}
                                          onChange={e => setEditingSimVal(e.target.value)}
                                          onBlur={commitSim}
                                          onKeyDown={e => { if (e.key === 'Enter') commitSim(); if (e.key === 'Escape') setEditingSimId(null); }}
                                          autoFocus
                                          placeholder="0"
                                          style={{ width: 60, textAlign: 'right', fontFamily: 'Courier New', fontSize: 12, border: `1px solid ${C.primary}`, borderRadius: 4, padding: '2px 6px', outline: 'none', background: '#F6F9FF' }}
                                        />
                                        {suffix && <span style={{ fontSize: 10, color: C.txtMuted, marginLeft: 2 }}>{suffix}</span>}
                                      </span>
                                    </span>
                                  ) : canEdit ? (
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ fontFamily: C.mono, fontSize: 12, color: dpColor(), fontWeight: 500 }}>
                                        {displayPct != null && Math.abs(displayPct) >= 0.05 ? `${dpArrow}${Math.abs(displayPct).toFixed(1)}%` : '—'}
                                      </span>
                                      <span style={{ fontSize: 9, color: '#C4CFEA' }}>✎</span>
                                    </span>
                                  ) : (
                                    <span>{isTotal ? '—' : (displayPct != null && Math.abs(displayPct) >= 0.05 ? `${dpArrow}${Math.abs(displayPct).toFixed(1)}%` : '—')}</span>
                                  )}
                                </td>
                              );
                            })()}
                            {/* R$ — static */}
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 500, color: getVarColor(), padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined }}>{varR$ != null && Math.abs(varR$) >= 1 ? `${varVisualSign}${fmtTorre(Math.abs(varR$))}` : '—'}</td>
                            {/* META — static calculated */}
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400), color: projetado != null ? (isTotal ? '#FFF' : C.primary) : C.txtMuted, padding: '8px 10px', background: isTotal ? 'rgba(26,60,255,0.18)' : C.pLo }}>
                              {fmtTorre(projetado)}
                            </td>
                          </tr>
                          {hasChildren && !isCollapsedItem && node.children.map(child => renderRow(child))}
                        </Fragment>
                      );
                    };

                    const rows: JSX.Element[] = [];
                    const calcTotais = (tipos: string[]) => { let total = 0; for (const tipo of tipos) { for (const g of (dreGruposPorTipo[tipo] || [])) { const v = sumNodeProjetado(g, torreRealMap, activeMetaMap); if (v != null) total += v; } } return total; };

                    for (const seq of SEQUENCIA_DRE) {
                      const grupos = dreGruposPorTipo[seq.tipo] || [];
                      for (const g of grupos) { const row = renderRow(g); if (row) rows.push(row); }
                      if (seq.totalizadorApos) {
                        const cfg = TOTALIZADOR_CONFIG[seq.totalizadorApos];
                        const tiposAcum = SEQUENCIA_DRE.slice(0, SEQUENCIA_DRE.findIndex(s => s.totalizadorApos === seq.totalizadorApos) + 1).map(s => s.tipo);
                        const realTotal = tiposAcum.reduce((acc, t) => acc + sumGrupos(dreGruposPorTipo[t] || [], torreRealMap), 0);
                        const projTotal = calcTotais(tiposAcum);
                        const totVarR$ = projTotal - realTotal;
                        const totAvVal = fatReal !== 0 ? (Math.abs(realTotal) / Math.abs(fatReal)) * 100 : null;
                        const prevRealTotal = tiposAcum.reduce((acc, t) => acc + sumGrupos(dreGruposPorTipo[t] || [], prevRealMap), 0);
                        const totAhVal = prevRealTotal !== 0 ? ((realTotal - prevRealTotal) / Math.abs(prevRealTotal)) * 100 : null;

                        rows.push(
                          <tr key={`tot-${cfg.key}`} style={{ background: '#0D1B35', borderBottom: 'none' }}>
                            <td style={{ padding: '8px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', position: 'sticky', left: 0, zIndex: 5, background: '#0D1B35', borderRight: `1px solid ${C.border}` }}>
                              <span className="flex items-center gap-1.5"><span style={{ color: C.cyan, fontSize: 13 }}>◈</span>{cfg.nome}</span>
                            </td>
                            {Array.from(torreMonthsActive).sort().map(m => {
                              const histMap = getDreMonthMap(m);
                              const histTotal = tiposAcum.reduce((acc, t) => acc + sumGrupos(dreGruposPorTipo[t] || [], histMap), 0);
                              const histMetaMap2 = torreMetaMapByComp[m] || {};
                              const histProjTotal = tiposAcum.reduce((acc, tipo) => { let s = 0; for (const g of (dreGruposPorTipo[tipo] || [])) { const v = sumNodeProjetado(g, histMap, histMetaMap2); if (v != null) s += v; } return acc + s; }, 0);
                              return (
                                <Fragment key={`tot-hist-${m}`}>
                                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 800, color: '#FFFFFF', padding: '8px 8px', background: '#0D1B35' }}>{fmtTorre(histTotal)}</td>
                                  {torreMetaMapByComp[m] && <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 800, color: '#FFFFFF', padding: '8px 8px', background: 'rgba(26,60,255,0.18)' }}>{fmtTorre(histProjTotal)}</td>}
                                </Fragment>
                              );
                            })}
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: '#FFFFFF', padding: '8px 10px', background: '#0D1B35' }}>{fmtTorre(realTotal)}</td>
                            {torreShowAV && <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 10, fontWeight: 600, color: '#00E68A', padding: '8px 6px', background: '#0D1B35' }}>{totAvVal != null ? `${totAvVal.toFixed(1)}%` : '—'}</td>}
                            {torreShowAH && <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 10, fontWeight: 600, color: totAhVal != null ? (totAhVal >= 0 ? '#00E68A' : '#FF6B6B') : C.txtMuted, padding: '8px 6px', background: '#0D1B35' }}>{totAhVal != null ? `${totAhVal >= 0 ? '+' : ''}${totAhVal.toFixed(1)}%` : '—'}</td>}
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 500, color: C.txtMuted, padding: '8px 10px', background: '#0D1B35' }}>—</td>
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 500, color: totVarR$ !== 0 ? (Math.abs(projTotal) > Math.abs(realTotal) ? '#00E68A' : '#FF6B6B') : C.txtMuted, padding: '8px 10px', background: '#0D1B35' }}>{Math.abs(totVarR$) >= 1 ? `${Math.abs(projTotal) > Math.abs(realTotal) ? '+' : '−'}${fmtTorre(Math.abs(totVarR$))}` : '—'}</td>
                            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: '#FFFFFF', padding: '8px 10px', background: 'rgba(26,60,255,0.18)' }}>{fmtTorre(projTotal)}</td>
                          </tr>
                        );
                      }
                    }
                    return rows;
                  })()}
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
          </div>
          </>
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
        <div className="portal-reuniao rounded-[14px] bg-white overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
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
                    <div key={i} className="cd-box rounded-[10px] text-center" style={{ background: C.surfaceHi, border: `1.5px solid ${C.border}`, padding: '10px 14px', minWidth: 60 }}>
                      <p className="cd-num" style={{ fontFamily: C.mono, fontWeight: 800, fontSize: 22, color: C.primary }}>{String(block.value).padStart(2, '0')}</p>
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

      {/* ── MOBILE FULLSCREEN MODALS ── */}
      {showDreMobile && dreContas && dreValoresAnuais && (
        <div className="portal-fullscreen-modal" style={{ position: 'fixed', inset: 0, zIndex: 50, background: C.bg, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <button onClick={() => setShowDreMobile(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: C.primary, padding: 4 }}>←</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>DRE Financeira</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            <div style={{ marginBottom: 12 }}>
              <DreBanner
                faturamento={cardData?.fat}
                mcPct={cardData ? (cardData.fat !== 0 ? (cardData.mc / Math.abs(cardData.fat)) * 100 : null) : null}
                gcPct={cardData ? (cardData.fat !== 0 ? (cardData.gc / Math.abs(cardData.fat)) * 100 : null) : null}
              />
            </div>
            <div className="rounded-[14px] bg-white overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
              <div className="flex items-center justify-between" style={{ padding: '12px 16px', borderBottom: `1px solid #F0F4FA` }}>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {dreMonthsAll.map(m => {
                    const isActive = dreMonthsActive.has(m);
                    return (
                      <button key={m} onClick={() => { setDreMonthsActive(prev => { const next = new Set(prev); if (next.has(m)) next.delete(m); else next.add(m); return next; }); }}
                        style={{ padding: '4px 10px', borderRadius: 14, fontSize: 10, fontWeight: isActive ? 700 : 500, cursor: 'pointer', transition: 'all 0.15s', border: isActive ? `1.5px solid ${C.primary}` : `1px solid ${C.border}`, background: isActive ? C.primary : '#fff', color: isActive ? '#FFFFFF' : C.txtSec }}>
                        {getMonthShort(m)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#F0F4FA', borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txtMuted, position: 'sticky', left: 0, zIndex: 10, background: '#F0F4FA', borderRight: `1px solid ${C.border}`, minWidth: 180 }}>CONTA DRE</th>
                      {Array.from(dreMonthsActive).sort().map(m => (
                        <th key={m} style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: m === competencia ? C.primary : C.txtMuted, textTransform: 'uppercase', background: m === competencia ? C.pLo : '#F0F4FA', minWidth: 90 }}>
                          {m === competencia && '▲ '}{getMonthShort(m)}
                        </th>
                      ))}
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, textTransform: 'uppercase', background: '#F0F4FA', minWidth: 100 }}>ACUMULADO</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const rows: JSX.Element[] = [];
                      const activeMonths = Array.from(dreMonthsActive).sort();
                      const renderMobileDreRow = (node: DreNode): JSX.Element | null => {
                        const conta = node.conta;
                        const isGrupo = conta.nivel === 0;
                        const isSubgrupo = conta.nivel === 1;
                        const isCat = conta.nivel === 2;
                        const isTotal = !!conta.is_total;
                        const hasChildren = node.children.length > 0;
                        const isCollapsed = dreCollapsed.has(conta.id);
                        if (isCat && !isTotal) {
                          const hasAnyVal = dreMonthsAll.some(m => { const v = dreValoresMap[conta.id]?.[m]; return v != null && v !== 0; });
                          if (!hasAnyVal) return null;
                        }
                        const paddingLeft = isGrupo ? 12 : isSubgrupo ? 24 : 48;
                        let rowBg = '#FAFCFF', fontWeight = 400, textColor = C.txtSec;
                        if (isTotal) { rowBg = '#0D1B35'; fontWeight = 700; textColor = '#FFFFFF'; }
                        else if (isGrupo) { rowBg = '#F0F4FA'; fontWeight = 700; textColor = C.txt; }
                        else if (isSubgrupo) { rowBg = '#FFFFFF'; fontWeight = 600; textColor = C.txt; }
                        let acum = 0;
                        dreMonthsAll.forEach(m => { const map = getDreMonthMap(m); const v = isCat ? (map[conta.id] ?? 0) : (sumNodeLeafs(node, map) ?? 0); acum += v; });
                        return (
                          <Fragment key={conta.id}>
                            <tr style={{ background: rowBg, borderBottom: isTotal ? 'none' : `1px solid ${isGrupo ? C.borderStr : '#F8F9FB'}` }}>
                              <td style={{ padding: `8px 8px 8px ${paddingLeft}px`, fontWeight, fontSize: 12, color: textColor, whiteSpace: 'nowrap', minWidth: 180, position: 'sticky', left: 0, zIndex: 5, background: rowBg, borderRight: `1px solid ${C.border}` }}>
                                <span className="flex items-center gap-1.5">
                                  {hasChildren && !isTotal && (isGrupo || isSubgrupo) ? (
                                    <button onClick={() => { setDreCollapsed(prev => { const n = new Set(prev); if (n.has(conta.id)) n.delete(conta.id); else n.add(conta.id); return n; }); }} style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 2, lineHeight: 0, color: C.txtMuted }}>
                                      {isCollapsed ? <ChevronRight style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
                                    </button>
                                  ) : <span style={{ width: 18 }} />}
                                  {isTotal && <span style={{ color: C.cyan, fontSize: 13 }}>◈</span>}
                                  <span>{conta.nome}</span>
                                </span>
                              </td>
                              {activeMonths.map(m => {
                                const map = getDreMonthMap(m);
                                const val = isCat ? (map[conta.id] ?? null) : sumNodeLeafs(node, map);
                                const isSel = m === competencia;
                                return (
                                  <td key={m} style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400), color: val != null ? (val < 0 ? C.red : (isTotal ? '#FFF' : (isSel ? C.primary : C.txt))) : C.txtMuted, padding: '8px 10px', background: isSel ? (isTotal ? '#0D1B35' : C.pLo) : (isTotal ? '#0D1B35' : undefined) }}>
                                    {fmtTorre(val)}
                                  </td>
                                );
                              })}
                              <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400), color: acum < 0 ? C.red : (isTotal ? '#FFF' : C.txt), padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined }}>{fmtTorre(acum)}</td>
                            </tr>
                            {hasChildren && !isCollapsed && node.children.map(child => renderMobileDreRow(child))}
                          </Fragment>
                        );
                      };
                      for (const seq of SEQUENCIA_DRE) {
                        const grupos = dreGruposPorTipo[seq.tipo] || [];
                        for (const g of grupos) { const row = renderMobileDreRow(g); if (row) rows.push(row); }
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
                                return <td key={m} style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: '#FFFFFF', padding: '8px 10px', background: m === competencia ? 'rgba(26,60,255,0.18)' : '#0D1B35' }}>{fmtTorre(total)}</td>;
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
        </div>
      )}

      {showTorreMobile && dreContas && (torreMetas || []).length > 0 && (
        <div className="portal-fullscreen-modal" style={{ position: 'fixed', inset: 0, zIndex: 50, background: C.bg, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#fff', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
            <button onClick={() => setShowTorreMobile(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, color: C.primary, padding: 4 }}>←</button>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.txt }}>Torre de Controle</span>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            <div className="flex" style={{ borderBottom: `1px solid ${C.border}`, marginBottom: 12, background: '#fff', borderRadius: '12px 12px 0 0' }}>
              {[
                { key: 'gpi' as const, label: 'Metas GPI' },
                { key: 'simulacao' as const, label: 'Minha Simulação' },
              ].map(tab => (
                <button key={tab.key} onClick={() => setTorreTab(tab.key)}
                  style={{ padding: '10px 20px', fontSize: 12, fontWeight: torreTab === tab.key ? 700 : 500, color: torreTab === tab.key ? C.primary : C.txtSec, background: torreTab === tab.key ? '#fff' : C.surfaceHi, borderBottom: torreTab === tab.key ? `2px solid ${C.primary}` : '2px solid transparent', cursor: 'pointer', border: 'none', borderTop: 'none', borderLeft: 'none', borderRight: 'none', flex: 1 }}>
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="rounded-[14px] bg-white overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: '#F0F4FA', borderBottom: `1px solid ${C.border}` }}>
                      <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: C.txtMuted, position: 'sticky', left: 0, zIndex: 10, background: '#F0F4FA', borderRight: `1px solid ${C.border}`, minWidth: 180 }}>CONTA</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, background: '#F0F4FA', minWidth: 90 }}>REALIZADO</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.txtMuted, background: '#F0F4FA', minWidth: 70 }}>AJUSTE</th>
                      <th style={{ textAlign: 'right', padding: '8px 10px', fontSize: 10, fontWeight: 700, color: C.primary, background: C.pLo, minWidth: 90 }}>META</th>
                    </tr>
                  </thead>
                  <tbody>
                    {renderTorreTable(
                      torreTab === 'simulacao' ? Object.fromEntries(Object.entries(simLocalMap).map(([k, v]) => [k, v as TorreMeta])) : torreMetaMap,
                      torreRealMap,
                      torreCollapsed,
                      (id) => setTorreCollapsed(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
                      torreTab === 'simulacao'
                    )}
                  </tbody>
                </table>
              </div>
              {torreTab === 'simulacao' && simDirty && (
                <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`, textAlign: 'right' }}>
                  <button onClick={handleSaveSimulation} disabled={savingSim}
                    className="inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-semibold text-white"
                    style={{ background: C.primary, opacity: savingSim ? 0.6 : 1, width: '100%', justifyContent: 'center' }}>
                    {savingSim ? 'Salvando...' : 'Salvar simulação'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
