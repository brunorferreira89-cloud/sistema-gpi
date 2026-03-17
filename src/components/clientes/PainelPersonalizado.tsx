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
  conta_pai_id: string | null;
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

function getNextCompetencia(comp: string) {
  const d = new Date(comp + 'T00:00:00');
  d.setMonth(d.getMonth() + 1);
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
  const defaultComp = competencia || getDefaultCompetencia();
  const queryClient = useQueryClient();
  const [modoEdicao, setModoEdicao] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [mesesWidgets, setMesesWidgets] = useState<Record<string, string>>({});

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
        .select('id, nome, tipo, nivel, ordem, conta_pai_id')
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

  // Fetch ALL valores_mensais for the client's widget conta_ids (all months)
  const { data: allValores = [] } = useQuery({
    queryKey: ['valores-painel-all', clienteId, allContaIds],
    queryFn: async () => {
      if (!allContaIds.length) return [];
      const { data, error } = await supabase
        .from('valores_mensais')
        .select('conta_id, valor_realizado, competencia')
        .in('conta_id', allContaIds);
      if (error) throw error;
      return data as { conta_id: string; valor_realizado: number | null; competencia: string }[];
    },
    enabled: allContaIds.length > 0,
  });

  // Available competencias sorted ASC
  const availableComps = useMemo(() => {
    const set = new Set<string>();
    allValores.forEach(v => set.add(v.competencia));
    return Array.from(set).sort();
  }, [allValores]);

  // Build a map: `${conta_id}__${competencia}` → valor_realizado
  const valMap = useMemo(() => {
    const m: Record<string, number> = {};
    allValores.forEach(v => {
      if (v.valor_realizado != null) m[`${v.conta_id}__${v.competencia}`] = v.valor_realizado;
    });
    return m;
  }, [allValores]);

  const contaMap = useMemo(() => {
    const m: Record<string, Conta> = {};
    contas.forEach(c => { m[c.id] = c; });
    return m;
  }, [contas]);

  // Helper to get value map for a specific competencia
  const getValMapForComp = useCallback((comp: string) => {
    const m: Record<string, number> = {};
    allContaIds.forEach(id => {
      const key = `${id}__${comp}`;
      if (valMap[key] != null) m[id] = valMap[key];
    });
    return m;
  }, [valMap, allContaIds]);

  // Get per-widget competencia
  const getWidgetComp = useCallback((widgetId: string) => {
    return mesesWidgets[widgetId] || defaultComp;
  }, [mesesWidgets, defaultComp]);

  const setWidgetComp = useCallback((widgetId: string, comp: string) => {
    setMesesWidgets(prev => ({ ...prev, [widgetId]: comp }));
  }, []);

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
              {widgets.map(w => {
                const wComp = getWidgetComp(w.id);
                const wPrev = getPrevCompetencia(wComp);
                const valAtual = getValMapForComp(wComp);
                const valPrev = getValMapForComp(wPrev);
                return (
                  <SortableWidget key={w.id} id={w.id} disabled={!modoEdicao}>
                    <div style={{ gridColumn: `span ${w.colunas}` }}>
                      <WidgetCard
                        widget={w}
                        valMapAtual={valAtual}
                        valMapPrev={valPrev}
                        contaMap={contaMap}
                        comp={wComp}
                        prevComp={wPrev}
                        modoEdicao={modoEdicao}
                        availableComps={availableComps}
                        onCompChange={(c) => setWidgetComp(w.id, c)}
                        onResize={(cols) => updateWidget.mutate({ id: w.id, updates: { colunas: cols } })}
                        onDelete={() => {
                          if (window.confirm('Excluir este widget?')) deleteWidget.mutate(w.id);
                        }}
                        onEdit={() => setEditingWidget(w)}
                      />
                    </div>
                  </SortableWidget>
                );
              })}
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
        <WidgetModal
          mode="create"
          clienteId={clienteId}
          contas={contas}
          maxOrdem={widgets.length ? Math.max(...widgets.map(w => w.ordem)) : -1}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['painel-widgets', clienteId] });
            setModalOpen(false);
          }}
        />
      )}

      {/* Edit modal */}
      {editingWidget && (
        <WidgetModal
          mode="edit"
          widget={editingWidget}
          clienteId={clienteId}
          contas={contas}
          maxOrdem={0}
          onClose={() => setEditingWidget(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['painel-widgets', clienteId] });
            setEditingWidget(null);
          }}
        />
      )}
    </div>
  );
}

