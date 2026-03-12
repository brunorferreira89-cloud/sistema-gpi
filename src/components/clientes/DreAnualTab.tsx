import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet, ArrowUp, ArrowDown, ChevronDown, ChevronRight, ChevronLeft, Trash2, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { getLeafContas } from '@/lib/dre-indicadores';
import { DreIndicadoresHeader } from './DreIndicadoresHeader';
import { AnaliseDrawer, type AnaliseDrawerDados } from './AnaliseDrawer';
import { KpiPainelDre } from './KpiPainelDre';

// --- helpers ---

function getYearOptions() {
  const now = new Date();
  const years: string[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) years.push(String(y));
  return years;
}

function getMonthsForYear(year: string) {
  const months: { value: string; label: string; shortLabel: string }[] = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(Number(year), m, 1);
    months.push({
      value: `${year}-${String(m + 1).padStart(2, '0')}-01`,
      label: d.toLocaleDateString('pt-BR', { month: 'long' }),
      shortLabel: d.toLocaleDateString('pt-BR', { month: 'long' }),
    });
  }
  return months;
}

interface DreNode {
  conta: ContaRow;
  children: DreNode[];
}

function buildDreTree(contas: ContaRow[]): DreNode[] {
  const map = new Map<string, DreNode>();
  const roots: DreNode[] = [];
  for (const c of contas) map.set(c.id, { conta: c, children: [] });
  for (const c of contas) {
    const node = map.get(c.id)!;
    if (c.conta_pai_id && map.has(c.conta_pai_id)) {
      map.get(c.conta_pai_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (arr: DreNode[]) => { arr.sort((a, b) => a.conta.ordem - b.conta.ordem); arr.forEach((n) => sort(n.children)); };
  sort(roots);
  return roots;
}

const TIPO_ORDER = ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'];

interface Indicador {
  key: string;
  nomeDisplay: string;
  pctLabel: string;
  tipos: string[];
  dotColor: string;
}

const INDICADORES: Indicador[] = [
  { key: 'mc', nomeDisplay: 'Margem de contribuição (A+B)', pctLabel: '% ((A+B)÷A)', tipos: ['receita', 'custo_variavel'], dotColor: '#00A86B' },
  { key: 'ro', nomeDisplay: 'Resultado Operacional', pctLabel: '% (RO÷A)', tipos: ['receita', 'custo_variavel', 'despesa_fixa'], dotColor: '#D97706' },
  { key: 'rai', nomeDisplay: 'Resultado após Investimentos', pctLabel: '% (RAI÷A)', tipos: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'], dotColor: '#0099E6' },
  { key: 'gc', nomeDisplay: 'Geração de Caixa', pctLabel: '% (GC÷A)', tipos: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'], dotColor: '#1A3CFF' },
];

const INDICADOR_AFTER_TIPO: Record<string, Indicador> = {
  custo_variavel: INDICADORES[0],
  despesa_fixa: INDICADORES[1],
  investimento: INDICADORES[2],
  financeiro: INDICADORES[3],
};

function calcIndicadorValue(leafs: ContaRow[], valMap: Record<string, number | null>, tipos: string[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const c of leafs) {
    if (!tipos.includes(c.tipo)) continue;
    const v = valMap[c.id];
    if (v == null) continue;
    hasAny = true;
    total += v;
  }
  return hasAny ? total : null;
}

function sumLeafsOfNode(node: DreNode, valMap: Record<string, number | null>): number | null {
  if (node.conta.nivel === 2) {
    return valMap[node.conta.id] ?? null;
  }
  let total = 0;
  let hasAny = false;
  for (const child of node.children) {
    const v = sumLeafsOfNode(child, valMap);
    if (v != null) { total += v; hasAny = true; }
  }
  return hasAny ? total : null;
}

function hasPrefixPlus(nome: string): boolean { return nome.trim().startsWith('(+)'); }
function hasPrefixMinus(nome: string): boolean { return nome.trim().startsWith('(-)'); }

function fmtVal(val: number | null): { text: string; color: string } {
  if (val == null) return { text: '—', color: '#C4CFEA' };
  if (val === 0) return { text: '0', color: '#8A9BBC' };
  if (val < 0) {
    const abs = formatCurrency(Math.abs(val)).replace('R$\u00a0', '').replace('R$ ', '');
    return { text: `(${abs})`, color: '#DC2626' };
  }
  return { text: formatCurrency(val).replace('R$\u00a0', '').replace('R$ ', ''), color: '#0D1B35' };
}

function fmtIndicadorVal(val: number | null): { text: string; color: string } {
  if (val == null) return { text: '—', color: '#8A9BBC' };
  if (val === 0) return { text: '0', color: '#8A9BBC' };
  const abs = formatCurrency(Math.abs(val)).replace('R$\u00a0', '').replace('R$ ', '');
  if (val < 0) return { text: `(${abs})`, color: '#DC2626' };
  return { text: abs, color: '#00A86B' };
}

interface Props { clienteId: string; }

export function DreAnualTab({ clienteId }: Props) {
  const years = getYearOptions();
  const [ano, setAno] = useState(years[0]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showAV, setShowAV] = useState(false);
  const [showAH, setShowAH] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerTitulo, setDrawerTitulo] = useState('');
  const [drawerDados, setDrawerDados] = useState<AnaliseDrawerDados | null>(null);
  const months = getMonthsForYear(ano);
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null);

  const now = new Date();
  const currentMonthComp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const { data: contas } = useQuery({
    queryKey: ['plano-contas-dre', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const competencias = months.map((m) => m.value);

  const { data: valoresAnuais } = useQuery({
    queryKey: ['valores-mensais-dre', clienteId, ano, contas?.length ?? 0],
    enabled: !!clienteId && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map((c) => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, competencia, valor_realizado').in('conta_id', contaIds).gte('competencia', `${ano}-01-01`).lte('competencia', `${ano}-12-31`);
      return data || [];
    },
  });




  // --- Saldos de contas bancárias ---
  const queryClient = useQueryClient();
  const [editingSaldo, setEditingSaldo] = useState<{ key: string; field: 'saldo_inicial' | 'saldo_final' } | null>(null);
  const [editingSaldoValue, setEditingSaldoValue] = useState('');
  const [savingSaldo, setSavingSaldo] = useState(false);
  const [addingConta, setAddingConta] = useState(false);
  const [newContaNome, setNewContaNome] = useState('');
  const [hoveredConta, setHoveredConta] = useState<string | null>(null);

  // --- Benchmark from kpi_indicadores ---
  const { data: kpiIndicadores } = useQuery({
    queryKey: ['kpi-indicadores-benchmark', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('kpi_indicadores')
        .select('*')
        .eq('tipo_fonte', 'subgrupo')
        .eq('ativo', true)
        .or(`cliente_id.eq.${clienteId},cliente_id.is.null`);
      return data || [];
    },
  });

  const benchmarkMap = useMemo(() => {
    const map = new Map<string, { limite_verde: number; limite_ambar: number; direcao: string; nome: string }>();
    const defaults: any[] = [];
    const overrides: any[] = [];
    (kpiIndicadores || []).forEach((k: any) => {
      if (k.cliente_id === clienteId) overrides.push(k);
      else defaults.push(k);
    });
    const overrideNames = new Set(overrides.map((o: any) => o.nome));
    const merged = [...overrides, ...defaults.filter((d: any) => !overrideNames.has(d.nome))];
    
    for (const k of merged) {
      const contaIds: string[] = k.conta_ids && Array.isArray(k.conta_ids) && k.conta_ids.length > 0
        ? k.conta_ids
        : k.conta_id ? [k.conta_id] : [];
      const cfg = { limite_verde: Number(k.limite_verde), limite_ambar: Number(k.limite_ambar), direcao: k.direcao, nome: k.nome };
      for (const cid of contaIds) {
        map.set(cid, cfg);
      }
    }
    return map;
  }, [kpiIndicadores, clienteId]);

  const { data: saldosData } = useQuery({
    queryKey: ['saldos-contas', clienteId, ano],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('saldos_contas')
        .select('*')
        .eq('cliente_id', clienteId)
        .gte('competencia', `${ano}-01-01`)
        .lte('competencia', `${ano}-12-01`)
        .order('ordem')
        .order('nome_conta');
      return data || [];
    },
  });

  const contasBancarias = useMemo(() => {
    const names = new Set<string>();
    saldosData?.forEach((s) => names.add(s.nome_conta));
    return Array.from(names);
  }, [saldosData]);

  const saldosMap = useMemo(() => {
    const map: Record<string, Record<string, { saldo_inicial: number | null; saldo_final: number | null }>> = {};
    saldosData?.forEach((s) => {
      if (!map[s.nome_conta]) map[s.nome_conta] = {};
      map[s.nome_conta][s.competencia] = { saldo_inicial: s.saldo_inicial != null ? Number(s.saldo_inicial) : null, saldo_final: s.saldo_final != null ? Number(s.saldo_final) : null };
    });
    return map;
  }, [saldosData]);

  const saveSaldo = useCallback(async (nomeConta: string, comp: string, field: 'saldo_inicial' | 'saldo_final', value: number | null) => {
    setSavingSaldo(true);
    try {
      const existing = saldosData?.find((s) => s.nome_conta === nomeConta && s.competencia === comp);
      if (existing) {
        await supabase.from('saldos_contas').update({ [field]: value }).eq('id', existing.id);
      } else {
        await supabase.from('saldos_contas').insert({ cliente_id: clienteId, nome_conta: nomeConta, competencia: comp, [field]: value });
      }
      queryClient.invalidateQueries({ queryKey: ['saldos-contas', clienteId, ano] });
    } catch {
      toast.error('Erro ao salvar saldo');
    } finally {
      setSavingSaldo(false);
      setEditingSaldo(null);
    }
  }, [saldosData, clienteId, ano, queryClient]);

  const addContaBancaria = useCallback(async () => {
    if (!newContaNome.trim()) return;
    try {
      await supabase.from('saldos_contas').insert({
        cliente_id: clienteId,
        nome_conta: newContaNome.trim(),
        competencia: `${ano}-01-01`,
        saldo_inicial: null,
        saldo_final: null,
        ordem: contasBancarias.length,
      });
      queryClient.invalidateQueries({ queryKey: ['saldos-contas', clienteId, ano] });
      setNewContaNome('');
      setAddingConta(false);
      toast.success('Conta adicionada');
    } catch {
      toast.error('Erro ao adicionar conta');
    }
  }, [newContaNome, clienteId, ano, contasBancarias.length, queryClient]);

  const deleteContaBancaria = useCallback(async (nomeConta: string) => {
    const hasValues = saldosData?.some((s) => s.nome_conta === nomeConta && (s.saldo_inicial != null || s.saldo_final != null));
    if (hasValues && !window.confirm(`A conta "${nomeConta}" possui valores cadastrados. Deseja realmente excluir?`)) return;
    try {
      await supabase.from('saldos_contas').delete().eq('cliente_id', clienteId).eq('nome_conta', nomeConta);
      queryClient.invalidateQueries({ queryKey: ['saldos-contas', clienteId, ano] });
      toast.success('Conta removida');
    } catch {
      toast.error('Erro ao remover conta');
    }
  }, [saldosData, clienteId, ano, queryClient]);

  const valoresMap = useMemo(() => {
    const map: Record<string, Record<string, number | null>> = {};
    valoresAnuais?.forEach((v) => {
      if (!map[v.conta_id]) map[v.conta_id] = {};
      map[v.conta_id][v.competencia] = v.valor_realizado;
    });
    return map;
  }, [valoresAnuais]);

  const monthsWithData = useMemo(() => {
    return months.filter(m => valoresAnuais?.some(v => v.competencia === m.value && v.valor_realizado != null));
  }, [months, valoresAnuais]);

  // Effective selected month: mesSelecionado or last month with data
  const mesEfetivo = mesSelecionado && monthsWithData.some(m => m.value === mesSelecionado)
    ? mesSelecionado
    : (monthsWithData.length > 0 ? monthsWithData[monthsWithData.length - 1].value : null);

  const hasAnyData = useMemo(() => {
    return valoresAnuais?.some((v) => v.valor_realizado != null) ?? false;
  }, [valoresAnuais]);

  const contasComValor = useMemo(() => {
    const set = new Set<string>();
    valoresAnuais?.forEach((v) => {
      if (v.valor_realizado != null) set.add(v.conta_id);
    });
    return set;
  }, [valoresAnuais]);

  function nodeHasValues(node: DreNode): boolean {
    if (node.children.length === 0) return contasComValor.has(node.conta.id);
    return node.children.some(nodeHasValues);
  }

  const tree = useMemo(() => (contas ? buildDreTree(contas) : []), [contas]);

  const sortedRoots = useMemo(() => {
    return [...tree].sort((a, b) => {
      const ai = TIPO_ORDER.indexOf(a.conta.tipo);
      const bi = TIPO_ORDER.indexOf(b.conta.tipo);
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.conta.ordem - b.conta.ordem;
    });
  }, [tree]);

  const hasContas = contas && contas.length > 0;

  const getMonthMap = (comp: string): Record<string, number | null> => {
    const map: Record<string, number | null> = {};
    contas?.forEach((c) => { map[c.id] = valoresMap[c.id]?.[comp] ?? null; });
    return map;
  };

  const leafContas = useMemo(() => (contas ? getLeafContas(contas) : []), [contas]);

  const faturamentoPorMes = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of months) {
      let total = 0;
      for (const c of leafContas) {
        if (c.tipo === 'receita') {
          const v = valoresMap[c.id]?.[m.value];
          if (v != null) total += v;
        }
      }
      map[m.value] = total;
    }
    return map;
  }, [leafContas, valoresMap, months]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // --- Column count helpers ---
  const colsPerMonth = 1 + (showAV ? 1 : 0) + (showAH ? 1 : 0);
  const avColW = 58;
  const ahColW = 68;

  // --- Sticky cell style helper ---
  const stickyTd = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
    position: 'sticky',
    left: 0,
    zIndex: 10,
    background: bg,
    borderRight: '1px solid #DDE4F0',
    minWidth: 280,
    maxWidth: 320,
    ...extra,
  });

  const yearColStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: '#F6F9FF',
    borderLeft: '1px solid #DDE4F0',
    ...extra,
  });

  const isCurrentMonth = (comp: string) => comp === mesEfetivo;

  // --- AV% helper ---
  const fmtAv = (val: number | null, fat: number): string | null => {
    if (val == null || val === 0 || fat === 0) return null;
    const pct = (Math.abs(val) / Math.abs(fat)) * 100;
    return `${pct.toFixed(1)}%`;
  };



  // --- AH% helper ---
  const renderAhCell = (
    val: number | null,
    prevVal: number | null,
    isExpense: boolean,
    bg?: string,
  ): React.ReactNode => {
    if (!showAH) return null;
    if (val == null || prevVal == null || prevVal === 0) {
      return <td style={{ width: ahColW, minWidth: ahColW, padding: '0 6px', textAlign: 'right', color: '#C4CFEA', fontSize: 11, background: bg }}>—</td>;
    }
    const pct = ((val - prevVal) / Math.abs(prevVal)) * 100;
    // For expenses (costs/despesas): spending less (negative change) is good (green)
    // For revenue/totals: positive change is good (green)
    let isGood: boolean;
    if (isExpense) {
      isGood = pct < 0; // spent less = good
    } else {
      isGood = pct > 0; // earned more = good
    }
    const arrow = pct > 0 ? '▲' : pct < 0 ? '▼' : '';
    const color = pct === 0 ? '#8A9BBC' : isGood ? '#00A86B' : '#DC2626';
    const sign = pct > 0 ? '+' : '';
    return (
      <td style={{ width: ahColW, minWidth: ahColW, padding: '0 6px', textAlign: 'right', fontSize: 11, background: bg }}>
        <span style={{ color, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {arrow} {sign}{pct.toFixed(1)}%
        </span>
      </td>
    );
  };

   // --- AV% cell renderer ---
  const renderAvCell = (val: number | null, fat: number, opts?: {
    bg?: string;
    isGrupo?: boolean;
    isReceita?: boolean;
    isSubgrupo?: boolean;
    isCategoria?: boolean;
    contaId?: string;
    isCurrent?: boolean;
    monthComp?: string;
  }): React.ReactNode => {
    if (!showAV) return null;
    const { bg, isGrupo, isReceita, isSubgrupo, isCategoria, contaId, isCurrent, monthComp } = opts || {};
    const baseBg = isCurrent ? (bg === '#F0F4FA' ? '#E8EEF8' : bg === '#0D1B35' ? undefined : '#FAFCFF') : bg;

    if (isGrupo || isReceita) {
      return <td style={{ width: avColW, minWidth: avColW, padding: '0 6px', background: baseBg }} />;
    }

    const avStr = fmtAv(val, fat);
    if (!avStr) {
      return <td style={{ width: avColW, minWidth: avColW, padding: '0 6px', textAlign: 'right', color: '#C4CFEA', fontSize: 11, background: baseBg }} />;
    }

    const avPct = (Math.abs(val!) / Math.abs(fat)) * 100;

    let dot: React.ReactNode = null;
    let tooltipText: string | null = null;
    let hasBenchmark = false;
    let benchConfig: { limite_verde: number; limite_ambar: number; direcao: string; nome: string } | null = null;
    let dotColor = '#DC2626';

    if ((isSubgrupo || isCategoria) && contaId) {
      const config = benchmarkMap.get(contaId);
      if (config) {
        hasBenchmark = true;
        benchConfig = config;
        if (config.direcao === 'menor_melhor') {
          if (avPct < config.limite_verde) dotColor = '#00A86B';
          else if (avPct < config.limite_ambar) dotColor = '#D97706';
        } else {
          if (avPct > config.limite_verde) dotColor = '#00A86B';
          else if (avPct > config.limite_ambar) dotColor = '#D97706';
        }
        const sign = config.direcao === 'maior_melhor' ? '>' : '<';
        tooltipText = `Benchmark [${config.nome}]: verde ${sign}${config.limite_verde}% · âmbar ${config.limite_verde}–${config.limite_ambar}% · vermelho ${config.direcao === 'menor_melhor' ? '>' : '<'}${config.limite_ambar}%`;
        dot = <span style={{ fontSize: 8, color: dotColor, lineHeight: 1 }}>●</span>;
      }
    }

    const handleDotClick = () => {
      if (!hasBenchmark || !benchConfig || !contaId) return;
      const conta = contas?.find(c => c.id === contaId);
      if (!conta) return;

      const statusStr = dotColor === '#00A86B' ? 'verde' : dotColor === '#D97706' ? 'ambar' : 'vermelho';

      // Build historico: AV% for last 6 months with data
      const monthsWithDataLocal = months.filter(m => valoresAnuais?.some(v => v.competencia === m.value && v.valor_realizado != null));
      const last6Local = monthsWithDataLocal.slice(-6);
      const historico = last6Local.map(m => {
        const mMap: Record<string, number | null> = {};
        contas?.forEach(c => { mMap[c.id] = valoresMap[c.id]?.[m.value] ?? null; });
        let contaVal: number | null = null;
        if (conta.nivel === 1) {
          const kids = contas?.filter(c => c.conta_pai_id === contaId && c.nivel === 2) || [];
          let sum = 0; let hasV = false;
          kids.forEach(k => { const kv = mMap[k.id]; if (kv != null) { sum += kv; hasV = true; } });
          contaVal = hasV ? sum : null;
        } else {
          contaVal = mMap[contaId] ?? null;
        }
        const mFat = faturamentoPorMes[m.value] || 0;
        const pct = contaVal != null && mFat ? (Math.abs(contaVal) / Math.abs(mFat)) * 100 : 0;
        return { mes: m.shortLabel, valor: pct };
      });

      // Build composicao: child categories
      const composicao: { nome: string; valor: number }[] = [];
      if (conta.nivel === 1) {
        const kids = contas?.filter(c => c.conta_pai_id === contaId && c.nivel === 2) || [];
        const refMap = monthComp ? (() => { const m: Record<string, number | null> = {}; contas?.forEach(c => { m[c.id] = valoresMap[c.id]?.[monthComp] ?? null; }); return m; })() : currentMap();
        kids.forEach(k => {
          const kv = refMap[k.id];
          if (kv != null) composicao.push({ nome: k.nome, valor: Math.abs(kv) });
        });
      }

      const latestM = monthsWithDataLocal[monthsWithDataLocal.length - 1];
      const mesRef = latestM ? new Date(latestM.value + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';

      setDrawerTitulo(benchConfig.nome);
      setDrawerDados({
        indicador: benchConfig.nome,
        valor_atual: avPct,
        valor_absoluto: Math.abs(val!),
        faturamento: Math.abs(fat),
        mes_referencia: mesRef,
        status: statusStr as 'verde' | 'ambar' | 'vermelho',
        limite_verde: benchConfig.limite_verde,
        limite_ambar: benchConfig.limite_ambar,
        direcao: benchConfig.direcao,
        historico,
        formula: `AV% = ${conta.nome} / Faturamento × 100`,
        composicao,
      });
      setDrawerOpen(true);
    };

    const currentMap = (): Record<string, number | null> => {
      const m: Record<string, number | null> = {};
      contas?.forEach(c => { m[c.id] = valoresMap[c.id]?.[monthComp || ''] ?? null; });
      return m;
    };

    return (
      <td
        style={{
          width: avColW, minWidth: avColW, padding: '0 6px', textAlign: 'right', background: baseBg,
          cursor: hasBenchmark ? 'pointer' : undefined,
          borderRadius: hasBenchmark ? 4 : undefined,
        }}
        title={tooltipText || undefined}
        onClick={hasBenchmark ? handleDotClick : undefined}
        className={hasBenchmark ? 'hover:bg-[#F6F9FF]' : undefined}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
          {dot}
          <span style={{ color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace' }}>{avStr}</span>
        </span>
      </td>
    );
  };

  // --- Indicador AV% cell ---
  const renderIndicadorAvCell = (val: number | null, fat: number, dotColor: string): React.ReactNode => {
    if (!showAV) return null;
    if (val == null || fat === 0) {
      return <td style={{ width: avColW, minWidth: avColW, padding: '0 6px' }} />;
    }
    const pct = ((val / fat) * 100).toFixed(1);
    return (
      <td style={{ width: avColW, minWidth: avColW, padding: '0 6px', textAlign: 'right' }}>
        <span style={{ color: dotColor, fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{pct}%</span>
      </td>
    );
  };

  // --- Row renderers ---

  const renderCategoriaRow = (node: DreNode) => {
    const nome = node.conta.nome;
    const isPlus = hasPrefixPlus(nome);
    const isMinus = hasPrefixMinus(nome);
    const cleanName = nome.replace(/^\([+-]\)\s*/, '');
    const isReceita = node.conta.tipo === 'receita';
    const isExpense = ['custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'].includes(node.conta.tipo);

    let yearTotal = 0;
    let hasYearVal = false;
    let yearFat = 0;

    return (
      <tr key={node.conta.id} className="hover:bg-[#F6F9FF]" style={{ borderBottom: '1px solid #F8F9FB' }}>
        <td style={stickyTd('#FFFFFF', { padding: '7px 12px 7px 48px', fontWeight: 400, fontSize: 12, color: '#4A5E80' })}>
          <span className="flex items-center gap-1.5">
            {isPlus && <ArrowUp className="h-3 w-3 flex-shrink-0" style={{ color: '#00A86B' }} />}
            {isMinus && <ArrowDown className="h-3 w-3 flex-shrink-0" style={{ color: '#DC2626' }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanName}</span>
          </span>
        </td>
        {months.map((m, i) => {
          const val = valoresMap[node.conta.id]?.[m.value] ?? null;
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const fat = faturamentoPorMes[m.value] || 0;
          yearFat += fat;
          const f = fmtVal(val);
          const prevVal = i > 0 ? (valoresMap[node.conta.id]?.[months[i - 1].value] ?? null) : null;
          return [
            <td key={m.value} style={{
              textAlign: val == null ? 'center' : 'right',
              fontFamily: 'monospace', fontSize: 12, color: f.color, padding: '7px 12px',
              background: isCurrentMonth(m.value) ? '#FAFCFF' : undefined,
              width: 80, minWidth: 80,
            }}>
              {f.text}
            </td>,
            renderAvCell(val, fat, {
              isReceita,
              isCategoria: true,
              contaId: node.conta.id,
              isCurrent: isCurrentMonth(m.value),
              monthComp: m.value,
            }),
            renderAhCell(val, i === 0 ? null : prevVal, isExpense, isCurrentMonth(m.value) ? '#FAFCFF' : undefined),
          ];
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '7px 12px', width: 80 }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
        {renderAvCell(hasYearVal ? yearTotal : null, yearFat, { isReceita, isCategoria: true, contaId: node.conta.id, bg: '#F6F9FF' })}
        {showAH && <td style={{ width: ahColW, minWidth: ahColW, background: '#F6F9FF' }} />}
      </tr>
    );
  };

  const renderSubgrupoRow = (node: DreNode) => {
    const isExp = !collapsed.has(node.conta.id);
    const hasKids = node.children.length > 0;
    const isExpense = ['custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'].includes(node.conta.tipo);
    let yearTotal = 0;
    let hasYearVal = false;
    let yearFat = 0;

    return (
      <tr key={node.conta.id} className="hover:bg-[#F6F9FF]" style={{ background: '#FFFFFF', borderBottom: '1px solid #F0F4FA' }}>
        <td style={stickyTd('#FFFFFF', { padding: '8px 12px 8px 24px', fontWeight: 600, fontSize: 12, color: '#0D1B35' })}>
          <span className="flex items-center gap-1.5">
            {hasKids && (
              <button onClick={() => toggleCollapse(node.conta.id)} className="p-0.5 rounded hover:bg-[#E8EEF8]" style={{ lineHeight: 0 }}>
                {isExp ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.conta.nome}</span>
          </span>
        </td>
        {months.map((m, i) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const fat = faturamentoPorMes[m.value] || 0;
          yearFat += fat;
          const f = fmtVal(val);
          const prevVal = i > 0 ? sumLeafsOfNode(node, getMonthMap(months[i - 1].value)) : null;
          return [
            <td key={m.value} style={{
              textAlign: val == null ? 'center' : 'right',
              fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: f.color, padding: '8px 12px',
              background: isCurrentMonth(m.value) ? '#FAFCFF' : undefined,
              width: 80, minWidth: 80,
            }}>
              {f.text}
            </td>,
            renderAvCell(val, fat, {
              isSubgrupo: true,
              contaId: node.conta.id,
              isCurrent: isCurrentMonth(m.value),
              monthComp: m.value,
            }),
            renderAhCell(val, i === 0 ? null : prevVal, isExpense, isCurrentMonth(m.value) ? '#FAFCFF' : undefined),
          ];
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '8px 12px', width: 80 }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
        {renderAvCell(hasYearVal ? yearTotal : null, yearFat, { isSubgrupo: true, contaId: node.conta.id, bg: '#F6F9FF' })}
        {showAH && <td style={{ width: ahColW, minWidth: ahColW, background: '#F6F9FF' }} />}
      </tr>
    );
  };

  const renderGrupoRow = (node: DreNode) => {
    const isExp = !collapsed.has(node.conta.id);
    const hasKids = node.children.length > 0;
    const isExpense = ['custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'].includes(node.conta.tipo);
    let yearTotal = 0;
    let hasYearVal = false;
    let yearFat = 0;

    return (
      <tr key={node.conta.id} style={{ background: '#F0F4FA', borderTop: '1px solid #C4CFEA', borderBottom: '1px solid #C4CFEA' }}>
        <td style={stickyTd('#F0F4FA', { padding: '10px 12px', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#0D1B35', letterSpacing: '0.04em' })}>
          <span className="flex items-center gap-1.5">
            {hasKids && (
              <button onClick={() => toggleCollapse(node.conta.id)} className="p-0.5 rounded hover:bg-[#DDE4F0]" style={{ lineHeight: 0 }}>
                {isExp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            )}
            <span>{node.conta.nome}</span>
          </span>
        </td>
        {months.map((m, i) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { yearTotal += val; hasYearVal = true; }
          yearFat += faturamentoPorMes[m.value] || 0;
          const fat = faturamentoPorMes[m.value] || 0;
          const f = fmtVal(val);
          const prevVal = i > 0 ? sumLeafsOfNode(node, getMonthMap(months[i - 1].value)) : null;
          const isCur = isCurrentMonth(m.value);
          const bgAv = isCur ? '#E8EEF8' : '#F0F4FA';
          const grupoAvStr = val != null && fat ? `${((Math.abs(val) / Math.abs(fat)) * 100).toFixed(1)}%` : null;
          return [
            <td key={m.value} style={{
              textAlign: val == null ? 'center' : 'right',
              fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: f.color, padding: '10px 12px',
              background: isCur ? '#E8EEF8' : undefined,
              width: 80, minWidth: 80,
            }}>
              {f.text}
            </td>,
            showAV ? (
              <td key={`${m.value}_av`} style={{ width: avColW, minWidth: avColW, padding: '0 6px', textAlign: 'right', background: bgAv }}>
                {grupoAvStr && <span style={{ color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{grupoAvStr}</span>}
              </td>
            ) : null,
            renderAhCell(val, i === 0 ? null : prevVal, isExpense, isCur ? '#E8EEF8' : '#F0F4FA'),
          ];
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, padding: '10px 12px', width: 80 }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
        {showAV && (
          <td style={{ width: avColW, minWidth: avColW, padding: '0 6px', textAlign: 'right', background: '#F6F9FF' }}>
            {hasYearVal && yearFat ? <span style={{ color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{((Math.abs(yearTotal) / Math.abs(yearFat)) * 100).toFixed(1)}%</span> : null}
          </td>
        )}
        {showAH && <td style={{ width: ahColW, minWidth: ahColW, background: '#F6F9FF' }} />}
      </tr>
    );
  };

  const renderIndicadorRows = (ind: Indicador) => {
    let yearTotal = 0;
    let hasYearVal = false;
    let yearFat = 0;
    const rows: React.ReactNode[] = [];

    rows.push(
      <tr key={ind.key} style={{ background: '#0D1B35' }}>
        <td style={{ ...stickyTd('#0D1B35', { padding: '11px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', borderRightColor: '#2A3A5C' }) }}>
          <span className="flex items-center gap-2">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ind.dotColor, flexShrink: 0, display: 'inline-block' }} />
            {ind.nomeDisplay}
          </span>
        </td>
        {months.map((m, i) => {
          const monthMap = getMonthMap(m.value);
          const val = calcIndicadorValue(leafContas, monthMap, ind.tipos);
          const fat = faturamentoPorMes[m.value] || 0;
          if (val != null) { yearTotal += val; hasYearVal = true; }
          yearFat += fat;
          const f = fmtIndicadorVal(val);
          const prevVal = i > 0 ? calcIndicadorValue(leafContas, getMonthMap(months[i - 1].value), ind.tipos) : null;
          return [
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: f.color, padding: '11px 12px', width: 80, minWidth: 80 }}>
              {f.text}
            </td>,
            renderIndicadorAvCell(val, fat, ind.dotColor),
            renderAhCell(val, i === 0 ? null : prevVal, false /* totalizadores: positive=green */),
          ];
        })}
        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, padding: '11px 12px', background: '#0F1F3D', borderLeft: '1px solid #2A3A5C', color: hasYearVal ? fmtIndicadorVal(yearTotal).color : '#8A9BBC', width: 80 }}>
          {hasYearVal ? fmtIndicadorVal(yearTotal).text : '—'}
        </td>
        {renderIndicadorAvCell(hasYearVal ? yearTotal : null, yearFat, ind.dotColor)}
        {showAH && <td style={{ width: ahColW, minWidth: ahColW }} />}
      </tr>
    );

    // Percentage row
    rows.push(
      <tr key={`${ind.key}_pct`} style={{ background: '#1A3CFF0F' }}>
        <td style={{ ...stickyTd('#F5F7FF', { padding: '6px 12px', fontSize: 11, color: '#4A5E80', fontStyle: 'italic' }) }}>
          {ind.pctLabel}
        </td>
        {months.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = calcIndicadorValue(leafContas, monthMap, ind.tipos);
          const fat = faturamentoPorMes[m.value] || 0;
          const pct = fat !== 0 && val != null ? ((val / fat) * 100).toFixed(0) : null;
          return [
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#1A3CFF', padding: '6px 12px', width: 80, minWidth: 80 }}>
              {pct != null ? `${pct} %` : '—'}
            </td>,
            showAV ? <td key={`${m.value}_av`} style={{ width: avColW, minWidth: avColW }} /> : null,
            showAH ? <td key={`${m.value}_ah`} style={{ width: ahColW, minWidth: ahColW }} /> : null,
          ];
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#1A3CFF', padding: '6px 12px', width: 80 }) }}>
          {(() => {
            const totalFat = Object.values(faturamentoPorMes).reduce((a, b) => a + b, 0);
            if (!hasYearVal || totalFat === 0) return '—';
            return `${((yearTotal / totalFat) * 100).toFixed(0)} %`;
          })()}
        </td>
        {showAV && <td style={{ width: avColW, minWidth: avColW, background: '#F6F9FF' }} />}
        {showAH && <td style={{ width: ahColW, minWidth: ahColW, background: '#F6F9FF' }} />}
      </tr>
    );

    return rows;
  };

  // --- Build full table body ---
  const buildTableBody = () => {
    const output: React.ReactNode[] = [];
    let lastTipo: string | null = null;

    for (const root of sortedRoots) {
      if (!nodeHasValues(root)) continue;

      if (lastTipo && lastTipo !== root.conta.tipo) {
        const ind = INDICADOR_AFTER_TIPO[lastTipo];
        if (ind) output.push(...renderIndicadorRows(ind));
      }
      output.push(renderGrupoRow(root));

      const grupoExpanded = !collapsed.has(root.conta.id);
      if (grupoExpanded) {
        for (const child of root.children) {
          if (child.conta.nivel === 1) {
            if (!nodeHasValues(child)) continue;
            output.push(renderSubgrupoRow(child));
            const subExpanded = !collapsed.has(child.conta.id);
            if (subExpanded) {
              for (const cat of child.children) {
                if (cat.conta.nivel === 2 && contasComValor.has(cat.conta.id)) output.push(renderCategoriaRow(cat));
              }
            }
          } else if (child.conta.nivel === 2) {
            if (contasComValor.has(child.conta.id)) output.push(renderCategoriaRow(child));
          }
        }
      }
      lastTipo = root.conta.tipo;
    }

    if (lastTipo) {
      const ind = INDICADOR_AFTER_TIPO[lastTipo];
      if (ind) output.push(...renderIndicadorRows(ind));
    }

    return output;
  };

  const valColW = 80;
  const nameColW = 280;
  const monthBlockW = valColW + (showAV ? avColW : 0) + (showAH ? ahColW : 0);
  const yearBlockW = valColW + (showAV ? avColW : 0) + (showAH ? ahColW : 0);
  const tableMinWidth = nameColW + 12 * monthBlockW + yearBlockW;

  // Total columns for saldos colspan
  const totalCols = 1 + 12 * colsPerMonth + colsPerMonth;

  // --- Toggle button style ---
  const toggleBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? '#1A3CFF' : '#F0F4FA',
    color: active ? '#FFFFFF' : '#8A9BBC',
    border: `1px solid ${active ? '#1A3CFF' : '#DDE4F0'}`,
    borderRadius: 6,
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'all 0.15s',
  });

  return (
    <div className="space-y-4">
      {/* Indicadores Header */}
      {hasContas && contas && valoresAnuais && (
        <DreIndicadoresHeader contas={contas} valoresAnuais={valoresAnuais} months={months} mesSelecionado={mesEfetivo || undefined} clienteId={clienteId} />
      )}

      {/* KPI Health Panel */}
      {hasContas && mesEfetivo && (
        <KpiPainelDre clienteId={clienteId} competencia={mesEfetivo} />
      )}

      {/* Month selector */}
      {monthsWithData.length > 0 && (
        <div className="flex items-center gap-2" style={{ marginBottom: -8 }}>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8A9BBC' }}>
            Referência:
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const idx = monthsWithData.findIndex(m => m.value === mesEfetivo);
                if (idx > 0) setMesSelecionado(monthsWithData[idx - 1].value);
              }}
              disabled={monthsWithData.findIndex(m => m.value === mesEfetivo) <= 0}
              style={{
                padding: '2px 4px', borderRadius: 4, cursor: monthsWithData.findIndex(m => m.value === mesEfetivo) <= 0 ? 'default' : 'pointer',
                color: monthsWithData.findIndex(m => m.value === mesEfetivo) <= 0 ? '#C4CFEA' : '#4A5E80',
                background: 'transparent', border: 'none', lineHeight: 0,
              }}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', color: '#0D1B35', minWidth: 120, textAlign: 'center', display: 'inline-block' }}>
              {mesEfetivo ? new Date(mesEfetivo + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '').toUpperCase() : '—'}
            </span>
            <button
              onClick={() => {
                const idx = monthsWithData.findIndex(m => m.value === mesEfetivo);
                if (idx < monthsWithData.length - 1) setMesSelecionado(monthsWithData[idx + 1].value);
              }}
              disabled={monthsWithData.findIndex(m => m.value === mesEfetivo) >= monthsWithData.length - 1}
              style={{
                padding: '2px 4px', borderRadius: 4, cursor: monthsWithData.findIndex(m => m.value === mesEfetivo) >= monthsWithData.length - 1 ? 'default' : 'pointer',
                color: monthsWithData.findIndex(m => m.value === mesEfetivo) >= monthsWithData.length - 1 ? '#C4CFEA' : '#4A5E80',
                background: 'transparent', border: 'none', lineHeight: 0,
              }}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
      {/* Title + Filter + Toggle Buttons */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#8A9BBC', textTransform: 'uppercase' }}>
          DRE GERENCIAL — BASE MENSAL
        </div>
        <div className="flex items-end gap-3">
          {/* Analysis toggle buttons */}
          <div className="flex items-center gap-1.5">
            <button
              style={toggleBtnStyle(showAV)}
              onClick={() => setShowAV(v => !v)}
              onMouseEnter={e => { if (!showAV) (e.currentTarget.style.background = '#E8EEF8'); }}
              onMouseLeave={e => { if (!showAV) (e.currentTarget.style.background = '#F0F4FA'); }}
            >
              AV%
            </button>
            <button
              style={toggleBtnStyle(showAH)}
              onClick={() => setShowAH(v => !v)}
              onMouseEnter={e => { if (!showAH) (e.currentTarget.style.background = '#E8EEF8'); }}
              onMouseLeave={e => { if (!showAH) (e.currentTarget.style.background = '#F0F4FA'); }}
            >
              AH%
            </button>
            <button
              style={toggleBtnStyle(showAV && showAH)}
              onClick={() => {
                if (showAV && showAH) { setShowAV(false); setShowAH(false); }
                else { setShowAV(true); setShowAH(true); }
              }}
              onMouseEnter={e => { if (!(showAV && showAH)) (e.currentTarget.style.background = '#E8EEF8'); }}
              onMouseLeave={e => { if (!(showAV && showAH)) (e.currentTarget.style.background = '#F0F4FA'); }}
            >
              Ambas
            </button>
          </div>
          <div className="space-y-1">
            <label className="text-xs" style={{ color: '#8A9BBC' }}>Ano</label>
            <Select value={ano} onValueChange={(v) => { setAno(v); setMesSelecionado(null); }}>
              <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      </div>




      {/* Empty states */}
      {!hasContas && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <BookOpen className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Plano de contas não configurado.</p>
        </div>
      )}

      {hasContas && !hasAnyData && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileSpreadsheet className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Nenhum valor importado para {ano}.</p>
        </div>
      )}

      {/* DRE Table */}
      {hasContas && hasAnyData && (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: '#DDE4F0', background: '#FAFCFF' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: tableMinWidth }}>
            <thead>
              <tr style={{ background: '#F0F4FA', borderBottom: '2px solid #DDE4F0' }}>
                <th style={{
                  ...stickyTd('#F0F4FA', {
                    padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                    color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em',
                  }),
                  width: 280,
                }}>
                  RESULTADO
                </th>
                {months.map((m) => [
                  <th key={m.value} style={{
                    padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: isCurrentMonth(m.value) ? 700 : 600,
                    color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em',
                    width: 80, minWidth: 80, whiteSpace: 'nowrap',
                    background: isCurrentMonth(m.value) ? '#1A3CFF1A' : undefined,
                  }}>
                    {m.shortLabel}
                  </th>,
                  showAV ? (
                    <th key={`${m.value}_av`} style={{
                      padding: '10px 6px', textAlign: 'right', fontSize: 10, fontWeight: 400,
                      color: '#8A9BBC', fontStyle: 'italic', width: avColW, minWidth: avColW,
                      background: isCurrentMonth(m.value) ? '#1A3CFF1A' : undefined,
                    }}>
                      AV%
                    </th>
                  ) : null,
                  showAH ? (
                    <th key={`${m.value}_ah`} style={{
                      padding: '10px 6px', textAlign: 'right', fontSize: 10, fontWeight: 400,
                      color: '#8A9BBC', fontStyle: 'italic', width: ahColW, minWidth: ahColW,
                      background: isCurrentMonth(m.value) ? '#1A3CFF1A' : undefined,
                    }}>
                      AH%
                    </th>
                  ) : null,
                ])}
                <th style={{
                  ...yearColStyle({
                    padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700,
                    color: '#0D1B35', textTransform: 'uppercase', letterSpacing: '0.06em',
                    width: 80, whiteSpace: 'nowrap',
                  }),
                }}>
                  {ano}
                </th>
                {showAV && (
                  <th style={{
                    padding: '10px 6px', textAlign: 'right', fontSize: 10, fontWeight: 400,
                    color: '#8A9BBC', fontStyle: 'italic', width: avColW, minWidth: avColW, background: '#F6F9FF',
                  }}>
                    AV%
                  </th>
                )}
                {showAH && (
                  <th style={{
                    padding: '10px 6px', textAlign: 'right', fontSize: 10, fontWeight: 400,
                    color: '#8A9BBC', fontStyle: 'italic', width: ahColW, minWidth: ahColW, background: '#F6F9FF',
                  }}>
                    AH%
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {buildTableBody()}
              {/* --- SALDOS DE CONTAS --- */}
              {contasBancarias.length > 0 && (
                <>
                  <tr>
                    <td colSpan={totalCols} style={{ padding: '16px 12px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#8A9BBC', letterSpacing: '0.08em', background: '#FAFCFF' }}>
                      SALDOS DE CONTAS
                    </td>
                  </tr>
                  {contasBancarias.map((nomeConta) => {
                    const saldos = saldosMap[nomeConta] || {};
                    return (['saldo_inicial', 'saldo_final'] as const).map((field) => {
                      const fieldLabel = field === 'saldo_inicial' ? 'Saldo Inicial' : 'Saldo Final';
                      let yearTotal = 0;
                      let hasYearVal = false;
                      return (
                        <tr key={`${nomeConta}_${field}`}
                          className="hover:bg-[#F6F9FF]"
                          style={{ borderBottom: '1px solid #F8F9FB' }}
                          onMouseEnter={() => setHoveredConta(nomeConta)}
                          onMouseLeave={() => setHoveredConta(null)}
                        >
                          <td style={stickyTd('#FFFFFF', { padding: '7px 12px 7px 16px', fontWeight: 400, fontSize: 12, color: '#4A5E80' })}>
                            <span className="flex items-center gap-2">
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {nomeConta} — {fieldLabel}
                              </span>
                              {field === 'saldo_inicial' && hoveredConta === nomeConta && (
                                <button
                                  onClick={() => deleteContaBancaria(nomeConta)}
                                  className="p-0.5 rounded hover:bg-red-100"
                                  style={{ lineHeight: 0, flexShrink: 0 }}
                                >
                                  <Trash2 className="h-3 w-3" style={{ color: '#DC2626' }} />
                                </button>
                              )}
                            </span>
                          </td>
                          {months.map((m) => {
                            const val = saldos[m.value]?.[field] ?? null;
                            if (val != null) { yearTotal += val; hasYearVal = true; }
                            const editKey = `${nomeConta}_${m.value}`;
                            const isEditing = editingSaldo?.key === editKey && editingSaldo?.field === field;

                            return [
                              <td key={`${m.value}_val`} style={{
                                textAlign: val == null ? 'center' : 'right',
                                fontFamily: 'monospace', fontSize: 12, color: val == null ? '#C4CFEA' : '#0D1B35',
                                padding: '7px 4px', width: 80, minWidth: 80, cursor: 'pointer',
                                background: isCurrentMonth(m.value) ? '#FAFCFF' : undefined,
                              }}
                                onClick={() => {
                                  setEditingSaldo({ key: editKey, field });
                                  setEditingSaldoValue(val != null ? String(val) : '');
                                }}
                              >
                                {isEditing ? (
                                  <span className="flex items-center gap-1">
                                    <input
                                      autoFocus
                                      type="number"
                                      value={editingSaldoValue}
                                      onChange={(e) => setEditingSaldoValue(e.target.value)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          const num = editingSaldoValue.trim() === '' ? null : Number(editingSaldoValue);
                                          saveSaldo(nomeConta, m.value, field, num);
                                        }
                                        if (e.key === 'Escape') setEditingSaldo(null);
                                      }}
                                      onBlur={() => {
                                        const num = editingSaldoValue.trim() === '' ? null : Number(editingSaldoValue);
                                        saveSaldo(nomeConta, m.value, field, num);
                                      }}
                                      style={{
                                        width: '100%', textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                                        border: '1px solid #1A3CFF', borderRadius: 4, padding: '2px 4px',
                                        outline: 'none', background: '#FFFFFF',
                                      }}
                                    />
                                    {savingSaldo && <Loader2 className="h-3 w-3 animate-spin" style={{ color: '#8A9BBC', flexShrink: 0 }} />}
                                  </span>
                                ) : (
                                  val != null ? formatCurrency(val).replace('R$\u00a0', '').replace('R$ ', '') : '—'
                                )}
                              </td>,
                              showAV ? <td key={`${m.value}_av_saldo`} style={{ width: avColW, minWidth: avColW }} /> : null,
                              showAH ? <td key={`${m.value}_ah_saldo`} style={{ width: ahColW, minWidth: ahColW }} /> : null,
                            ];
                          })}
                          <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '7px 12px', width: 80 }), color: hasYearVal ? '#0D1B35' : '#C4CFEA' }}>
                            {field === 'saldo_final' && hasYearVal ? formatCurrency(yearTotal).replace('R$\u00a0', '').replace('R$ ', '') : '—'}
                          </td>
                          {showAV && <td style={{ width: avColW, minWidth: avColW, background: '#F6F9FF' }} />}
                          {showAH && <td style={{ width: ahColW, minWidth: ahColW, background: '#F6F9FF' }} />}
                        </tr>
                      );
                    });
                  })}
                  {/* Saldo Final Consolidado */}
                  <tr style={{ background: '#0D1B35' }}>
                    <td style={{ ...stickyTd('#0D1B35', { padding: '11px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', borderRightColor: '#2A3A5C' }) }}>
                      <span className="flex items-center gap-2">
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0099E6', flexShrink: 0, display: 'inline-block' }} />
                        Saldo Final Consolidado
                      </span>
                    </td>
                    {months.map((m) => {
                      let total = 0;
                      let has = false;
                      contasBancarias.forEach((nome) => {
                        const v = saldosMap[nome]?.[m.value]?.saldo_final;
                        if (v != null) { total += v; has = true; }
                      });
                      const f = has ? fmtIndicadorVal(total) : { text: '—', color: '#8A9BBC' };
                      return [
                        <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: f.color, padding: '11px 12px', width: 80, minWidth: 80 }}>
                          {f.text}
                        </td>,
                        showAV ? <td key={`${m.value}_av`} style={{ width: avColW, minWidth: avColW }} /> : null,
                        showAH ? <td key={`${m.value}_ah`} style={{ width: ahColW, minWidth: ahColW }} /> : null,
                      ];
                    })}
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, padding: '11px 12px', background: '#0F1F3D', borderLeft: '1px solid #2A3A5C', color: '#8A9BBC', width: 80 }}>
                      —
                    </td>
                    {showAV && <td style={{ width: avColW, minWidth: avColW }} />}
                    {showAH && <td style={{ width: ahColW, minWidth: ahColW }} />}
                  </tr>
                </>
              )}
            </tbody>
          </table>
          {/* Add conta button */}
          <div style={{ padding: '8px 12px' }}>
            {addingConta ? (
              <span className="flex items-center gap-2">
                <input
                  autoFocus
                  placeholder="Nome da conta (ex: Bradesco CC)"
                  value={newContaNome}
                  onChange={(e) => setNewContaNome(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addContaBancaria();
                    if (e.key === 'Escape') { setAddingConta(false); setNewContaNome(''); }
                  }}
                  onBlur={() => { if (!newContaNome.trim()) { setAddingConta(false); } }}
                  style={{ fontSize: 12, border: '1px solid #1A3CFF', borderRadius: 4, padding: '4px 8px', outline: 'none', width: 220 }}
                />
              </span>
            ) : (
              <button
                onClick={() => setAddingConta(true)}
                style={{ fontSize: 11, color: '#1A3CFF', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Plus style={{ width: 12, height: 12 }} />
                Adicionar conta
              </button>
            )}
          </div>
        </div>
      )}
      <AnaliseDrawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} titulo={drawerTitulo} dados={drawerDados} />
    </div>
  );
}
