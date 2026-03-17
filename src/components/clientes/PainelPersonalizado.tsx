import { useState, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  DragOverlay, type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatCurrency } from '@/lib/plano-contas-utils';

/* ─── types ─── */
interface Widget {
  id: string;
  cliente_id: string;
  titulo: string;
  tipo: string;
  conta_ids: string[];
  meta_valor: number | null;
  meta_direcao: string;
  cor_destaque: string;
  colunas: number;
  ordem: number;
  ativo: boolean;
}

interface Conta {
  id: string;
  nome: string;
  tipo: string;
  nivel: number;
  ordem: number;
}

interface Props {
  clienteId: string;
  competencia?: string;
}

const TIPO_OPTIONS = [
  { value: 'card_resumo', icon: '📊', color: '#1A3CFF', title: 'Card Resumo', desc: 'Soma de contas' },
  { value: 'comparativo', icon: '⚖️', color: '#00A86B', title: 'Comparativo', desc: 'Mês atual vs ant.' },
  { value: 'grafico_barras', icon: '📶', color: '#DC2626', title: 'Gráfico Barras', desc: 'Evolução mensal' },
  { value: 'grafico_pizza', icon: '🍕', color: '#0099E6', title: 'Pizza', desc: 'Composição grupo' },
  { value: 'indicador', icon: '🎯', color: '#D97706', title: 'Indicador', desc: 'Valor com semáforo' },
  { value: 'cruzamento', icon: '🔗', color: '#8A9BBC', title: 'Cruzamento', desc: 'Relação entre contas' },
] as const;

const COLOR_SWATCHES = ['#1A3CFF', '#00A86B', '#D97706', '#0099E6', '#DC2626'];

function getDefaultCompetencia() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

function getPrevCompetencia(comp: string) {
  const d = new Date(comp + 'T00:00:00');
  d.setMonth(d.getMonth() - 1);
  d.setDate(1);
  return d.toISOString().split('T')[0];
}

