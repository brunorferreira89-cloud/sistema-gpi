import { useState, useMemo, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Trash2, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { getLeafContas } from '@/lib/dre-indicadores';

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
      shortLabel: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
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
    // Value is already signed correctly from DB; receita adds, others subtract
    total += c.tipo === 'receita' ? v : -Math.abs(v);
  }
  return hasAny ? total : null;
}

function sumLeafsOfNode(node: DreNode, valMap: Record<string, number | null>): number | null {
  if (node.conta.nivel === 2) {
    // Value is already signed correctly from DB (negative for deductions like Troco)
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

/** Format value Nibo-style: negatives as (1.234), zero as "0", null as "—" */
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

// --- Benchmark helpers ---
function getBenchmarkDot(tipo: string, avPct: number, subgrupoNome: string | undefined, benchmarks: BenchmarkThresholds): React.ReactNode | null {
  // Only custo_variavel has benchmarks
  if (tipo !== 'custo_variavel') return null;

  // Check if this is a PESSOAL (CMO) subgroup
  const isPessoal = subgrupoNome?.toUpperCase().includes('PESSOAL') || subgrupoNome?.toUpperCase().includes('MÃO DE OBRA') || subgrupoNome?.toUpperCase().includes('MAO DE OBRA');

  let color: string;
  if (isPessoal) {
    if (avPct < benchmarks.cmo_verde) color = '#00A86B';
    else if (avPct <= benchmarks.cmo_amarelo) color = '#D97706';
    else color = '#DC2626';
  } else {
    if (avPct < benchmarks.cmv_verde) color = '#00A86B';
    else if (avPct <= benchmarks.cmv_amarelo) color = '#D97706';
    else color = '#DC2626';
  }

  return (
    <svg width="6" height="6" style={{ flexShrink: 0 }}>
      <circle cx="3" cy="3" r="3" fill={color} />
    </svg>
  );
}

// --- Legend item ---
function LegendItem({ color, label, sub }: { color: string; label: string; sub: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#4A5E80' }}>
      <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill={color} /></svg>
      <span style={{ fontWeight: 500 }}>{label}</span>
      <span style={{ color: '#8A9BBC', fontSize: 10 }}>({sub})</span>
    </span>
  );
}

// --- component ---

import { type BenchmarkThresholds, DEFAULT_BENCHMARKS } from '@/components/clientes/BenchmarkConfigTab';

interface Props { clienteId: string; benchmarks?: BenchmarkThresholds; }

export function DreAnualTab({ clienteId, benchmarks = DEFAULT_BENCHMARKS }: Props) {
  const years = getYearOptions();
  const [ano, setAno] = useState(years[0]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const months = getMonthsForYear(ano);

  // Current month detection for highlight
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

  const hasAnyData = useMemo(() => {
    return valoresAnuais?.some((v) => v.valor_realizado != null) ?? false;
  }, [valoresAnuais]);

  // --- Filter: which contas have at least one non-null value in the year ---
  const contasComValor = useMemo(() => {
    const set = new Set<string>();
    valoresAnuais?.forEach((v) => {
      if (v.valor_realizado != null) set.add(v.conta_id);
    });
    return set;
  }, [valoresAnuais]);

  /** Check if a DreNode (or any of its descendants) has values */
  function nodeHasValues(node: DreNode): boolean {
    // Leaf node (any nivel): check directly
    if (node.children.length === 0) return contasComValor.has(node.conta.id);
    // Branch node: visible if any child has values
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
          if (v != null) {
            total += v;
          }
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

  const isCurrentMonth = (comp: string) => comp === currentMonthComp;

  // --- AV% helper ---
  const fmtAv = (val: number | null, fat: number): string | null => {
    if (val == null || val === 0 || fat === 0) return null;
    const pct = (Math.abs(val) / Math.abs(fat)) * 100;
    return `${pct.toFixed(1)}%`;
  };

  // Find parent subgroup name for a category (for CMO benchmark detection)
  const getSubgrupoNome = (contaId: string): string | undefined => {
    const conta = contas?.find(c => c.id === contaId);
    if (!conta?.conta_pai_id) return undefined;
    const parent = contas?.find(c => c.id === conta.conta_pai_id);
    return parent?.nome;
  };

  // --- AV% cell renderer ---
  const renderAvCell = (val: number | null, fat: number, opts?: {
    bg?: string;
    isGrupo?: boolean;
    isReceita?: boolean;
    tipo?: string;
    contaId?: string;
    isCurrent?: boolean;
  }): React.ReactNode => {
    const { bg, isGrupo, isReceita, tipo, contaId, isCurrent } = opts || {};
    const baseBg = isCurrent ? (bg === '#F0F4FA' ? '#E8EEF8' : bg === '#0D1B35' ? undefined : '#FAFCFF') : bg;

    // Groups and subgroups: empty AV%
    if (isGrupo) {
      return (
        <td style={{ width: 52, minWidth: 52, padding: '0 6px', background: baseBg }} />
      );
    }

    // Receita group (would be 100%): skip
    if (isReceita) {
      return (
        <td style={{ width: 52, minWidth: 52, padding: '0 6px', background: baseBg }} />
      );
    }

    const avStr = fmtAv(val, fat);
    if (!avStr) {
      return (
        <td style={{ width: 52, minWidth: 52, padding: '0 6px', textAlign: 'right', color: '#C4CFEA', fontSize: 11, background: baseBg }}>
          {val == null ? '' : ''}
        </td>
      );
    }

    const avPct = (Math.abs(val!) / Math.abs(fat)) * 100;
    const dot = tipo && contaId ? getBenchmarkDot(tipo, avPct, getSubgrupoNome(contaId), benchmarks) : null;

    return (
      <td style={{ width: 52, minWidth: 52, padding: '0 6px', textAlign: 'right', background: baseBg }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
          {dot}
          <span style={{ color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace' }}>{avStr}</span>
        </span>
      </td>
    );
  };

  // --- Indicador AV% cell ---
  const renderIndicadorAvCell = (val: number | null, fat: number, dotColor: string): React.ReactNode => {
    if (val == null || fat === 0) {
      return <td style={{ width: 52, minWidth: 52, padding: '0 6px' }} />;
    }
    const pct = ((val / fat) * 100).toFixed(1);
    return (
      <td style={{ width: 52, minWidth: 52, padding: '0 6px', textAlign: 'right' }}>
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
        {months.map((m) => {
          const val = valoresMap[node.conta.id]?.[m.value] ?? null;
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const fat = faturamentoPorMes[m.value] || 0;
          yearFat += fat;
          const f = fmtVal(val);
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
              tipo: node.conta.nivel === 2 ? node.conta.tipo : undefined,
              contaId: node.conta.nivel === 2 ? node.conta.id : undefined,
              isCurrent: isCurrentMonth(m.value),
            }),
          ];
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '7px 12px', width: 80 }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
        {renderAvCell(hasYearVal ? yearTotal : null, yearFat, { isReceita, bg: '#F6F9FF', tipo: node.conta.nivel === 2 ? node.conta.tipo : undefined, contaId: node.conta.nivel === 2 ? node.conta.id : undefined })}
      </tr>
    );
  };

  const renderSubgrupoRow = (node: DreNode) => {
    const isExp = !collapsed.has(node.conta.id);
    const hasKids = node.children.length > 0;
    let yearTotal = 0;
    let hasYearVal = false;

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
        {months.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const f = fmtVal(val);
          return [
            <td key={m.value} style={{
              textAlign: val == null ? 'center' : 'right',
              fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: f.color, padding: '8px 12px',
              background: isCurrentMonth(m.value) ? '#FAFCFF' : undefined,
              width: 80, minWidth: 80,
            }}>
              {f.text}
            </td>,
            <td key={`${m.value}_av`} style={{ width: 52, minWidth: 52, background: isCurrentMonth(m.value) ? '#FAFCFF' : undefined }} />,
          ];
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '8px 12px', width: 80 }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
        <td style={{ width: 52, minWidth: 52, background: '#F6F9FF' }} />
      </tr>
    );
  };

  const renderGrupoRow = (node: DreNode) => {
    const isExp = !collapsed.has(node.conta.id);
    const hasKids = node.children.length > 0;
    let yearTotal = 0;
    let hasYearVal = false;

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
        {months.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const f = fmtVal(val);
          return [
            <td key={m.value} style={{
              textAlign: val == null ? 'center' : 'right',
              fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: f.color, padding: '10px 12px',
              background: isCurrentMonth(m.value) ? '#E8EEF8' : undefined,
              width: 80, minWidth: 80,
            }}>
              {f.text}
            </td>,
            <td key={`${m.value}_av`} style={{ width: 52, minWidth: 52, background: isCurrentMonth(m.value) ? '#E8EEF8' : '#F0F4FA' }} />,
          ];
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, padding: '10px 12px', width: 80 }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
        <td style={{ width: 52, minWidth: 52, background: '#F6F9FF' }} />
      </tr>
    );
  };

  const renderIndicadorRows = (ind: Indicador) => {
    let yearTotal = 0;
    let hasYearVal = false;
    let yearFat = 0;
    const rows: React.ReactNode[] = [];

    // Value row
    rows.push(
      <tr key={ind.key} style={{ background: '#0D1B35' }}>
        <td style={{ ...stickyTd('#0D1B35', { padding: '11px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', borderRightColor: '#2A3A5C' }) }}>
          <span className="flex items-center gap-2">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ind.dotColor, flexShrink: 0, display: 'inline-block' }} />
            {ind.nomeDisplay}
          </span>
        </td>
        {months.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = calcIndicadorValue(leafContas, monthMap, ind.tipos);
          const fat = faturamentoPorMes[m.value] || 0;
          if (val != null) { yearTotal += val; hasYearVal = true; }
          yearFat += fat;
          const f = fmtIndicadorVal(val);
          return [
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: f.color, padding: '11px 12px', width: 80, minWidth: 80 }}>
              {f.text}
            </td>,
            renderIndicadorAvCell(val, fat, ind.dotColor),
          ];
        })}
        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, padding: '11px 12px', background: '#0F1F3D', borderLeft: '1px solid #2A3A5C', color: hasYearVal ? fmtIndicadorVal(yearTotal).color : '#8A9BBC', width: 80 }}>
          {hasYearVal ? fmtIndicadorVal(yearTotal).text : '—'}
        </td>
        {renderIndicadorAvCell(hasYearVal ? yearTotal : null, yearFat, ind.dotColor)}
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
            <td key={`${m.value}_av`} style={{ width: 52, minWidth: 52 }} />,
          ];
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#1A3CFF', padding: '6px 12px', width: 80 }) }}>
          {(() => {
            const totalFat = Object.values(faturamentoPorMes).reduce((a, b) => a + b, 0);
            if (!hasYearVal || totalFat === 0) return '—';
            return `${((yearTotal / totalFat) * 100).toFixed(0)} %`;
          })()}
        </td>
        <td style={{ width: 52, minWidth: 52, background: '#F6F9FF' }} />
      </tr>
    );

    return rows;
  };

  // --- Build full table body ---
  const buildTableBody = () => {
    const output: React.ReactNode[] = [];
    let lastTipo: string | null = null;

    for (const root of sortedRoots) {
      // Skip group if no children have values
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
            // Skip subgroup if no children have values
            if (!nodeHasValues(child)) continue;
            output.push(renderSubgrupoRow(child));
            const subExpanded = !collapsed.has(child.conta.id);
            if (subExpanded) {
              for (const cat of child.children) {
                if (cat.conta.nivel === 2 && temValorNoAno(cat.conta.id)) output.push(renderCategoriaRow(cat));
              }
            }
          } else if (child.conta.nivel === 2) {
            if (temValorNoAno(child.conta.id)) output.push(renderCategoriaRow(child));
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

  // colWidth: 80 (value) + 52 (AV%) = 132 per month, + 132 for year col
  const tableMinWidth = 280 + 12 * 132 + 132;

  return (
    <div className="space-y-4">
      {/* Title + Filter */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#8A9BBC', textTransform: 'uppercase' }}>
          DRE GERENCIAL — BASE MENSAL
        </div>
        <div className="space-y-1">
          <label className="text-xs" style={{ color: '#8A9BBC' }}>Ano</label>
          <Select value={ano} onValueChange={(v) => { setAno(v); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Benchmark Legend */}
      {hasContas && hasAnyData && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border px-4 py-2.5" style={{ borderColor: '#DDE4F0', background: '#F6F9FF' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Benchmarks AV%
          </span>
          <span className="flex items-center gap-4">
            <LegendItem color="#00A86B" label={`CMV < ${benchmarks.cmv_verde}%`} sub="Saudável" />
            <LegendItem color="#D97706" label={`CMV ${benchmarks.cmv_verde}–${benchmarks.cmv_amarelo}%`} sub="Atenção" />
            <LegendItem color="#DC2626" label={`CMV > ${benchmarks.cmv_amarelo}%`} sub="Risco" />
          </span>
          <span style={{ width: 1, height: 16, background: '#DDE4F0' }} />
          <span className="flex items-center gap-4">
            <LegendItem color="#00A86B" label={`CMO < ${benchmarks.cmo_verde}%`} sub="Saudável" />
            <LegendItem color="#D97706" label={`CMO ${benchmarks.cmo_verde}–${benchmarks.cmo_amarelo}%`} sub="Atenção" />
            <LegendItem color="#DC2626" label={`CMO > ${benchmarks.cmo_amarelo}%`} sub="Risco" />
          </span>
        </div>
      )}

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
                  <th key={`${m.value}_av`} style={{
                    padding: '10px 6px', textAlign: 'right', fontSize: 10, fontWeight: 400,
                    color: '#8A9BBC', fontStyle: 'italic', width: 52, minWidth: 52,
                    background: isCurrentMonth(m.value) ? '#1A3CFF1A' : undefined,
                  }}>
                    AV
                  </th>,
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
                <th style={{
                  padding: '10px 6px', textAlign: 'right', fontSize: 10, fontWeight: 400,
                  color: '#8A9BBC', fontStyle: 'italic', width: 52, minWidth: 52, background: '#F6F9FF',
                }}>
                  AV
                </th>
              </tr>
            </thead>
            <tbody>
              {buildTableBody()}
              {/* --- SALDOS DE CONTAS --- */}
              {contasBancarias.length > 0 && (
                <>
                  <tr>
                    <td colSpan={months.length * 2 + 3} style={{ padding: '16px 12px 8px', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#8A9BBC', letterSpacing: '0.08em', background: '#FAFCFF' }}>
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
                              <td key={`${m.value}_av_saldo`} style={{ width: 52, minWidth: 52 }} />,
                            ];
                          })}
                          <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '7px 12px', width: 80 }), color: hasYearVal ? '#0D1B35' : '#C4CFEA' }}>
                            {field === 'saldo_final' && hasYearVal ? formatCurrency(yearTotal).replace('R$\u00a0', '').replace('R$ ', '') : '—'}
                          </td>
                          <td style={{ width: 52, minWidth: 52, background: '#F6F9FF' }} />
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
                        <td key={`${m.value}_av`} style={{ width: 52, minWidth: 52 }} />,
                      ];
                    })}
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, padding: '11px 12px', background: '#0F1F3D', borderLeft: '1px solid #2A3A5C', color: '#8A9BBC', width: 80 }}>
                      —
                    </td>
                    <td style={{ width: 52, minWidth: 52 }} />
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
    </div>
  );
}