/* ─── Month Nav ─── */
function MonthNav({ comp, availableComps, onChange }: { comp: string; availableComps: string[]; onChange: (c: string) => void }) {
  const idx = availableComps.indexOf(comp);
  const canPrev = idx > 0;
  const canNext = idx < availableComps.length - 1 && idx >= 0;

  return (
    <div className="flex items-center gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); if (canPrev) onChange(availableComps[idx - 1]); }}
        style={{
          width: 18, height: 18, borderRadius: 4, border: 'none', background: 'transparent',
          color: '#8A9BBC', fontSize: 11, cursor: canPrev ? 'pointer' : 'default',
          opacity: canPrev ? 1 : 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { if (canPrev) (e.currentTarget as HTMLElement).style.color = '#1A3CFF'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#8A9BBC'; }}
      >
        ←
      </button>
      <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10.5, fontWeight: 700, color: '#4A5E80', minWidth: 68, textAlign: 'center' }}>
        {fmtComp(comp)}
      </span>
      <button
        onClick={(e) => { e.stopPropagation(); if (canNext) onChange(availableComps[idx + 1]); }}
        style={{
          width: 18, height: 18, borderRadius: 4, border: 'none', background: 'transparent',
          color: '#8A9BBC', fontSize: 11, cursor: canNext ? 'pointer' : 'default',
          opacity: canNext ? 1 : 0.3, display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => { if (canNext) (e.currentTarget as HTMLElement).style.color = '#1A3CFF'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#8A9BBC'; }}
      >
        →
      </button>
    </div>
  );
}

/* ─── Widget Card ─── */
function WidgetCard({
  widget, valMapAtual, valMapPrev, contaMap, comp, prevComp, modoEdicao,
  availableComps, onCompChange, onResize, onDelete, onEdit,
}: {
  widget: Widget;
  valMapAtual: Record<string, number>;
  valMapPrev: Record<string, number>;
  contaMap: Record<string, Conta>;
  comp: string;
  prevComp: string;
  modoEdicao: boolean;
  availableComps: string[];
  onCompChange: (c: string) => void;
  onResize: (n: number) => void;
  onDelete: () => void;
  onEdit: () => void;
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
            <button
              onClick={onEdit}
              style={{
                width: 20, height: 20, borderRadius: 4, fontSize: 11,
                background: '#F0F4FF', border: '1px solid rgba(26,60,255,0.25)', color: '#1A3CFF',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(26,60,255,0.12)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#F0F4FF'; }}
            >
              ✎
            </button>
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
          <CardResumoBody widget={widget} somaAtual={somaAtual} contaMap={contaMap} valMapAtual={valMapAtual} delta={delta} hasPrev={hasPrev} comp={comp} availableComps={availableComps} onCompChange={onCompChange} />
        ) : (
          <ComparativoBody widget={widget} somaAtual={somaAtual} somaPrev={somaPrev} contaMap={contaMap} delta={delta} hasPrev={hasPrev} comp={comp} prevComp={prevComp} availableComps={availableComps} onCompChange={onCompChange} />
        )}
      </div>
    </div>
  );
}

/* ─── card_resumo body ─── */
function CardResumoBody({ widget, somaAtual, contaMap, valMapAtual, delta, hasPrev, comp, availableComps, onCompChange }: {
  widget: Widget; somaAtual: number; contaMap: Record<string, Conta>;
  valMapAtual: Record<string, number>; delta: number | null; hasPrev: boolean; comp: string;
  availableComps: string[]; onCompChange: (c: string) => void;
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
        <MonthNav comp={comp} availableComps={availableComps} onChange={onCompChange} />
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
function ComparativoBody({ widget, somaAtual, somaPrev, contaMap, delta, hasPrev, comp, prevComp, availableComps, onCompChange }: {
  widget: Widget; somaAtual: number; somaPrev: number;
  contaMap: Record<string, Conta>; delta: number | null; hasPrev: boolean; comp: string; prevComp: string;
  availableComps: string[]; onCompChange: (c: string) => void;
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
      <div className="mt-3 flex items-center gap-2">
        <MonthNav comp={comp} availableComps={availableComps} onChange={onCompChange} />
      </div>
    </>
  );
}

/* ─── Widget Modal (Create + Edit) ─── */
function WidgetModal({ mode, widget, clienteId, contas, maxOrdem, onClose, onSaved }: {
  mode: 'create' | 'edit';
  widget?: Widget;
  clienteId: string;
  contas: Conta[];
  maxOrdem: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = mode === 'edit';
  const [step, setStep] = useState(isEdit ? 2 : 1);
  const [tipo, setTipo] = useState(isEdit ? widget!.tipo : '');
  const [titulo, setTitulo] = useState(isEdit ? widget!.titulo : '');
  const [selectedContas, setSelectedContas] = useState<string[]>(isEdit ? (widget!.conta_ids || []) : []);
  const [colunas, setColunas] = useState(isEdit ? widget!.colunas : 1);
  const [corDestaque, setCorDestaque] = useState(isEdit ? widget!.cor_destaque : '#1A3CFF');
  const [saving, setSaving] = useState(false);
  const [buscaConta, setBuscaConta] = useState('');

  const TIPO_CORES: Record<string, string> = { receita: '#1A3CFF', custo_variavel: '#DC2626', despesa_fixa: '#D97706', investimento: '#0099E6', financiamento: '#00A86B' };

  const allContas = contas;
  const grupos = useMemo(() => allContas.filter(c => c.nivel === 0), [allContas]);

  const contasFiltradas = useMemo(() => {
    if (!buscaConta.trim()) return null;
    const term = buscaConta.toLowerCase();
    return allContas.filter(c => c.nivel >= 1 && c.nome.toLowerCase().includes(term));
  }, [buscaConta, allContas]);

  const contasByParent = useMemo(() => {
    const map: Record<string, Conta[]> = {};
    let currentGrupoId = '__none';
    allContas.forEach(c => {
      if (c.nivel === 0) {
        currentGrupoId = c.id;
        if (!map[currentGrupoId]) map[currentGrupoId] = [];
      } else {
        if (!map[currentGrupoId]) map[currentGrupoId] = [];
        map[currentGrupoId].push(c);
      }
    });
    return map;
  }, [allContas]);

  const handleSave = async () => {
    if (!titulo.trim() || !selectedContas.length) return;
    setSaving(true);
    try {
      if (isEdit && widget) {
        const { error } = await supabase.from('painel_widgets' as any).update({
          titulo: titulo.trim(),
          conta_ids: selectedContas,
          colunas,
          cor_destaque: corDestaque,
          updated_at: new Date().toISOString(),
        } as any).eq('id', widget.id);
        if (error) throw error;
        toast({ title: 'Widget atualizado com sucesso' });
      } else {
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
      }
      onSaved();
    } catch {
      toast({ title: isEdit ? 'Erro ao atualizar widget' : 'Erro ao criar widget', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const tipoLabel = TIPO_OPTIONS.find(t => t.value === tipo)?.title || tipo;

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
              <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0D1B35', marginBottom: 4 }}>
                {isEdit ? 'Editar Widget' : 'Configurar Widget'}
              </h3>
              {isEdit && (
                <span style={{
                  display: 'inline-block', fontSize: 9, fontWeight: 700, textTransform: 'uppercase',
                  background: 'rgba(26,60,255,0.07)', color: '#1A3CFF',
                  padding: '3px 8px', borderRadius: 4, marginBottom: 12,
                }}>
                  {tipoLabel}
                </span>
              )}
              {!isEdit && <div style={{ marginBottom: 12 }} />}

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

              {/* Contas incluídas */}
              <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Contas incluídas *</label>

              {/* 1. Chips */}
              <div className="flex flex-wrap gap-1.5 mb-2" style={{ minHeight: 24 }}>
                {selectedContas.length === 0 ? (
                  <span style={{ fontSize: 10, color: '#8A9BBC' }}>Nenhuma conta selecionada ainda</span>
                ) : selectedContas.map(id => {
                  const c = allContas.find(x => x.id === id);
                  const nome = c?.nome || id.slice(0, 8);
                  return (
                    <span key={id} style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: 'rgba(26,60,255,0.07)', border: '1px solid rgba(26,60,255,0.2)',
                      borderRadius: 6, padding: '3px 9px', fontSize: 10, fontWeight: 700, color: '#1A3CFF',
                    }}>
                      {nome.length > 22 ? nome.slice(0, 22) + '…' : nome}
                      <button onClick={() => setSelectedContas(prev => prev.filter(x => x !== id))} style={{ fontSize: 13, color: '#1A3CFF', cursor: 'pointer', lineHeight: 1 }}>×</button>
                    </span>
                  );
                })}
              </div>

              {/* 2. Search input */}
              <div style={{ position: 'relative', marginBottom: 6 }}>
                <svg style={{ position: 'absolute', left: 10, top: 9, width: 14, height: 14, color: '#8A9BBC' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                <input
                  value={buscaConta}
                  onChange={e => setBuscaConta(e.target.value)}
                  placeholder="Buscar conta pelo nome..."
                  style={{
                    width: '100%', padding: '8px 12px 8px 32px', borderRadius: 8,
                    border: '1px solid #DDE4F0', fontSize: 12, color: '#0D1B35', outline: 'none',
                  }}
                />
              </div>

              {/* 3. Conta list */}
              <div style={{ border: '1px solid #DDE4F0', borderRadius: 8, maxHeight: 220, overflowY: 'auto', background: '#FAFCFF', marginBottom: 14 }}>
                {contasFiltradas !== null ? (
                  contasFiltradas.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: 16, fontSize: 12, color: '#8A9BBC' }}>Nenhuma conta encontrada</p>
                  ) : contasFiltradas.map(c => {
                    const sel = selectedContas.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => setSelectedContas(prev => sel ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                        className="w-full text-left flex items-center gap-2 transition-colors"
                        style={{
                          padding: '7px 12px', fontSize: 11, color: '#0D1B35',
                          background: sel ? 'rgba(26,60,255,0.06)' : 'transparent',
                          borderBottom: '1px solid #F0F4FA',
                        }}
                      >
                        <input type="checkbox" checked={sel} readOnly style={{ accentColor: '#1A3CFF', width: 13, height: 13 }} />
                        <span>{c.nome}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 7, background: c.nivel === 1 ? '#F0F4FA' : '#F6F9FF', color: c.nivel === 1 ? '#8A9BBC' : '#C4CFEA', padding: '1px 5px', borderRadius: 3 }}>
                          {c.nivel === 1 ? 'subgrupo' : 'categoria'}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  grupos.map((g, gi) => {
                    const children = contasByParent[g.id] || [];
                    return (
                      <div key={g.id}>
                        {gi > 0 && <div style={{ height: 1, background: '#DDE4F0' }} />}
                        <div style={{ background: '#E8EEF8', padding: '6px 12px' }}>
                          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#4A5E80', letterSpacing: '0.1em' }}>{g.nome}</span>
                        </div>
                        {children.map(c => {
                          const sel = selectedContas.includes(c.id);
                          const tipoCor = TIPO_CORES[c.tipo] || '#8A9BBC';
                          const isSubgrupo = c.nivel === 1;
                          return (
                            <button
                              key={c.id}
                              onClick={() => setSelectedContas(prev => sel ? prev.filter(x => x !== c.id) : [...prev, c.id])}
                              className="w-full text-left flex items-center gap-2 transition-colors"
                              style={{
                                padding: isSubgrupo ? '8px 12px 8px 20px' : '6px 12px 6px 36px',
                                background: sel ? (isSubgrupo ? 'rgba(26,60,255,0.06)' : 'rgba(26,60,255,0.04)') : 'transparent',
                              }}
                              onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = isSubgrupo ? 'rgba(26,60,255,0.04)' : 'rgba(26,60,255,0.03)'; }}
                              onMouseLeave={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                            >
                              <input type="checkbox" checked={sel} readOnly style={{ accentColor: '#1A3CFF', width: 13, height: 13 }} />
                              <span style={{
                                width: isSubgrupo ? 8 : 5, height: isSubgrupo ? 8 : 5,
                                borderRadius: isSubgrupo ? 2 : '50%', background: tipoCor, flexShrink: 0,
                              }} />
                              <span style={{ fontSize: isSubgrupo ? 12 : 11, fontWeight: isSubgrupo ? 600 : 400, color: isSubgrupo ? '#0D1B35' : '#4A5E80' }}>
                                {c.nome}
                              </span>
                              {isSubgrupo && (
                                <span style={{ marginLeft: 'auto', fontSize: 7, background: '#F0F4FA', color: '#8A9BBC', padding: '1px 5px', borderRadius: 3 }}>subgrupo</span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </div>

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
                {isEdit ? (
                  <button onClick={onClose} style={{ fontSize: 12, color: '#4A5E80', fontWeight: 600, cursor: 'pointer' }}>Cancelar</button>
                ) : (
                  <button onClick={() => setStep(1)} style={{ fontSize: 12, color: '#4A5E80', fontWeight: 600, cursor: 'pointer' }}>← Voltar</button>
                )}
                <button
                  disabled={!titulo.trim() || !selectedContas.length || saving}
                  onClick={handleSave}
                  style={{
                    padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                    background: '#1A3CFF', color: '#fff',
                    opacity: titulo.trim() && selectedContas.length ? 1 : 0.45,
                    cursor: titulo.trim() && selectedContas.length ? 'pointer' : 'default',
                  }}
                >
                  {saving ? (isEdit ? 'Salvando...' : 'Criando...') : (isEdit ? 'Salvar alterações' : 'Criar widget')}
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
