import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { getLeafContas } from '@/lib/dre-indicadores';
import { toast } from 'sonner';

// ── Tree builder (same as DreAnualTab) ──────────────────────────
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

// ── Indicadores ─────────────────────────────────────────────────
interface Indicador { key: string; nome: string; pctLabel: string; tipos: string[]; dotColor: string }

const INDICADORES: Indicador[] = [
  { key: 'mc', nome: 'Margem de Contribuição', pctLabel: '% sobre Faturamento', tipos: ['receita', 'custo_variavel'], dotColor: '#00A86B' },
  { key: 'ro', nome: 'Resultado Operacional', pctLabel: '% sobre Faturamento', tipos: ['receita', 'custo_variavel', 'despesa_fixa'], dotColor: '#D97706' },
  { key: 'rai', nome: 'Resultado após Investimentos', pctLabel: '% sobre Faturamento', tipos: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'], dotColor: '#0099E6' },
  { key: 'gc', nome: 'Geração de Caixa', pctLabel: '% sobre Faturamento', tipos: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'], dotColor: '#1A3CFF' },
];

const INDICADOR_AFTER_TIPO: Record<string, Indicador> = {
  custo_variavel: INDICADORES[0],
  despesa_fixa: INDICADORES[1],
  investimento: INDICADORES[2],
  financeiro: INDICADORES[3],
};

// ── Calc helpers ────────────────────────────────────────────────
function sumLeafsOfNode(node: DreNode, valMap: Record<string, number | null>): number | null {
  if (node.conta.nivel === 2) return valMap[node.conta.id] ?? null;
  let total = 0, hasAny = false;
  for (const child of node.children) {
    const v = sumLeafsOfNode(child, valMap);
    if (v != null) { total += v; hasAny = true; }
  }
  return hasAny ? total : null;
}

function calcIndicadorValue(leafs: ContaRow[], valMap: Record<string, number | null>, tipos: string[]): number | null {
  let total = 0, hasAny = false;
  for (const c of leafs) {
    if (!tipos.includes(c.tipo)) continue;
    const v = valMap[c.id];
    if (v == null) continue;
    hasAny = true;
    total += c.tipo === 'receita' ? v : -Math.abs(v);
  }
  return hasAny ? total : null;
}

// ── Format helpers ──────────────────────────────────────────────
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

function hasPrefixPlus(nome: string): boolean { return nome.trim().startsWith('(+)'); }
function hasPrefixMinus(nome: string): boolean { return nome.trim().startsWith('(-)'); }

// ── Delta badges ────────────────────────────────────────────────
function renderDeltaMeta(realizado: number | null, meta: number | null) {
  if (realizado == null || meta == null || meta === 0) return <span style={{ color: '#C4CFEA' }}>—</span>;
  const delta = realizado - meta;
  // For display: show absolute value of delta
  const absDelta = Math.abs(delta);
  const formatted = formatCurrency(absDelta).replace('R$\u00a0', '').replace('R$ ', '');
  const positive = delta >= 0;
  const color = positive ? '#00A86B' : '#DC2626';
  const bg = positive ? 'rgba(0,168,107,0.08)' : 'rgba(220,38,38,0.08)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600, color, background: bg }}>
      {positive ? '▲' : '▼'} R$ {formatted}
    </span>
  );
}

function renderDeltaAnt(atual: number | null, anterior: number | null) {
  if (atual == null || anterior == null || anterior === 0) return <span style={{ color: '#C4CFEA' }}>—</span>;
  const delta = ((atual - anterior) / Math.abs(anterior)) * 100;
  const positive = delta >= 0;
  const color = positive ? '#00A86B' : '#DC2626';
  const bg = positive ? 'rgba(0,168,107,0.08)' : 'rgba(220,38,38,0.08)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600, color, background: bg }}>
      {positive ? '▲' : '▼'} {positive ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

// ── Editable meta cell ──────────────────────────────────────────
function EditableMetaCell({ value, onSave }: { value: number | null; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  const commit = () => {
    setEditing(false);
    const num = parseFloat(input.replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (!isNaN(num)) onSave(num);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={input}
        onChange={e => setInput(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        style={{ width: 90, textAlign: 'right', fontFamily: 'monospace', fontSize: 12, border: '1px solid #4A90D9', borderRadius: 4, padding: '2px 6px', outline: 'none', background: '#F6F9FF' }}
      />
    );
  }

  const f = fmtVal(value);
  return (
    <span
      onClick={() => { setEditing(true); setInput(value != null ? String(value) : ''); }}
      style={{ cursor: 'pointer', color: value != null ? f.color : '#C4CFEA', fontFamily: 'monospace', fontSize: 12 }}
      title="Clique para editar meta"
    >
      {value != null ? f.text : '—'}
    </span>
  );
}

// ── Sticky cell helper ──────────────────────────────────────────
const stickyTd = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
  position: 'sticky', left: 0, zIndex: 10, background: bg,
  borderRight: '1px solid #DDE4F0', minWidth: 280, maxWidth: 360, ...extra,
});

// ── Row types ───────────────────────────────────────────────────
type RowItem =
  | { type: 'conta'; conta: ContaRow; node: DreNode }
  | { type: 'indicador'; indicador: Indicador };

// ══════════════════════════════════════════════════════════════════
interface Props { clienteId: string }

export function TorreControleTab({ clienteId }: Props) {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const anoSelecionado = useMemo(() => competencia ? competencia.split('-')[0] : String(new Date().getFullYear()), [competencia]);

  const mesAnterior = useMemo(() => {
    if (!competencia) return '';
    const [y, m] = competencia.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }, [competencia]);

  // ── Competências com importação ───────────────────────────────
  const { data: importacoes } = useQuery({
    queryKey: ['importacoes-nibo-competencias', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('importacoes_nibo')
        .select('competencia')
        .eq('cliente_id', clienteId)
        .order('competencia', { ascending: false });
      return data || [];
    },
  });

  const competenciaOptions = useMemo(() => {
    if (!importacoes) return [];
    const unique = [...new Set(importacoes.map(i => i.competencia))];
    unique.sort((a, b) => b.localeCompare(a));
    return unique.map(c => {
      const [y, m] = c.split('-');
      const d = new Date(Number(y), Number(m) - 1, 1);
      return { value: c, label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) };
    });
  }, [importacoes]);

  // Auto-select first competencia
  useEffect(() => {
    if (competenciaOptions.length && !competencia) setCompetencia(competenciaOptions[0].value);
  }, [competenciaOptions, competencia]);

  // ── Data queries ──────────────────────────────────────────────
  const { data: contas } = useQuery({
    queryKey: ['plano-contas-torre', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const { data: valores } = useQuery({
    queryKey: ['valores-mensais-torre', clienteId, competencia, contas?.length ?? 0],
    enabled: !!clienteId && !!competencia && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map(c => c.id);
      const { data } = await supabase.from('valores_mensais').select('*').in('conta_id', contaIds).eq('competencia', competencia);
      return data || [];
    },
  });

  const { data: valoresAnterior } = useQuery({
    queryKey: ['valores-mensais-torre-ant', clienteId, mesAnterior, contas?.length ?? 0],
    enabled: !!clienteId && !!mesAnterior && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map(c => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, valor_realizado').in('conta_id', contaIds).eq('competencia', mesAnterior);
      return data || [];
    },
  });

  const { data: valoresAnoCompleto } = useQuery({
    queryKey: ['valores-ano-completo-torre', clienteId, anoSelecionado, contas?.length ?? 0],
    enabled: !!clienteId && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map(c => c.id);
      const { data } = await supabase
        .from('valores_mensais')
        .select('conta_id, valor_realizado, valor_meta')
        .in('conta_id', contaIds)
        .gte('competencia', `${anoSelecionado}-01-01`)
        .lte('competencia', `${anoSelecionado}-12-31`);
      return data || [];
    },
  });

  // ── Save meta mutation ────────────────────────────────────────
  const saveMeta = useMutation({
    mutationFn: async ({ contaId, valor }: { contaId: string; valor: number }) => {
      // Check if record exists
      const { data: existing } = await supabase
        .from('valores_mensais')
        .select('id')
        .eq('conta_id', contaId)
        .eq('competencia', competencia)
        .maybeSingle();

      if (existing) {
        await supabase.from('valores_mensais').update({ valor_meta: valor }).eq('id', existing.id);
      } else {
        await supabase.from('valores_mensais').insert({ conta_id: contaId, competencia, valor_meta: valor, valor_realizado: null });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['valores-mensais-torre', clienteId, competencia] });
      toast.success('Meta salva');
    },
    onError: () => toast.error('Erro ao salvar meta'),
  });

  // ── Maps ──────────────────────────────────────────────────────
  const realizadoMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valores?.forEach(v => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valores]);

  const metaMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valores?.forEach(v => { map[v.conta_id] = v.valor_meta; });
    return map;
  }, [valores]);

  const valoresAntMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valoresAnterior?.forEach(v => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valoresAnterior]);

  // ── Tree + leafs ──────────────────────────────────────────────
  const tree = useMemo(() => contas ? buildDreTree(contas) : [], [contas]);
  const leafContas = useMemo(() => contas ? getLeafContas(contas) : [], [contas]);
  const nodeMap = useMemo(() => {
    const m = new Map<string, DreNode>();
    const walk = (nodes: DreNode[]) => { for (const n of nodes) { m.set(n.conta.id, n); walk(n.children); } };
    walk(tree);
    return m;
  }, [tree]);

  // ── Faturamento ───────────────────────────────────────────────
  const faturamento = useMemo(() => {
    let real = 0, meta = 0;
    leafContas.filter(c => c.tipo === 'receita').forEach(c => {
      const r = realizadoMap[c.id]; if (r != null) real += r;
      const m = metaMap[c.id]; if (m != null) meta += m;
    });
    return { real, meta };
  }, [leafContas, realizadoMap, metaMap]);

  const faturamentoAnt = useMemo(() => {
    let total = 0;
    leafContas.filter(c => c.tipo === 'receita').forEach(c => {
      const v = valoresAntMap[c.id]; if (v != null) total += v;
    });
    return total;
  }, [leafContas, valoresAntMap]);

  // ── Visibility filter (year-level) ────────────────────────────
  const contasComDados = useMemo(() => {
    const set = new Set<string>();
    valoresAnoCompleto?.forEach(v => {
      if (v.valor_realizado != null || v.valor_meta != null) set.add(v.conta_id);
    });
    return set;
  }, [valoresAnoCompleto]);

  const contaHasValues = useCallback((contaId: string, nivel: number): boolean => {
    if (nivel === 2) return contasComDados.has(contaId);
    return contas?.some(c => c.conta_pai_id === contaId && contaHasValues(c.id, c.nivel)) ?? false;
  }, [contas, contasComDados]);

  // ── Flatten visible rows with indicators ──────────────────────
  const visibleRows = useMemo((): RowItem[] => {
    if (!contas) return [];
    const rows: RowItem[] = [];
    let lastTipo = '';

    for (const conta of contas) {
      if (!contaHasValues(conta.id, conta.nivel)) continue;
      if (conta.nivel >= 1 && conta.conta_pai_id && collapsed.has(conta.conta_pai_id)) continue;
      if (conta.nivel === 2 && conta.conta_pai_id) {
        const parent = contas.find(c => c.id === conta.conta_pai_id);
        if (parent?.conta_pai_id && collapsed.has(parent.conta_pai_id)) continue;
      }

      if (lastTipo && lastTipo !== conta.tipo) {
        const ind = INDICADOR_AFTER_TIPO[lastTipo];
        if (ind) rows.push({ type: 'indicador', indicador: ind });
      }
      rows.push({ type: 'conta', conta, node: nodeMap.get(conta.id)! });
      lastTipo = conta.tipo;
    }
    if (lastTipo) {
      const ind = INDICADOR_AFTER_TIPO[lastTipo];
      if (ind) rows.push({ type: 'indicador', indicador: ind });
    }
    return rows;
  }, [contas, collapsed, contaHasValues, nodeMap]);

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some(v => v.valor_realizado != null);
  const hasAnterior = valoresAnterior && valoresAnterior.some(v => v.valor_realizado != null);
  const compLabel = competenciaOptions.find(c => c.value === competencia)?.label || '';

  // ══════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#8A9BBC', textTransform: 'uppercase' }}>
          TORRE DE CONTROLE — DRE MENSAL
        </div>
        <div className="space-y-1">
          <label className="text-xs" style={{ color: '#8A9BBC' }}>Competência</label>
          <Select value={competencia} onValueChange={setCompetencia}>
            <SelectTrigger className="w-60"><SelectValue placeholder="Selecionar mês..." /></SelectTrigger>
            <SelectContent>
              {competenciaOptions.map(c => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Empty states */}
      {!hasContas && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <BookOpen className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Plano de contas não configurado.</p>
        </div>
      )}
      {hasContas && !hasValores && competencia && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileSpreadsheet className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Nenhum valor importado para {compLabel}</p>
        </div>
      )}
      {hasContas && !competencia && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileSpreadsheet className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Nenhuma importação encontrada para este cliente.</p>
        </div>
      )}

      {/* Table */}
      {hasContas && hasValores && (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: '#DDE4F0', background: '#FAFCFF' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead>
              <tr style={{ background: '#F0F4FA', borderBottom: '2px solid #DDE4F0' }}>
                <th style={{ ...stickyTd('#F0F4FA', { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em' }), width: 280 }}>
                  CONTA DRE
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 110 }}>REALIZADO</th>
                <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 10, fontWeight: 400, color: '#8A9BBC', fontStyle: 'italic', width: 60 }}>AV%</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 110 }}>META</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 100 }}>Δ VS META</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 110, borderLeft: '1px solid #DDE4F0' }}>MÊS ANT.</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 90 }}>Δ VS ANT.</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                // ── Indicador row ───────────────────────────────
                if (row.type === 'indicador') {
                  const ind = row.indicador;
                  const realVal = calcIndicadorValue(leafContas, realizadoMap, ind.tipos);
                  const metaVal = calcIndicadorValue(leafContas, metaMap, ind.tipos);
                  const antVal = hasAnterior ? calcIndicadorValue(leafContas, valoresAntMap, ind.tipos) : null;
                  const av = faturamento.real ? ((realVal ?? 0) / faturamento.real * 100).toFixed(1) : null;
                  const f = fmtIndicadorVal(realVal);

                  return [
                    <tr key={ind.key} style={{ background: '#0D1B35' }}>
                      <td style={stickyTd('#0D1B35', { padding: '11px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', borderRightColor: '#2A3A5C' })}>
                        <span className="flex items-center gap-2">
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: ind.dotColor, flexShrink: 0, display: 'inline-block' }} />
                          {ind.nome}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: f.color, padding: '11px 12px' }}>{f.text}</td>
                      <td style={{ textAlign: 'right', padding: '11px 6px' }}>
                        {av != null && <span style={{ color: ind.dotColor, fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{av}%</span>}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#8A9BBC', padding: '11px 12px' }}>
                        {metaVal != null && metaVal !== 0 ? fmtIndicadorVal(metaVal).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '11px 12px' }}>
                        {renderDeltaMeta(realVal, metaVal != null && metaVal !== 0 ? metaVal : null)}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#8A9BBC', padding: '11px 12px', borderLeft: '1px solid #2A3A5C' }}>
                        {antVal != null ? fmtIndicadorVal(antVal).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '11px 12px' }}>
                        {renderDeltaAnt(realVal, antVal)}
                      </td>
                    </tr>,
                    <tr key={`${ind.key}_pct`} style={{ background: '#1A3CFF0F' }}>
                      <td style={stickyTd('#F5F7FF', { padding: '6px 12px', fontSize: 11, color: '#4A5E80', fontStyle: 'italic' })}>
                        {ind.pctLabel}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: ind.dotColor, padding: '6px 12px' }}>
                        {av != null ? `${av} %` : '—'}
                      </td>
                      <td />
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#8A9BBC', padding: '6px 12px' }}>
                        {faturamento.meta ? `${((metaVal ?? 0) / faturamento.meta * 100).toFixed(1)} %` : '—'}
                      </td>
                      <td />
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#8A9BBC', padding: '6px 12px', borderLeft: '1px solid #DDE4F0' }}>
                        {faturamentoAnt ? `${(((antVal ?? 0) / faturamentoAnt) * 100).toFixed(1)} %` : '—'}
                      </td>
                      <td />
                    </tr>,
                  ];
                }

                // ── Conta rows ──────────────────────────────────
                const { conta, node } = row;
                const isSecao = conta.nivel === 0;
                const isGrupo = conta.nivel === 1;
                const isCat = conta.nivel === 2;

                let displayReal = node ? sumLeafsOfNode(node, realizadoMap) : null;
                let displayMeta = node ? sumLeafsOfNode(node, metaMap) : null;
                let displayAnt = node ? sumLeafsOfNode(node, valoresAntMap) : null;

                if (isCat) {
                  displayReal = realizadoMap[conta.id] ?? null;
                  displayMeta = metaMap[conta.id] ?? null;
                  displayAnt = valoresAntMap[conta.id] ?? null;
                }

                const av = displayReal != null && faturamento.real ? ((Math.abs(displayReal) / Math.abs(faturamento.real)) * 100).toFixed(1) : null;
                const hasChildren = contas!.some(c => c.conta_pai_id === conta.id);
                const isCollapsedItem = collapsed.has(conta.id);

                const nome = conta.nome;
                const isPlus = hasPrefixPlus(nome);
                const isMinus = hasPrefixMinus(nome);
                const cleanName = nome.replace(/^\([+-]\)\s*/, '');

                // ── Grupo (nivel=0) ─────────────────────────────
                if (isSecao) {
                  const f = fmtVal(displayReal);
                  return (
                    <tr key={conta.id} style={{ background: '#E8EEF8', borderBottom: '1px solid #C4CFEA' }}>
                      <td style={stickyTd('#E8EEF8', { padding: '10px 12px', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#0D1B35', letterSpacing: '0.04em' })}>
                        <span className="flex items-center gap-1.5">
                          {hasChildren && (
                            <button onClick={() => toggleCollapse(conta.id)} className="p-0.5 rounded hover:bg-[#DDE4F0]" style={{ lineHeight: 0 }}>
                              {isCollapsedItem ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          {conta.nome}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: f.color, padding: '10px 12px' }}>{f.text}</td>
                      <td style={{ textAlign: 'right', padding: '10px 6px', color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace' }}>{av ? `${av}%` : ''}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: displayMeta != null ? fmtVal(displayMeta).color : '#C4CFEA', padding: '10px 12px' }}>
                        {displayMeta != null ? fmtVal(displayMeta).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '10px 12px' }}>{renderDeltaMeta(displayReal, displayMeta)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '10px 12px', borderLeft: '1px solid #DDE4F0' }}>
                        {displayAnt != null ? fmtVal(displayAnt).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '10px 12px' }}>{renderDeltaAnt(displayReal, displayAnt)}</td>
                    </tr>
                  );
                }

                // ── Subgrupo (nivel=1) ──────────────────────────
                if (isGrupo) {
                  const f = fmtVal(displayReal);
                  return (
                    <tr key={conta.id} style={{ background: '#F6F9FF', borderBottom: '1px solid #DDE4F0' }}>
                      <td style={stickyTd('#F6F9FF', { padding: '8px 12px 8px 24px', fontWeight: 600, fontSize: 12, color: '#0D1B35' })}>
                        <span className="flex items-center gap-1.5">
                          {hasChildren && (
                            <button onClick={() => toggleCollapse(conta.id)} className="p-0.5 rounded hover:bg-[#E8EEF8]" style={{ lineHeight: 0 }}>
                              {isCollapsedItem ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conta.nome}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: f.color, padding: '8px 12px' }}>{f.text}</td>
                      <td style={{ textAlign: 'right', padding: '8px 6px' }} />
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: displayMeta != null ? fmtVal(displayMeta).color : '#C4CFEA', padding: '8px 12px' }}>
                        {displayMeta != null ? fmtVal(displayMeta).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 12px' }}>{renderDeltaMeta(displayReal, displayMeta)}</td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '8px 12px', borderLeft: '1px solid #DDE4F0' }}>
                        {displayAnt != null ? fmtVal(displayAnt).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 12px' }}>{renderDeltaAnt(displayReal, displayAnt)}</td>
                    </tr>
                  );
                }

                // ── Categoria (nivel=2) ─────────────────────────
                const f = fmtVal(displayReal);
                return (
                  <tr key={conta.id} className="hover:bg-[#F6F9FF]" style={{ borderBottom: '1px solid #F0F4FA' }}>
                    <td style={stickyTd('#FFFFFF', { padding: '7px 12px 7px 48px', fontWeight: 400, fontSize: 12, color: '#4A5E80' })}>
                      <span className="flex items-center gap-1.5">
                        {isPlus && <ArrowUp className="h-3 w-3 flex-shrink-0" style={{ color: '#00A86B' }} />}
                        {isMinus && <ArrowDown className="h-3 w-3 flex-shrink-0" style={{ color: '#DC2626' }} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanName}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: f.color, padding: '7px 12px' }}>{f.text}</td>
                    <td style={{ textAlign: 'right', padding: '7px 6px', color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace' }}>
                      {conta.tipo !== 'receita' && av ? `${av}%` : ''}
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 12px' }}>
                      <EditableMetaCell
                        value={displayMeta}
                        onSave={(v) => saveMeta.mutate({ contaId: conta.id, valor: v })}
                      />
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 12px' }}>{renderDeltaMeta(displayReal, displayMeta)}</td>
                    <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '7px 12px', borderLeft: '1px solid #DDE4F0' }}>
                      {displayAnt != null ? fmtVal(displayAnt).text : '—'}
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 12px' }}>{renderDeltaAnt(displayReal, displayAnt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
