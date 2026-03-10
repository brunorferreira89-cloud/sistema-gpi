import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet, ChevronDown, ChevronRight, ArrowUp, ArrowDown } from 'lucide-react';
import { toast } from 'sonner';

// ── Tree builder ────────────────────────────────────────────────
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

// ── Fixed DRE sequence ──────────────────────────────────────────
const SEQUENCIA_DRE: { tipo: string; totalizadorApos: string | null }[] = [
  { tipo: 'receita', totalizadorApos: null },
  { tipo: 'custo_variavel', totalizadorApos: 'MC' },
  { tipo: 'despesa_fixa', totalizadorApos: 'RO' },
  { tipo: 'investimento', totalizadorApos: 'RAI' },
  { tipo: 'financeiro', totalizadorApos: 'GC' },
];

const TOTALIZADOR_CONFIG: Record<string, { nome: string; dotColor: string }> = {
  MC: { nome: 'Margem de Contribuição', dotColor: '#00A86B' },
  RO: { nome: 'Resultado Operacional', dotColor: '#D97706' },
  RAI: { nome: 'Resultado após Investimentos', dotColor: '#0099E6' },
  GC: { nome: 'Geração de Caixa', dotColor: '#1A3CFF' },
};

// ── Calc helpers ────────────────────────────────────────────────
function getValor(id: string, valMap: Record<string, number | null>): number | null {
  return valMap[id] ?? null;
}

function sumNodeLeafs(node: DreNode, valMap: Record<string, number | null>): number | null {
  if (node.conta.nivel === 2) return getValor(node.conta.id, valMap);
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
  return val < 0 ? { text: `(${abs})`, color: '#DC2626' } : { text: abs, color: '#00A86B' };
}

// ── Delta renderers ─────────────────────────────────────────────
function renderDeltaMeta(realizado: number | null, meta: number | null, tipo?: string) {
  if (realizado == null || meta == null || meta === 0) return <span style={{ color: '#C4CFEA' }}>—</span>;
  const delta = realizado - meta;
  const isCostType = tipo === 'custo_variavel' || tipo === 'despesa_fixa' || tipo === 'investimento';
  // For costs: spending less (delta < 0) is good (green)
  const isGood = isCostType ? delta < 0 : delta > 0;
  const color = isGood ? '#00A86B' : '#DC2626';
  const bg = isGood ? 'rgba(0,168,107,0.08)' : 'rgba(220,38,38,0.08)';
  const formatted = formatCurrency(Math.abs(delta)).replace('R$\u00a0', '').replace('R$ ', '');
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600, color, background: bg }}>
      {isGood ? '▲' : '▼'} R$ {formatted}
    </span>
  );
}