function fmtComp(comp: string) {
  const d = new Date(comp + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase().replace('.', '');
}

/* ─── Sortable Widget Wrapper ─── */
function SortableWidget({ id, children, disabled }: { id: string; children: React.ReactNode; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
export function PainelPersonalizado({ clienteId, competencia }: Props) {
  const comp = competencia || getDefaultCompetencia();
  const prevComp = getPrevCompetencia(comp);
  const queryClient = useQueryClient();
  const [modoEdicao, setModoEdicao] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);

  /* ─── Data fetching ─── */
  const { data: widgets = [], isLoading: loadingWidgets } = useQuery({
    queryKey: ['painel-widgets', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('painel_widgets' as any)
        .select('*')
        .eq('cliente_id', clienteId)
        .eq('ativo', true)
        .order('ordem', { ascending: true });
      if (error) throw error;
      return (data as any[]) as Widget[];
    },
  });

  const { data: contas = [] } = useQuery({
    queryKey: ['plano-contas-painel', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plano_de_contas')
        .select('id, nome, tipo, nivel, ordem')
        .eq('cliente_id', clienteId)
        .order('ordem', { ascending: true });
      if (error) throw error;
      return data as Conta[];
    },
  });

  const allContaIds = useMemo(() => {
    const ids = new Set<string>();
    widgets.forEach(w => w.conta_ids?.forEach(id => ids.add(id)));
    return Array.from(ids);
  }, [widgets]);

  const { data: valoresAtual = [] } = useQuery({
    queryKey: ['valores-painel', clienteId, comp, allContaIds],
    queryFn: async () => {
      if (!allContaIds.length) return [];
      const { data, error } = await supabase
        .from('valores_mensais')
        .select('conta_id, valor_realizado')
        .eq('competencia', comp)
        .in('conta_id', allContaIds);
      if (error) throw error;
      return data as { conta_id: string; valor_realizado: number | null }[];
    },
    enabled: allContaIds.length > 0,
  });

  const { data: valoresPrev = [] } = useQuery({
    queryKey: ['valores-painel-prev', clienteId, prevComp, allContaIds],
    queryFn: async () => {
      if (!allContaIds.length) return [];
      const { data, error } = await supabase
        .from('valores_mensais')
        .select('conta_id, valor_realizado')
        .eq('competencia', prevComp)
        .in('conta_id', allContaIds);
      if (error) throw error;
      return data as { conta_id: string; valor_realizado: number | null }[];
    },
    enabled: allContaIds.length > 0,
  });

  const valMapAtual = useMemo(() => {
    const m: Record<string, number> = {};
    valoresAtual.forEach(v => { if (v.valor_realizado != null) m[v.conta_id] = v.valor_realizado; });
    return m;
  }, [valoresAtual]);

  const valMapPrev = useMemo(() => {
    const m: Record<string, number> = {};
    valoresPrev.forEach(v => { if (v.valor_realizado != null) m[v.conta_id] = v.valor_realizado; });
    return m;
  }, [valoresPrev]);

  const contaMap = useMemo(() => {
    const m: Record<string, Conta> = {};
    contas.forEach(c => { m[c.id] = c; });
    return m;
  }, [contas]);

  /* ─── Mutations ─── */
  const updateWidget = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, any> }) => {
      const { error } = await supabase.from('painel_widgets' as any).update({ ...updates, updated_at: new Date().toISOString() } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['painel-widgets', clienteId] }),
  });

  const deleteWidget = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('painel_widgets' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['painel-widgets', clienteId] });
      toast({ title: 'Widget excluído' });
    },
  });

  /* ─── DnD ─── */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragStart = (e: DragStartEvent) => setDragActiveId(String(e.active.id));

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    setDragActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = widgets.findIndex(w => w.id === active.id);
    const newIdx = widgets.findIndex(w => w.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const reordered = arrayMove(widgets, oldIdx, newIdx);
    reordered.forEach((w, i) => {
      if (w.ordem !== i) {
        supabase.from('painel_widgets' as any).update({ ordem: i, updated_at: new Date().toISOString() } as any).eq('id', w.id).then();
      }
    });
    queryClient.setQueryData(['painel-widgets', clienteId], reordered.map((w, i) => ({ ...w, ordem: i })));
  }, [widgets, clienteId, queryClient]);

  const draggedWidget = dragActiveId ? widgets.find(w => w.id === dragActiveId) : null;

  /* ─── Render ─── */
  if (loadingWidgets) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0D1B35' }}>Painel Personalizado</h3>
          <p style={{ fontSize: 11, color: '#8A9BBC' }}>Widgets exclusivos deste cliente. Outros clientes não são afetados.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border" style={{ borderColor: '#DDE4F0' }}>
            <button
              onClick={() => setModoEdicao(false)}
              className="px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                borderRadius: '5px 0 0 5px',
                background: !modoEdicao ? '#1A3CFF' : '#F0F4FA',
                color: !modoEdicao ? '#fff' : '#4A5E80',
              }}
            >
              Visualizar
            </button>
            <button
              onClick={() => setModoEdicao(true)}
              className="px-3 py-1.5 text-xs font-semibold transition-colors"
              style={{
                borderRadius: '0 5px 5px 0',
                background: modoEdicao ? '#1A3CFF' : '#F0F4FA',
                color: modoEdicao ? '#fff' : '#4A5E80',
              }}
            >
              Editar layout
            </button>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="px-3 py-1.5 text-xs font-semibold text-white rounded-md transition-colors hover:opacity-90"
            style={{ background: '#1A3CFF' }}
          >
            + Novo widget
          </button>
        </div>
      </div>

      {/* Grid */}
      {widgets.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center text-center"
          style={{
            background: '#F6F9FF', border: '1.5px dashed #C4CFEA', borderRadius: 12, padding: 40,
          }}
        >
          <span style={{ fontSize: 32 }}>📊</span>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#0D1B35', marginTop: 8 }}>Este cliente ainda não tem widgets configurados</p>
          <p style={{ fontSize: 12, color: '#8A9BBC', marginTop: 4 }}>Clique em '+ Novo widget' para criar o primeiro.</p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <SortableContext items={widgets.map(w => w.id)} strategy={rectSortingStrategy} disabled={!modoEdicao}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              {widgets.map(w => (
                <SortableWidget key={w.id} id={w.id} disabled={!modoEdicao}>
                  <div style={{ gridColumn: `span ${w.colunas}` }}>
                    <WidgetCard
                      widget={w}
                      valMapAtual={valMapAtual}
                      valMapPrev={valMapPrev}
                      contaMap={contaMap}
                      comp={comp}
                      prevComp={prevComp}
                      modoEdicao={modoEdicao}
                      onResize={(cols) => updateWidget.mutate({ id: w.id, updates: { colunas: cols } })}
                      onDelete={() => {
                        if (window.confirm('Excluir este widget?')) deleteWidget.mutate(w.id);
                      }}
                    />
                  </div>
                </SortableWidget>
              ))}
            </div>
          </SortableContext>
          <DragOverlay>
            {draggedWidget && (
              <div style={{ opacity: 0.7, borderRadius: 12, border: '1.5px dashed #1A3CFF', background: '#fff', padding: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 700 }}>{draggedWidget.titulo}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}

      {/* Create modal */}
      {modalOpen && (
        <CreateWidgetModal
          clienteId={clienteId}
          contas={contas.filter(c => c.nivel >= 1)}
          maxOrdem={widgets.length ? Math.max(...widgets.map(w => w.ordem)) : -1}
          onClose={() => setModalOpen(false)}
          onCreated={() => {
            queryClient.invalidateQueries({ queryKey: ['painel-widgets', clienteId] });
            setModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

/* ─── Widget Card ─── */
function WidgetCard({
  widget, valMapAtual, valMapPrev, contaMap, comp, prevComp, modoEdicao, onResize, onDelete,
}: {
  widget: Widget;
  valMapAtual: Record<string, number>;
  valMapPrev: Record<string, number>;
  contaMap: Record<string, Conta>;
  comp: string;
  prevComp: string;
  modoEdicao: boolean;
  onResize: (n: number) => void;
  onDelete: () => void;
}) {
  const isImplemented = widget.tipo === 'card_resumo' || widget.tipo === 'comparativo';

  const somaAtual = (widget.conta_ids || []).reduce((s, id) => s + (valMapAtual[id] || 0), 0);
  const somaPrev = (widget.conta_ids || []).reduce((s, id) => s + (valMapPrev[id] || 0), 0);
  const hasPrev = (widget.conta_ids || []).some(id => valMapPrev[id] != null);
  const delta = somaPrev !== 0 ? ((somaAtual - somaPrev) / Math.abs(somaPrev)) * 100 : null;

  return (
    <div
      style={{
        borderRadius: 12,
        border: modoEdicao ? '1.5px dashed #C4CFEA' : '1px solid #DDE4F0',
        background: '#FFFFFF',
        overflow: 'hidden',
        transition: 'border-color 0.15s, box-shadow 0.15s',
      }}
      className={!modoEdicao ? 'hover:shadow-[0_2px_8px_rgba(13,27,53,0.06)]' : 'hover:!border-[#1A3CFF]'}
    >
      {/* Edit controls */}
      {modoEdicao && (
        <div className="flex items-center justify-between px-3 pt-2">
          <span style={{ fontSize: 14, color: '#8A9BBC', cursor: 'grab' }}>⠿</span>
          <div className="flex items-center gap-1">
            {[1, 2, 3].map(n => (
              <button
                key={n}
                onClick={() => onResize(n)}
                style={{
                  width: 20, height: 20, borderRadius: 4, fontSize: 9, fontWeight: 700,
                  background: widget.colunas === n ? '#1A3CFF' : '#F0F4FA',
                  border: `1px solid ${widget.colunas === n ? '#1A3CFF' : '#DDE4F0'}`,
                  color: widget.colunas === n ? '#fff' : '#4A5E80',
                }}
              >
                {n === 1 ? 'P' : n === 2 ? 'M' : 'G'}
              </button>
            ))}
            <button
              onClick={onDelete}
              style={{
                width: 20, height: 20, borderRadius: 4, fontSize: 13, fontWeight: 700,
                background: '#fef2f2', border: '1px solid #fca5a5', color: '#DC2626',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      <div className="p-3.5">
        {!isImplemented ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold" style={{ background: '#F0F4FA', color: '#8A9BBC' }}>Em breve</span>
            <p style={{ fontSize: 11, color: '#8A9BBC', marginTop: 6 }}>{widget.titulo}</p>
          </div>
        ) : widget.tipo === 'card_resumo' ? (
          <CardResumoBody widget={widget} somaAtual={somaAtual} contaMap={contaMap} valMapAtual={valMapAtual} delta={delta} hasPrev={hasPrev} comp={comp} />
        ) : (
          <ComparativoBody widget={widget} somaAtual={somaAtual} somaPrev={somaPrev} contaMap={contaMap} delta={delta} hasPrev={hasPrev} comp={comp} prevComp={prevComp} />
        )}
      </div>
    </div>
  );
}

/* ─── card_resumo body ─── */
function CardResumoBody({ widget, somaAtual, contaMap, valMapAtual, delta, hasPrev, comp }: {
  widget: Widget; somaAtual: number; contaMap: Record<string, Conta>;
  valMapAtual: Record<string, number>; delta: number | null; hasPrev: boolean; comp: string;
}) {
  const items = (widget.conta_ids || [])
    .map(id => ({ id, nome: contaMap[id]?.nome || id.slice(0, 8), valor: valMapAtual[id] || 0 }))
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));

  const top5 = items.slice(0, 5);
  const others = items.slice(5);
  if (others.length) top5.push({ id: '__others', nome: 'Outros', valor: others.reduce((s, i) => s + i.valor, 0) });
  const maxAbs = Math.max(...top5.map(i => Math.abs(i.valor)), 1);

  return (
    <>
      <div className="flex items-center gap-2 mb-2">
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: `${widget.cor_destaque}18`, color: widget.cor_destaque, padding: '2px 6px', borderRadius: 4 }}>CARD</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0D1B35' }}>{widget.titulo}</span>
      </div>
      <p style={{ fontFamily: 'Courier New, monospace', fontSize: 24, fontWeight: 700, color: widget.cor_destaque }}>
        {formatCurrency(somaAtual)}
      </p>
      <div className="mt-3 space-y-1.5">
        {top5.map((item, i) => (
          <div key={item.id} className="flex items-center gap-2">
            <span style={{ fontSize: 10, color: '#4A5E80', width: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.nome.length > 12 ? item.nome.slice(0, 12) + '…' : item.nome}
            </span>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#F0F4FA', overflow: 'hidden' }}>
              <div style={{
                width: `${(Math.abs(item.valor) / maxAbs) * 100}%`,
                height: '100%', borderRadius: 3,
                background: widget.cor_destaque,
                opacity: 1 - i * 0.12,
                transition: 'width 0.8s ease',
              }} />
            </div>
            <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9.5, color: '#4A5E80', minWidth: 70, textAlign: 'right' }}>
              {formatCurrency(item.valor)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2" style={{ fontSize: 10, color: '#8A9BBC' }}>
        <span>{fmtComp(comp)}</span>
        {delta != null && hasPrev ? (
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4,
            background: delta >= 0 ? 'rgba(0,168,107,0.1)' : 'rgba(220,38,38,0.1)',
            color: delta >= 0 ? '#00A86B' : '#DC2626',
          }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
        ) : (
          <span style={{ fontSize: 10, color: '#C4CFEA' }}>sem dados</span>
        )}
      </div>
    </>
  );
}

/* ─── comparativo body ─── */
function ComparativoBody({ widget, somaAtual, somaPrev, contaMap, delta, hasPrev, comp, prevComp }: {
  widget: Widget; somaAtual: number; somaPrev: number;
  contaMap: Record<string, Conta>; delta: number | null; hasPrev: boolean; comp: string; prevComp: string;
}) {
  const contaTipo = contaMap[(widget.conta_ids || [])[0]]?.tipo || '';
  const isReceita = contaTipo === 'receita';
  const melhora = isReceita ? somaAtual > somaPrev : somaAtual < somaPrev;
  const corAtual = hasPrev ? (melhora ? '#00A86B' : '#DC2626') : '#4A5E80';
  const diff = somaAtual - somaPrev;

  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: `${widget.cor_destaque}18`, color: widget.cor_destaque, padding: '2px 6px', borderRadius: 4 }}>COMP.</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0D1B35' }}>{widget.titulo}</span>
      </div>
      <div className="flex">
        <div className="flex-1 pr-3">
          <p style={{ fontSize: 10, color: '#8A9BBC', marginBottom: 2 }}>{fmtComp(prevComp)}</p>
          <p style={{ fontFamily: 'Courier New, monospace', fontSize: 17, fontWeight: 700, color: '#4A5E80' }}>
            {hasPrev ? formatCurrency(somaPrev) : '—'}
          </p>
        </div>
        <div style={{ width: 1, background: '#DDE4F0' }} />
        <div className="flex-1 pl-3">
          <p style={{ fontSize: 10, color: '#8A9BBC', marginBottom: 2 }}>{fmtComp(comp)}</p>
          <p style={{ fontFamily: 'Courier New, monospace', fontSize: 17, fontWeight: 700, color: corAtual }}>
            {formatCurrency(somaAtual)}
          </p>
          {delta != null && hasPrev && (
            <span style={{ fontSize: 10, fontWeight: 600, color: corAtual }}>
              ({delta >= 0 ? '+' : ''}{delta.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>
      {hasPrev && Math.abs(delta || 0) > 5 && (
        <div style={{
          margin: '10px 0 0', padding: '6px 10px', borderRadius: 6, borderLeft: `2px solid ${corAtual}`,
          background: melhora ? 'rgba(0,168,107,0.05)' : 'rgba(220,38,38,0.05)', fontSize: 10, color: corAtual,
        }}>
          {diff >= 0 ? '+' : '−'}R$ {Math.abs(diff).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} vs. mês anterior
        </div>
      )}
    </>
  );
}

/* ─── Create Widget Modal ─── */
function CreateWidgetModal({ clienteId, contas, maxOrdem, onClose, onCreated }: {
  clienteId: string; contas: Conta[]; maxOrdem: number; onClose: () => void; onCreated: () => void;
}) {
  const [step, setStep] = useState(1);
  const [tipo, setTipo] = useState('');
  const [titulo, setTitulo] = useState('');
  const [selectedContas, setSelectedContas] = useState<string[]>([]);
  const [colunas, setColunas] = useState(1);
  const [corDestaque, setCorDestaque] = useState('#1A3CFF');
  const [saving, setSaving] = useState(false);
  const [buscaConta, setBuscaConta] = useState('');

  const TIPO_CORES: Record<string, string> = { receita: '#1A3CFF', custo_variavel: '#DC2626', despesa_fixa: '#D97706', investimento: '#0099E6', financiamento: '#00A86B' };

  const allContas = contas; // includes nivel 0,1,2
  const grupos = useMemo(() => allContas.filter(c => c.nivel === 0), [allContas]);

  const contasFiltradas = useMemo(() => {
    if (!buscaConta.trim()) return null; // null = show hierarchy
    const term = buscaConta.toLowerCase();
    return allContas.filter(c => c.nivel >= 1 && c.nome.toLowerCase().includes(term));
  }, [buscaConta, allContas]);

  const contasByParent = useMemo(() => {
    const map: Record<string, Conta[]> = {};
    allContas.filter(c => c.nivel >= 1).forEach(c => {
      // find parent grupo
      const parentGrupo = grupos.find(g => {
        const gIdx = allContas.indexOf(g);
        const nextGrupo = grupos.find((g2, i2) => allContas.indexOf(g2) > gIdx && i2 > grupos.indexOf(g));
        const nextIdx = nextGrupo ? allContas.indexOf(nextGrupo) : allContas.length;
        const cIdx = allContas.indexOf(c);
        return cIdx > gIdx && cIdx < nextIdx;
      });
      const key = parentGrupo?.id || '__none';
      if (!map[key]) map[key] = [];
      map[key].push(c);
    });
    return map;
  }, [allContas, grupos]);

  const handleCreate = async () => {
    if (!titulo.trim() || !selectedContas.length) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('painel_widgets' as any).insert({
        cliente_id: clienteId,
        titulo: titulo.trim(),
        tipo,
        conta_ids: selectedContas,
        cor_destaque: corDestaque,
        colunas,
        ordem: maxOrdem + 1,
      } as any);
      if (error) throw error;
      toast({ title: 'Widget criado!' });
      onCreated();
    } catch {
      toast({ title: 'Erro ao criar widget', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(13,27,53,0.45)' }} />
      <div
        style={{
          position: 'relative', borderRadius: 16, background: '#fff', width: '100%', maxWidth: 560,
          maxHeight: '88vh', overflow: 'auto', animation: 'modalEnter 0.22s cubic-bezier(0.16,1,0.3,1)',
        }}
      >
        <div className="p-6">
          {step === 1 ? (
            <>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0D1B35', marginBottom: 4 }}>Novo Widget</h3>
              <p style={{ fontSize: 11, color: '#8A9BBC', marginBottom: 16 }}>Escolha o tipo de widget</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {TIPO_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setTipo(opt.value)}
                    style={{
                      padding: 14, borderRadius: 10, textAlign: 'center', cursor: 'pointer',
                      border: `1.5px solid ${tipo === opt.value ? '#1A3CFF' : '#DDE4F0'}`,
                      background: tipo === opt.value ? 'rgba(26,60,255,0.07)' : '#fff',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{ fontSize: 28, display: 'block' }}>{opt.icon}</span>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#0D1B35', marginTop: 6 }}>{opt.title}</p>
                    <p style={{ fontSize: 10, color: '#8A9BBC', marginTop: 2 }}>{opt.desc}</p>
                  </button>
                ))}
              </div>
              <div className="flex justify-end mt-5">
                <button
                  disabled={!tipo}
                  onClick={() => setStep(2)}
                  style={{
                    padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: '#1A3CFF', color: '#fff', opacity: tipo ? 1 : 0.45,
                    cursor: tipo ? 'pointer' : 'default',
                  }}
                >
                  Próximo
                </button>
              </div>
            </>
          ) : (
            <>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0D1B35', marginBottom: 16 }}>Configurar Widget</h3>

              {/* Title */}
              <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Título do widget *</label>
              <input
                value={titulo}
                onChange={e => setTitulo(e.target.value)}
                placeholder="Ex: Custos Operacionais"
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDE4F0',
                  fontSize: 13, color: '#0D1B35', marginBottom: 14, outline: 'none',
                }}
              />

              {/* Contas */}
              <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Contas incluídas *</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {selectedContas.map(id => {
                  const c = contas.find(x => x.id === id);
                  return (
                    <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#F0F4FA', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: '#0D1B35' }}>
                      {c?.nome || id.slice(0, 8)}
                      <button onClick={() => setSelectedContas(prev => prev.filter(x => x !== id))} style={{ fontSize: 13, color: '#8A9BBC', cursor: 'pointer' }}>×</button>
                    </span>
                  );
                })}
              </div>
              <button
                onClick={() => setShowContaPicker(!showContaPicker)}
                style={{ fontSize: 11, color: '#1A3CFF', fontWeight: 600, cursor: 'pointer', marginBottom: showContaPicker ? 6 : 14 }}
              >
                + Adicionar conta
              </button>
              {showContaPicker && (
                <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid #DDE4F0', borderRadius: 8, marginBottom: 14 }}>
                  {contas.filter(c => !selectedContas.includes(c.id)).map(c => (
                    <button
                      key={c.id}
                      onClick={() => { setSelectedContas(prev => [...prev, c.id]); }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[#F6F9FF] transition-colors"
                      style={{ fontSize: 11, color: '#0D1B35', borderBottom: '1px solid #F0F4FA' }}
                    >
                      <span style={{ color: '#8A9BBC', fontSize: 9, marginRight: 6 }}>{c.tipo}</span>
                      {c.nome}
                    </button>
                  ))}
                </div>
              )}

              {/* Size */}
              <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Tamanho</label>
              <select
                value={colunas}
                onChange={e => setColunas(Number(e.target.value))}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDE4F0', fontSize: 12, color: '#0D1B35', marginBottom: 14 }}
              >
                <option value={1}>Pequeno — 1 coluna</option>
                <option value={2}>Médio — 2 colunas</option>
                <option value={3}>Grande — 3 colunas</option>
              </select>

              {/* Color */}
              <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 6 }}>Cor de destaque</label>
              <div className="flex gap-2 mb-5">
                {COLOR_SWATCHES.map(c => (
                  <button
                    key={c}
                    onClick={() => setCorDestaque(c)}
                    style={{
                      width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer',
                      border: corDestaque === c ? '2px solid #0D1B35' : '2px solid transparent',
                      transition: 'border 0.15s',
                    }}
                  />
                ))}
              </div>

              {/* Buttons */}
              <div className="flex justify-between">
                <button onClick={() => setStep(1)} style={{ fontSize: 12, color: '#4A5E80', fontWeight: 600, cursor: 'pointer' }}>← Voltar</button>
                <button
                  disabled={!titulo.trim() || !selectedContas.length || saving}
                  onClick={handleCreate}
                  style={{
                    padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: '#1A3CFF', color: '#fff',
                    opacity: titulo.trim() && selectedContas.length ? 1 : 0.45,
                    cursor: titulo.trim() && selectedContas.length ? 'pointer' : 'default',
                  }}
                >
                  {saving ? 'Criando...' : 'Criar widget'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes modalEnter {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