function renderDeltaAnt(atual: number | null, anterior: number | null, tipo?: string) {
  if (atual == null || anterior == null || anterior === 0) return <span style={{ color: '#C4CFEA' }}>—</span>;
  const pct = ((atual - anterior) / Math.abs(anterior)) * 100;
  const isCostType = tipo === 'custo_variavel' || tipo === 'despesa_fixa' || tipo === 'investimento';
  const isGood = isCostType ? pct < 0 : pct > 0;
  const color = isGood ? '#00A86B' : '#DC2626';
  const bg = isGood ? 'rgba(0,168,107,0.08)' : 'rgba(220,38,38,0.08)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600, color, background: bg }}>
      {isGood ? '▲' : '▼'} {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
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
      qc.invalidateQueries({ queryKey: ['valores-ano-completo-torre', clienteId] });
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

  // ── Tree ──────────────────────────────────────────────────────
  const tree = useMemo(() => contas ? buildDreTree(contas) : [], [contas]);

  // ── Group roots by tipo ───────────────────────────────────────
  const gruposPorTipo = useMemo(() => {
    const map: Record<string, DreNode[]> = {};
    for (const node of tree) {
      const tipo = node.conta.tipo;
      if (!map[tipo]) map[tipo] = [];
      map[tipo].push(node);
    }
    return map;
  }, [tree]);

  // ── Visibility (year-level) ───────────────────────────────────
  const contasComDados = useMemo(() => {
    const set = new Set<string>();
    valoresAnoCompleto?.forEach(v => {
      if (v.valor_realizado != null || v.valor_meta != null) set.add(v.conta_id);
    });
    return set;
  }, [valoresAnoCompleto]);

  const nodeIsVisible = useCallback((node: DreNode): boolean => {
    if (node.conta.nivel === 2) return contasComDados.has(node.conta.id);
    return node.children.some(child => nodeIsVisible(child));
  }, [contasComDados]);

  // ── Totalizador values ────────────────────────────────────────
  const totais = useMemo(() => {
    const fat = sumGrupos(gruposPorTipo['receita'] || [], realizadoMap);
    const custos = sumGrupos(gruposPorTipo['custo_variavel'] || [], realizadoMap);
    const mc = fat + custos;
    const despesas = sumGrupos(gruposPorTipo['despesa_fixa'] || [], realizadoMap);
    const ro = mc + despesas;
    const invest = sumGrupos(gruposPorTipo['investimento'] || [], realizadoMap);
    const rai = ro + invest;
    const financ = sumGrupos(gruposPorTipo['financeiro'] || [], realizadoMap);
    const gc = rai + financ;
    return { fat, MC: mc, RO: ro, RAI: rai, GC: gc };
  }, [gruposPorTipo, realizadoMap]);

  const totaisMeta = useMemo(() => {
    const fat = sumGrupos(gruposPorTipo['receita'] || [], metaMap);
    const custos = sumGrupos(gruposPorTipo['custo_variavel'] || [], metaMap);
    const mc = fat + custos;
    const despesas = sumGrupos(gruposPorTipo['despesa_fixa'] || [], metaMap);
    const ro = mc + despesas;
    const invest = sumGrupos(gruposPorTipo['investimento'] || [], metaMap);
    const rai = ro + invest;
    const financ = sumGrupos(gruposPorTipo['financeiro'] || [], metaMap);
    const gc = rai + financ;
    return { fat, MC: mc, RO: ro, RAI: rai, GC: gc };
  }, [gruposPorTipo, metaMap]);

  const totaisAnt = useMemo(() => {
    const fat = sumGrupos(gruposPorTipo['receita'] || [], valoresAntMap);
    const custos = sumGrupos(gruposPorTipo['custo_variavel'] || [], valoresAntMap);
    const mc = fat + custos;
    const despesas = sumGrupos(gruposPorTipo['despesa_fixa'] || [], valoresAntMap);
    const ro = mc + despesas;
    const invest = sumGrupos(gruposPorTipo['investimento'] || [], valoresAntMap);
    const rai = ro + invest;
    const financ = sumGrupos(gruposPorTipo['financeiro'] || [], valoresAntMap);
    const gc = rai + financ;
    return { fat, MC: mc, RO: ro, RAI: rai, GC: gc };
  }, [gruposPorTipo, valoresAntMap]);

  const faturamento = totais.fat;
  const faturamentoMeta = totaisMeta.fat;
  const faturamentoAnt = totaisAnt.fat;

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some(v => v.valor_realizado != null);
  const hasAnterior = valoresAnterior && valoresAnterior.some(v => v.valor_realizado != null);
  const compLabel = competenciaOptions.find(c => c.value === competencia)?.label || '';

  // ── Render helpers ────────────────────────────────────────────
  const renderCategoria = (node: DreNode) => {
    const conta = node.conta;
    const displayReal = realizadoMap[conta.id] ?? null;
    const displayMeta = metaMap[conta.id] ?? null;
    const displayAnt = valoresAntMap[conta.id] ?? null;
    const av = displayReal != null && faturamento ? ((Math.abs(displayReal) / Math.abs(faturamento)) * 100).toFixed(1) : null;
    const isPlus = conta.nome.trim().startsWith('(+)');
    const isMinus = conta.nome.trim().startsWith('(-)');
    const cleanName = conta.nome.replace(/^\([+-]\)\s*/, '');
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
        <td style={{ textAlign: 'right', padding: '7px 6px', color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace' }}>{av ? `${av}%` : ''}</td>
        <td style={{ textAlign: 'right', padding: '7px 12px' }}>
          <EditableMetaCell value={displayMeta} onSave={(v) => saveMeta.mutate({ contaId: conta.id, valor: v })} />
        </td>
        <td style={{ textAlign: 'right', padding: '7px 12px' }}>{renderDeltaMeta(displayReal, displayMeta, conta.tipo)}</td>
        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '7px 12px', borderLeft: '1px solid #DDE4F0' }}>
          {displayAnt != null ? fmtVal(displayAnt).text : '—'}
        </td>
        <td style={{ textAlign: 'right', padding: '7px 12px' }}>{renderDeltaAnt(displayReal, displayAnt, conta.tipo)}</td>
      </tr>
    );
  };

  const renderSubgrupo = (node: DreNode) => {
    if (!nodeIsVisible(node)) return null;
    const conta = node.conta;
    const displayReal = sumNodeLeafs(node, realizadoMap);
    const displayMeta = sumNodeLeafs(node, metaMap);
    const displayAnt = sumNodeLeafs(node, valoresAntMap);
    const f = fmtVal(displayReal);
    const hasChildren = node.children.length > 0;
    const isCollapsedItem = collapsed.has(conta.id);

    return (
      <Fragment key={conta.id}>
        <tr style={{ background: '#F6F9FF', borderBottom: '1px solid #DDE4F0' }}>
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
          <td style={{ textAlign: 'right', padding: '8px 12px' }}>{renderDeltaMeta(displayReal, displayMeta, conta.tipo)}</td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '8px 12px', borderLeft: '1px solid #DDE4F0' }}>
            {displayAnt != null ? fmtVal(displayAnt).text : '—'}
          </td>
          <td style={{ textAlign: 'right', padding: '8px 12px' }}>{renderDeltaAnt(displayReal, displayAnt, conta.tipo)}</td>
        </tr>
        {!isCollapsedItem && node.children.filter(c => nodeIsVisible(c)).map(child => renderCategoria(child))}
      </Fragment>
    );
  };

  const renderGrupo = (node: DreNode) => {
    if (!nodeIsVisible(node)) return null;
    const conta = node.conta;
    const displayReal = sumNodeLeafs(node, realizadoMap);
    const displayMeta = sumNodeLeafs(node, metaMap);
    const displayAnt = sumNodeLeafs(node, valoresAntMap);
    const f = fmtVal(displayReal);
    const av = displayReal != null && faturamento ? ((Math.abs(displayReal) / Math.abs(faturamento)) * 100).toFixed(1) : null;
    const hasChildren = node.children.length > 0;
    const isCollapsedItem = collapsed.has(conta.id);

    return (
      <Fragment key={conta.id}>
        <tr style={{ background: '#E8EEF8', borderBottom: '1px solid #C4CFEA' }}>
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
          <td style={{ textAlign: 'right', padding: '10px 12px' }}>{renderDeltaMeta(displayReal, displayMeta, conta.tipo)}</td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '10px 12px', borderLeft: '1px solid #DDE4F0' }}>
            {displayAnt != null ? fmtVal(displayAnt).text : '—'}
          </td>
          <td style={{ textAlign: 'right', padding: '10px 12px' }}>{renderDeltaAnt(displayReal, displayAnt, conta.tipo)}</td>
        </tr>
        {!isCollapsedItem && node.children.map(child =>
          child.conta.nivel === 1 ? renderSubgrupo(child) : renderCategoria(child)
        )}
      </Fragment>
    );
  };

  const renderTotalizador = (key: string) => {
    const config = TOTALIZADOR_CONFIG[key];
    const realVal = totais[key as keyof typeof totais];
    const metaVal = totaisMeta[key as keyof typeof totaisMeta];
    const antVal = totaisAnt[key as keyof typeof totaisAnt];
    const f = fmtIndicadorVal(realVal);
    const av = faturamento ? ((realVal / faturamento) * 100).toFixed(1) : null;
    const avMeta = faturamentoMeta ? ((metaVal / faturamentoMeta) * 100).toFixed(1) : null;
    const avAnt = faturamentoAnt ? ((antVal / faturamentoAnt) * 100).toFixed(1) : null;

    return (
      <Fragment key={key}>
        <tr style={{ background: '#0D1B35', height: 40 }}>
          <td style={stickyTd('#0D1B35', { padding: '11px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', borderRightColor: '#2A3A5C' })}>
            <span className="flex items-center gap-2">
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: config.dotColor, flexShrink: 0 }} />
              {config.nome}
            </span>
          </td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: f.color, padding: '11px 12px' }}>{f.text}</td>
          <td style={{ textAlign: 'right', padding: '11px 6px' }}>
            {av != null && <span style={{ color: config.dotColor, fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{av}%</span>}
          </td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#8A9BBC', padding: '11px 12px' }}>
            {metaVal !== 0 ? fmtIndicadorVal(metaVal).text : '—'}
          </td>
          <td style={{ textAlign: 'right', padding: '11px 12px' }}>
            {renderDeltaMeta(realVal, metaVal !== 0 ? metaVal : null)}
          </td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#8A9BBC', padding: '11px 12px', borderLeft: '1px solid #2A3A5C' }}>
            {hasAnterior ? fmtIndicadorVal(antVal).text : '—'}
          </td>
          <td style={{ textAlign: 'right', padding: '11px 12px' }}>
            {hasAnterior ? renderDeltaAnt(realVal, antVal) : <span style={{ color: '#C4CFEA' }}>—</span>}
          </td>
        </tr>
        <tr style={{ background: '#1A3CFF0F' }}>
          <td style={stickyTd('#F5F7FF', { padding: '6px 12px 6px 24px', fontSize: 11, color: '#1A3CFF', fontStyle: 'italic' })}>
            % sobre Faturamento
          </td>
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#1A3CFF', padding: '6px 12px' }}>
            {av != null ? `${av} %` : '—'}
          </td>
          <td />
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#8A9BBC', padding: '6px 12px' }}>
            {avMeta ? `${avMeta} %` : '—'}
          </td>
          <td />
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#8A9BBC', padding: '6px 12px', borderLeft: '1px solid #DDE4F0' }}>
            {avAnt ? `${avAnt} %` : '—'}
          </td>
          <td />
        </tr>
      </Fragment>
    );
  };

  // ══════════════════════════════════════════════════════════════
  return (
    <div className="space-y-4">
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

      {hasContas && hasValores && (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: '#DDE4F0', background: '#FAFCFF' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
            <thead>
              <tr style={{ background: '#F0F4FA', borderBottom: '2px solid #DDE4F0' }}>
                <th style={{ ...stickyTd('#F0F4FA', { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em' }), width: 280 }}>
                  CONTA DRE
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 110 }}>REALIZADO</th>
                <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 10, fontWeight: 400, color: '#8A9BBC', fontStyle: 'italic', width: 70 }}>AV%</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 110 }}>META</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 100 }}>Δ VS META</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 110, borderLeft: '1px solid #DDE4F0' }}>MÊS ANT.</th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', width: 90 }}>Δ VS ANT.</th>
              </tr>
            </thead>
            <tbody>
              {SEQUENCIA_DRE.map(({ tipo, totalizadorApos }) => (
                <Fragment key={tipo}>
                  {(gruposPorTipo[tipo] || []).map(grupo => renderGrupo(grupo))}
                  {totalizadorApos && renderTotalizador(totalizadorApos)}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
