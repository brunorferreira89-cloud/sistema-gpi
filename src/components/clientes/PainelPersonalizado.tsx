import { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Skeleton } from '@/components/ui/skeleton';
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
  conta_ids_b: string[];
  meta_valor: number | null;
  meta_valor_b: number | null;
  meta_direcao: string;
  cor_destaque: string;
  colunas: number;
  ordem: number;
  ativo: boolean;
  periodo_meses: number;
  formato_resultado: string;
  analise_ia: string | null;
  analise_gerada_em: string | null;
  analise_hash: string | null;
  ocultar_zeros: boolean;
  ordenacao_lista: string;
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
  modoConfig?: boolean;
}

const TIPO_OPTIONS = [
  { value: 'card_resumo', icon: '📊', color: '#1A3CFF', title: 'Card Resumo', desc: 'Soma de contas', badge: 'CARD' },
  { value: 'comparativo', icon: '⚖️', color: '#00A86B', title: 'Comparativo', desc: 'Mês atual vs ant.', badge: 'COMP.' },
  { value: 'grafico_barras', icon: '📶', color: '#DC2626', title: 'Gráfico Barras', desc: 'Evolução mensal', badge: 'BARRAS' },
  { value: 'grafico_pizza', icon: '🍕', color: '#0099E6', title: 'Pizza', desc: 'Composição grupo', badge: 'PIZZA' },
  { value: 'indicador', icon: '🎯', color: '#D97706', title: 'Indicador', desc: 'Valor com semáforo', badge: 'INDIC.' },
  { value: 'cruzamento', icon: '🔗', color: '#8A9BBC', title: 'Cruzamento', desc: 'Relação entre contas', badge: 'CRUZAM.' },
  { value: 'detalhamento', icon: 'detail', color: '#4A5E80', title: 'Detalhamento', desc: 'Lista de categorias', badge: 'DETALHE' },
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

function getNPrevCompetencias(comp: string, n: number): string[] {
  const result: string[] = [];
  let c = comp;
  for (let i = 0; i < n; i++) {
    result.unshift(c);
    c = getPrevCompetencia(c);
  }
  return result;
}

function fmtComp(comp: string) {
  const d = new Date(comp + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase().replace('.', '');
}

function fmtCompShort(comp: string) {
  const d = new Date(comp + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase().replace('.', '');
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
export function PainelPersonalizado({ clienteId, competencia, modoConfig = false }: Props) {
  const defaultComp = competencia || getDefaultCompetencia();
  const queryClient = useQueryClient();
  const [modoEdicao, setModoEdicao] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingWidget, setEditingWidget] = useState<Widget | null>(null);
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [detalheWidget, setDetalheWidget] = useState<Widget | null>(null);

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
      return (data as any[]).map((w: any) => ({
        ...w,
        conta_ids: w.conta_ids || [],
        conta_ids_b: w.conta_ids_b || [],
        periodo_meses: w.periodo_meses || 6,
        formato_resultado: w.formato_resultado || 'percentual',
        ocultar_zeros: w.ocultar_zeros ?? true,
        ordenacao_lista: w.ordenacao_lista || 'maior_primeiro',
      })) as Widget[];
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
    widgets.forEach(w => {
      w.conta_ids?.forEach(id => ids.add(id));
      w.conta_ids_b?.forEach(id => ids.add(id));
    });
    return Array.from(ids);
  }, [widgets]);

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

  // Get receita total for AV%
  const receitaContas = useMemo(() => contas.filter(c => c.tipo === 'receita' && c.nivel === 0), [contas]);
  const receitaLeafIds = useMemo(() => {
    const ids: string[] = [];
    contas.forEach(c => {
      if (c.tipo === 'receita' && c.nivel >= 1) ids.push(c.id);
    });
    return ids;
  }, [contas]);

  const getFaturamento = useCallback((comp: string) => {
    return receitaLeafIds.reduce((s, id) => s + (valMap[`${id}__${comp}`] || 0), 0);
  }, [valMap, receitaLeafIds]);

  const getSoma = useCallback((ids: string[], comp: string) => {
    return ids.reduce((s, id) => s + (valMap[`${id}__${comp}`] || 0), 0);
  }, [valMap]);

  const hasDadosForComp = useCallback((ids: string[], comp: string) => {
    return ids.some(id => valMap[`${id}__${comp}`] != null);
  }, [valMap]);

  /* ─── Mutations ─── */
  const updateWidget = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Record<string, unknown> }) => {
      const { error } = await supabase
        .from('painel_widgets')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['painel-widgets', clienteId] });
    },
    onError: (error) => {
      queryClient.invalidateQueries({ queryKey: ['painel-widgets', clienteId] });
      toast({ title: 'Erro ao salvar', description: error.message, variant: 'destructive' });
    },
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

  /* ─── Semantic helpers ─── */
  const getContaTipoSemantico = useCallback((ids: string[]) => {
    if (!ids.length) return 'saida';
    return ids.every(id => contaMap[id]?.tipo === 'receita') ? 'receita' : 'saida';
  }, [contaMap]);

  const isMelhora = useCallback((tipoSem: string, delta: number) => {
    return tipoSem === 'receita' ? delta > 0 : delta < 0;
  }, []);

  /* ─── Render ─── */
  if (loadingWidgets) {
    return <div className="flex items-center justify-center py-12"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  const showControls = modoConfig;

  return (
    <div className="space-y-3">
      {/* Header - only in config mode */}
      {showControls && (
        <div className="flex items-center justify-between">
          <div />
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
      )}

      {/* Grid */}
      {widgets.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center text-center"
          style={{ background: '#F6F9FF', border: '1.5px dashed #C4CFEA', borderRadius: 12, padding: 40 }}
        >
          <span style={{ fontSize: 32 }}>📊</span>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#0D1B35', marginTop: 8 }}>
            {modoConfig ? 'Nenhum widget configurado' : 'Sem painéis personalizados'}
          </p>
          <p style={{ fontSize: 12, color: '#8A9BBC', marginTop: 4 }}>
            {modoConfig ? "Clique em '+ Novo widget' para criar o primeiro." : 'Configure widgets na aba Configuração.'}
          </p>
        </div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <SortableContext items={widgets.map(w => w.id)} strategy={rectSortingStrategy} disabled={!modoEdicao || !modoConfig}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              {widgets.map(w => {
                const wComp = defaultComp;
                const wPrev = getPrevCompetencia(wComp);
                return (
                  <SortableWidget key={w.id} id={w.id} disabled={!modoEdicao || !modoConfig}>
                    <div style={{ gridColumn: `span ${w.colunas}` }}>
                      <WidgetCard
                        widget={w}
                        comp={wComp}
                        prevComp={wPrev}
                        contaMap={contaMap}
                        getSoma={getSoma}
                        getFaturamento={getFaturamento}
                        hasDadosForComp={hasDadosForComp}
                        valMap={valMap}
                        getContaTipoSemantico={getContaTipoSemantico}
                        isMelhora={isMelhora}
                        modoEdicao={modoEdicao && modoConfig}
                        onResize={(cols) => {
                          queryClient.setQueryData(
                            ['painel-widgets', clienteId],
                            (old: any[]) => old?.map(widget =>
                              widget.id === w.id ? { ...widget, colunas: cols } : widget
                            ) ?? []
                          );
                          updateWidget.mutate({ id: w.id, updates: { colunas: cols } });
                        }}
                        onDelete={() => { if (window.confirm('Excluir este widget?')) deleteWidget.mutate(w.id); }}
                        onEdit={() => setEditingWidget(w)}
                        onClick={() => setDetalheWidget(w)}
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

      {/* Detail modal */}
      {detalheWidget && (
        <DetalheModal
          widget={detalheWidget}
          comp={defaultComp}
          contaMap={contaMap}
          getSoma={getSoma}
          getFaturamento={getFaturamento}
          valMap={valMap}
          getContaTipoSemantico={getContaTipoSemantico}
          onClose={() => setDetalheWidget(null)}
        />
      )}
    </div>
  );
}

/* ─── Widget Card ─── */
function WidgetCard({
  widget, comp, prevComp, contaMap, getSoma, getFaturamento, hasDadosForComp, valMap,
  getContaTipoSemantico, isMelhora, modoEdicao, onResize, onDelete, onEdit, onClick,
}: {
  widget: Widget;
  comp: string;
  prevComp: string;
  contaMap: Record<string, Conta>;
  getSoma: (ids: string[], comp: string) => number;
  getFaturamento: (comp: string) => number;
  hasDadosForComp: (ids: string[], comp: string) => boolean;
  valMap: Record<string, number>;
  getContaTipoSemantico: (ids: string[]) => string;
  isMelhora: (tipo: string, delta: number) => boolean;
  modoEdicao: boolean;
  onResize: (n: number) => void;
  onDelete: () => void;
  onEdit: () => void;
  onClick: () => void;
}) {
  const tipoOpt = TIPO_OPTIONS.find(t => t.value === widget.tipo);
  const badge = tipoOpt?.badge || widget.tipo.toUpperCase();

  const somaAtual = getSoma(widget.conta_ids, comp);
  const somaPrev = getSoma(widget.conta_ids, prevComp);
  const hasPrev = hasDadosForComp(widget.conta_ids, prevComp);
  const delta = somaPrev !== 0 ? ((somaAtual - somaPrev) / Math.abs(somaPrev)) * 100 : null;
  const tipoSem = getContaTipoSemantico(widget.conta_ids);
  const melhorou = delta != null ? isMelhora(tipoSem, somaAtual - somaPrev) : null;

  const fat = getFaturamento(comp);
  const avPct = fat ? (Math.abs(somaAtual) / Math.abs(fat)) * 100 : null;

  // Análise IA status
  const hasAnalise = !!widget.analise_ia;
  const hashChanged = hasAnalise && widget.analise_hash !== computeHash(widget, comp, valMap, contaMap, getSoma);

  return (
    <div
      onClick={modoEdicao ? undefined : onClick}
      style={{
        borderRadius: 12,
        border: modoEdicao ? '1.5px dashed #C4CFEA' : '1px solid #DDE4F0',
        background: '#FFFFFF',
        overflow: 'hidden',
        cursor: modoEdicao ? 'default' : 'pointer',
        transition: 'box-shadow 0.18s, border-color 0.18s',
      }}
      className={!modoEdicao ? 'hover:shadow-[0_4px_20px_rgba(13,27,53,0.08)] hover:border-[#C4CFEA]' : ''}
    >
      {/* Color bar */}
      <div style={{ height: 3, background: widget.cor_destaque, width: '100%' }} />

      {/* Edit controls */}
      {modoEdicao && (
        <div className="flex items-center justify-between px-3 pt-2">
          <span style={{ fontSize: 14, color: '#8A9BBC', cursor: 'grab' }}>⠿</span>
          <div className="flex items-center gap-1">
            <button onClick={onEdit} style={{ width: 20, height: 20, borderRadius: 4, fontSize: 11, background: '#F0F4FF', border: '1px solid rgba(26,60,255,0.25)', color: '#1A3CFF', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>✎</button>
            {[1, 2, 3].map(n => (
              <button key={n} onClick={() => onResize(n)} style={{ width: 20, height: 20, borderRadius: 4, fontSize: 9, fontWeight: 700, background: widget.colunas === n ? '#1A3CFF' : '#F0F4FA', border: `1px solid ${widget.colunas === n ? '#1A3CFF' : '#DDE4F0'}`, color: widget.colunas === n ? '#fff' : '#4A5E80' }}>{n === 1 ? 'P' : n === 2 ? 'M' : 'G'}</button>
            ))}
            <button onClick={onDelete} style={{ width: 20, height: 20, borderRadius: 4, fontSize: 13, fontWeight: 700, background: '#fef2f2', border: '1px solid #fca5a5', color: '#DC2626', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ padding: '12px 14px 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', background: `${widget.cor_destaque}18`, color: widget.cor_destaque, padding: '2px 7px', borderRadius: 4 }}>{badge}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: '#0D1B35', flex: 1 }}>{widget.titulo}</span>
        {hasAnalise && (
          <span style={{ fontSize: 14, color: hashChanged ? '#DC2626' : '#1A3CFF' }}>✦</span>
        )}
      </div>

      {/* Body per type */}
      <div style={{ padding: '4px 14px 2px' }}>
        {widget.tipo === 'card_resumo' && <CardResumoBody widget={widget} somaAtual={somaAtual} contaMap={contaMap} valMap={valMap} comp={comp} avPct={avPct} />}
        {widget.tipo === 'comparativo' && <ComparativoBody widget={widget} somaAtual={somaAtual} somaPrev={somaPrev} comp={comp} prevComp={prevComp} delta={delta} hasPrev={hasPrev} melhorou={melhorou} avPct={avPct} getFaturamento={getFaturamento} />}
        {widget.tipo === 'grafico_barras' && <GraficoBarrasBody widget={widget} valMap={valMap} contaMap={contaMap} comp={comp} />}
        {widget.tipo === 'grafico_pizza' && <GraficoPizzaBody widget={widget} valMap={valMap} contaMap={contaMap} comp={comp} />}
        {widget.tipo === 'indicador' && <IndicadorBody widget={widget} getSoma={getSoma} comp={comp} />}
        {widget.tipo === 'cruzamento' && <CruzamentoBody widget={widget} getSoma={getSoma} contaMap={contaMap} valMap={valMap} comp={comp} />}
        {widget.tipo === 'detalhamento' && <DetalhamentoBody widget={widget} contaMap={contaMap} valMap={valMap} comp={comp} somaAtual={somaAtual} avPct={avPct} />}
      </div>

      {/* Footer */}
      <div style={{ padding: '6px 14px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10, color: '#8A9BBC' }}>{fmtComp(comp)}</span>
        {delta != null && hasPrev ? (
          <span style={{ fontSize: 10, fontWeight: 600, padding: '1px 5px', borderRadius: 4, background: melhorou ? 'rgba(0,168,107,0.1)' : 'rgba(220,38,38,0.1)', color: melhorou ? '#00A86B' : '#DC2626' }}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
        ) : (
          <span style={{ fontSize: 10, color: '#C4CFEA' }}>—</span>
        )}
      </div>
    </div>
  );
}

function computeHashFromValues(valores: { nome: string; valor: number }[], resultado: number) {
  const hashInput = valores
    .map(v => `${v.nome}:${v.valor}`)
    .sort()
    .join('|') + `|resultado:${resultado}`;
  return btoa(hashInput).slice(0, 32);
}

function computeHash(w: Widget, comp: string, valMap: Record<string, number>, contaMap: Record<string, Conta>, getSoma: (ids: string[], comp: string) => number) {
  const valores = w.conta_ids.map(id => ({
    nome: contaMap[id]?.nome || id.slice(0, 8),
    valor: valMap[`${id}__${comp}`] || 0,
  }));
  const resultado = getSoma(w.conta_ids, comp);
  return computeHashFromValues(valores, resultado);
}

/* ─── card_resumo body ─── */
function CardResumoBody({ widget, somaAtual, contaMap, valMap, comp, avPct }: {
  widget: Widget; somaAtual: number; contaMap: Record<string, Conta>;
  valMap: Record<string, number>; comp: string; avPct: number | null;
}) {
  const items = (widget.conta_ids || [])
    .map(id => ({ id, nome: contaMap[id]?.nome || id.slice(0, 8), valor: valMap[`${id}__${comp}`] || 0 }))
    .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  const top5 = items.slice(0, 5);
  const others = items.slice(5);
  if (others.length) top5.push({ id: '__others', nome: 'Outros', valor: others.reduce((s, i) => s + i.valor, 0) });
  const maxAbs = Math.max(...top5.map(i => Math.abs(i.valor)), 1);

  return (
    <>
      <div className="flex items-baseline gap-2">
        <span style={{ fontFamily: 'Courier New, monospace', fontSize: 22, fontWeight: 700, color: widget.cor_destaque }}>{formatCurrency(somaAtual)}</span>
        {avPct != null && <span style={{ fontSize: 10, color: '#8A9BBC' }}>· {avPct.toFixed(1)}% do fat.</span>}
      </div>
      <div className="mt-2 space-y-1" style={{ padding: '2px 0 8px' }}>
        {top5.map((item, i) => (
          <div key={item.id} className="flex items-center gap-2" style={{ fontSize: 10.5 }}>
            <span style={{ color: '#4A5E80', width: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {item.nome.length > 14 ? item.nome.slice(0, 14) + '…' : item.nome}
            </span>
            <div style={{ flex: 1, height: 4, borderRadius: 3, background: '#F0F4FA', overflow: 'hidden' }}>
              <div style={{ width: `${(Math.abs(item.valor) / maxAbs) * 100}%`, height: '100%', borderRadius: 3, background: widget.cor_destaque, opacity: 1 - i * 0.15, transition: 'width 0.8s ease' }} />
            </div>
            <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9.5, color: '#4A5E80', minWidth: 60, textAlign: 'right' }}>{formatCurrency(item.valor)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/* ─── comparativo body ─── */
function ComparativoBody({ widget, somaAtual, somaPrev, comp, prevComp, delta, hasPrev, melhorou, avPct, getFaturamento }: {
  widget: Widget; somaAtual: number; somaPrev: number; comp: string; prevComp: string;
  delta: number | null; hasPrev: boolean; melhorou: boolean | null; avPct: number | null;
  getFaturamento: (comp: string) => number;
}) {
  const fatPrev = getFaturamento(prevComp);
  const avPrev = fatPrev ? (Math.abs(somaPrev) / Math.abs(fatPrev)) * 100 : null;
  const corAtual = hasPrev && melhorou != null ? (melhorou ? '#00A86B' : '#DC2626') : '#4A5E80';
  const diff = somaAtual - somaPrev;

  return (
    <>
      <div className="flex" style={{ padding: '4px 0' }}>
        <div className="flex-1 pr-3">
          <p style={{ fontSize: 9, color: '#8A9BBC', textTransform: 'uppercase', marginBottom: 2 }}>{fmtComp(prevComp)}</p>
          <p style={{ fontFamily: 'Courier New, monospace', fontSize: 16, fontWeight: 700, color: '#4A5E80' }}>{hasPrev ? formatCurrency(somaPrev) : '—'}</p>
          {avPrev != null && <span style={{ fontSize: 9.5, color: '#8A9BBC' }}>{avPrev.toFixed(1)}%</span>}
        </div>
        <div style={{ width: 1, background: '#DDE4F0' }} />
        <div className="flex-1 pl-3">
          <p style={{ fontSize: 9, color: '#8A9BBC', textTransform: 'uppercase', marginBottom: 2 }}>{fmtComp(comp)}</p>
          <p style={{ fontFamily: 'Courier New, monospace', fontSize: 16, fontWeight: 700, color: corAtual }}>{formatCurrency(somaAtual)}</p>
          <span style={{ fontSize: 9.5, color: corAtual }}>
            {avPct != null ? `${avPct.toFixed(1)}%` : ''}
            {delta != null && hasPrev ? ` (${delta >= 0 ? '+' : ''}${delta.toFixed(1)} p.p.)` : ''}
          </span>
        </div>
      </div>
      {hasPrev && Math.abs(delta || 0) > 5 && (
        <div style={{ margin: '6px 0', padding: '5px 9px', borderRadius: '0 6px 6px 0', borderLeft: `2px solid ${corAtual}`, background: melhorou ? 'rgba(0,168,107,0.05)' : 'rgba(220,38,38,0.05)', fontSize: 10.5, fontWeight: 700, color: corAtual }}>
          {diff >= 0 ? '+' : '−'}R$ {Math.abs(diff).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} vs. mês anterior
        </div>
      )}
    </>
  );
}

/* ─── grafico_barras body ─── */
function GraficoBarrasBody({ widget, valMap, contaMap, comp }: {
  widget: Widget; valMap: Record<string, number>; contaMap: Record<string, Conta>; comp: string;
}) {
  const periodos = getNPrevCompetencias(comp, widget.periodo_meses || 6);
  const contaIds = widget.conta_ids || [];

  // Build data: per month, per conta
  const data = periodos.map(p => {
    const vals: Record<string, number> = {};
    contaIds.forEach(id => { vals[id] = valMap[`${id}__${p}`] || 0; });
    return { comp: p, ...vals };
  });

  // Find max value for scaling
  let maxVal = 0;
  data.forEach(d => { contaIds.forEach(id => { maxVal = Math.max(maxVal, Math.abs(d[id] || 0)); }); });
  if (maxVal === 0) maxVal = 1;

  const barColors = contaIds.map((_, i) => {
    const hue = hexToHsl(widget.cor_destaque);
    return `hsl(${hue.h}, ${Math.max(30, hue.s - i * 10)}%, ${Math.min(70, hue.l + i * 8)}%)`;
  });

  return (
    <div style={{ padding: '0 0 6px' }}>
      {/* Legend */}
      <div className="flex flex-wrap gap-2 mb-2">
        {contaIds.slice(0, 5).map((id, i) => (
          <span key={id} className="flex items-center gap-1" style={{ fontSize: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: barColors[i], display: 'inline-block' }} />
            <span style={{ color: '#4A5E80' }}>{(contaMap[id]?.nome || '').slice(0, 12)}</span>
          </span>
        ))}
      </div>
      {/* Simple bar chart */}
      <div style={{ height: 120, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        {data.map((d, mi) => (
          <div key={d.comp} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, height: '100%', justifyContent: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', width: '100%', justifyContent: 'center', flex: 1 }}>
              {contaIds.map((id, ci) => {
                const v = Math.abs(d[id] || 0);
                const h = (v / maxVal) * 90;
                return (
                  <div key={id} style={{ width: Math.max(4, Math.floor(100 / contaIds.length / data.length)), height: `${h}%`, minHeight: v > 0 ? 2 : 0, background: barColors[ci], borderRadius: '2px 2px 0 0', opacity: d.comp === comp ? 1 : 0.65, transition: 'height 0.5s' }} />
                );
              })}
            </div>
            <span style={{ fontSize: 8, color: '#8A9BBC', textAlign: 'center' }}>{fmtCompShort(d.comp)}</span>
          </div>
        ))}
      </div>
      {widget.meta_valor != null && (
        <div className="flex items-center gap-1 mt-1">
          <div style={{ flex: 1, height: 1, borderTop: '1.5px dashed #D97706' }} />
          <span style={{ fontSize: 8, color: '#D97706' }}>meta {formatCurrency(widget.meta_valor)}</span>
        </div>
      )}
    </div>
  );
}

/* ─── grafico_pizza body ─── */
function GraficoPizzaBody({ widget, valMap, contaMap, comp }: {
  widget: Widget; valMap: Record<string, number>; contaMap: Record<string, Conta>; comp: string;
}) {
  const items = (widget.conta_ids || []).map(id => ({
    id, nome: contaMap[id]?.nome || id.slice(0, 8), valor: Math.abs(valMap[`${id}__${comp}`] || 0),
  }));
  const total = items.reduce((s, i) => s + i.valor, 0);
  const colors = ['#1A3CFF', '#00A86B', '#D97706', '#0099E6', '#DC2626', '#8A9BBC', '#9333EA'];

  // Simple donut using SVG
  const radius = 40;
  const cx = 50, cy = 50;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;

  return (
    <div style={{ display: 'flex', gap: 12, padding: '4px 0 6px', alignItems: 'center' }}>
      <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
        <svg viewBox="0 0 100 100" width={100} height={100}>
          {items.map((item, i) => {
            const pct = total > 0 ? item.valor / total : 0;
            const dashLength = pct * circumference;
            const offset = cumulativeOffset;
            cumulativeOffset += dashLength;
            return (
              <circle key={item.id} cx={cx} cy={cy} r={radius} fill="none" stroke={colors[i % colors.length]} strokeWidth={12}
                strokeDasharray={`${dashLength} ${circumference - dashLength}`}
                strokeDashoffset={-offset} transform={`rotate(-90 ${cx} ${cy})`} />
            );
          })}
        </svg>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <span style={{ fontFamily: 'Courier New, monospace', fontSize: 11, fontWeight: 700, color: '#0D1B35' }}>{formatCurrency(total)}</span>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 3, flex: 1 }}>
        {items.map((item, i) => {
          const pct = total > 0 ? (item.valor / total) * 100 : 0;
          return (
            <div key={item.id} className="flex items-center gap-1" style={{ fontSize: 10 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], flexShrink: 0 }} />
              <span style={{ color: '#4A5E80', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.nome}</span>
              <span style={{ fontWeight: 700, color: '#0D1B35' }}>{pct.toFixed(0)}%</span>
              <span style={{ fontFamily: 'Courier New, monospace', fontSize: 9, color: '#8A9BBC' }}>{formatCurrency(item.valor)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── indicador body ─── */
function IndicadorBody({ widget, getSoma, comp }: {
  widget: Widget; getSoma: (ids: string[], comp: string) => number; comp: string;
}) {
  const num = getSoma(widget.conta_ids, comp);
  const den = getSoma(widget.conta_ids_b || [], comp);
  const resultado = den !== 0 ? (num / den) * 100 : 0;
  const meta = widget.meta_valor || 0;
  const direcao = widget.meta_direcao || 'menor_melhor';

  let semaforo: 'verde' | 'ambar' | 'vermelho';
  if (direcao === 'menor_melhor') {
    semaforo = resultado <= meta ? 'verde' : resultado <= meta * 1.05 ? 'ambar' : 'vermelho';
  } else {
    semaforo = resultado >= meta ? 'verde' : resultado >= meta * 0.95 ? 'ambar' : 'vermelho';
  }
  const corSemaforo = { verde: '#00A86B', ambar: '#D97706', vermelho: '#DC2626' }[semaforo];
  const distancia = resultado - meta;
  const maxGauge = meta * 1.5 || 100;
  const markerPos = Math.min(100, Math.max(0, (resultado / maxGauge) * 100));
  const metaPos = Math.min(100, Math.max(0, (meta / maxGauge) * 100));

  return (
    <div style={{ padding: '4px 0 6px' }}>
      <div className="flex items-center gap-3">
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: corSemaforo, boxShadow: `0 0 0 4px ${corSemaforo}26`, flexShrink: 0 }} />
        <span style={{ fontFamily: 'Courier New, monospace', fontSize: 22, fontWeight: 700, color: corSemaforo }}>{resultado.toFixed(1)}%</span>
      </div>
      {/* Gauge bar */}
      <div style={{ position: 'relative', height: 6, borderRadius: 3, background: 'linear-gradient(90deg, #00A86B 0%, #D97706 60%, #DC2626 100%)', margin: '8px 0 4px' }}>
        <div style={{ position: 'absolute', width: 2, height: 12, background: '#0D1B35', borderRadius: 1, top: -3, left: `${markerPos}%`, transform: 'translateX(-1px)' }} />
        {meta > 0 && <span style={{ position: 'absolute', top: 10, left: `${metaPos}%`, transform: 'translateX(-50%)', fontSize: 9, color: '#D97706' }}>meta {meta.toFixed(0)}%</span>}
      </div>
      <p style={{ fontSize: 10, color: '#4A5E80', fontStyle: 'italic', marginTop: 8 }}>
        {Math.abs(distancia).toFixed(1)} p.p. {distancia > 0 ? 'acima' : 'abaixo'} da meta
      </p>
    </div>
  );
}

/* ─── cruzamento body ─── */
function CruzamentoBody({ widget, getSoma, contaMap, valMap, comp }: {
  widget: Widget; getSoma: (ids: string[], comp: string) => number;
  contaMap: Record<string, Conta>; valMap: Record<string, number>; comp: string;
}) {
  const a = getSoma(widget.conta_ids, comp);
  const b = getSoma(widget.conta_ids_b || [], comp);
  const resultado = b !== 0 ? a / b : 0;
  const isPct = widget.formato_resultado === 'percentual';
  const displayVal = isPct ? `${(resultado * 100).toFixed(1)}%` : resultado.toFixed(2);

  // Sparkline: last 4 months
  const last4 = getNPrevCompetencias(comp, 4);
  const sparkVals = last4.map(c => {
    const va = getSoma(widget.conta_ids, c);
    const vb = getSoma(widget.conta_ids_b || [], c);
    return vb !== 0 ? va / vb : 0;
  });
  const sparkMin = Math.min(...sparkVals);
  const sparkMax = Math.max(...sparkVals);
  const sparkRange = sparkMax - sparkMin || 1;

  const nomeA = widget.conta_ids.map(id => contaMap[id]?.nome || '').filter(Boolean).join(' + ');
  const nomeB = (widget.conta_ids_b || []).map(id => contaMap[id]?.nome || '').filter(Boolean).join(' + ');

  // Trend
  const prevVal = sparkVals.length >= 2 ? sparkVals[sparkVals.length - 2] : null;
  const trendUp = prevVal != null ? resultado > prevVal : null;

  return (
    <div style={{ padding: '4px 0 6px' }}>
      <div className="flex items-baseline gap-2">
        <span style={{ fontFamily: 'Courier New, monospace', fontSize: 24, fontWeight: 700, color: widget.cor_destaque }}>{displayVal}</span>
        {trendUp != null && (
          <span style={{ fontSize: 12, color: trendUp ? '#00A86B' : '#DC2626' }}>{trendUp ? '↑' : '↓'}</span>
        )}
      </div>
      <p style={{ fontSize: 10, color: '#8A9BBC' }}>{nomeA.slice(0, 20)} / {nomeB.slice(0, 20)}</p>
      {/* Sparkline SVG */}
      <svg width="100%" height={36} style={{ display: 'block', marginTop: 6 }}>
        {sparkVals.length > 1 && (
          <>
            <polyline
              fill="none" stroke={widget.cor_destaque} strokeWidth={1.5} strokeOpacity={0.7}
              points={sparkVals.map((v, i) => `${(i / (sparkVals.length - 1)) * 100}%,${36 - ((v - sparkMin) / sparkRange) * 28 - 4}`).join(' ')}
            />
            <circle cx={`${100}%`} cy={36 - ((sparkVals[sparkVals.length - 1] - sparkMin) / sparkRange) * 28 - 4} r={3} fill={widget.cor_destaque} />
          </>
        )}
      </svg>
    </div>
  );
}

/* ─── detalhamento body ─── */
function DetalhamentoBody({ widget, contaMap, valMap, comp, somaAtual, avPct }: {
  widget: Widget; contaMap: Record<string, Conta>; valMap: Record<string, number>;
  comp: string; somaAtual: number; avPct: number | null;
}) {
  const items = (widget.conta_ids || []).map(id => ({
    id, nome: contaMap[id]?.nome || id.slice(0, 8), valor: valMap[`${id}__${comp}`] || 0, ordem: contaMap[id]?.ordem ?? 0,
  }));

  let filtered = widget.ocultar_zeros ? items.filter(i => i.valor !== 0) : items;
  if (widget.ordenacao_lista === 'maior_primeiro') {
    filtered = [...filtered].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  } else {
    filtered = [...filtered].sort((a, b) => a.ordem - b.ordem);
  }

  const total = Math.abs(somaAtual);
  const top7 = filtered.slice(0, 7);
  const rest = filtered.slice(7);
  const restSum = rest.reduce((s, i) => s + i.valor, 0);

  return (
    <>
      {/* Total block */}
      <div style={{ padding: '8px 0 4px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div>
          <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: '#8A9BBC', letterSpacing: '0.1em', display: 'block' }}>TOTAL</span>
          <span style={{ fontFamily: 'Courier New, monospace', fontSize: 20, fontWeight: 700, color: widget.cor_destaque }}>{formatCurrency(somaAtual)}</span>
        </div>
        {avPct != null && <span style={{ fontSize: 10, color: '#8A9BBC' }}>{avPct.toFixed(1)}% do fat.</span>}
      </div>
      <div style={{ height: 1, background: '#DDE4F0', margin: '0 0 6px' }} />
      {/* List */}
      <div style={{ padding: '0 0 8px' }}>
        {top7.map((item, i) => {
          const pct = total > 0 ? (Math.abs(item.valor) / total) * 100 : 0;
          return (
            <div key={item.id} style={{ marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#4A5E80', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>
                  {item.nome.length > 20 ? item.nome.slice(0, 20) + '…' : item.nome}
                </span>
                <span style={{ fontFamily: 'Courier New, monospace', fontSize: 10.5, fontWeight: 700, color: '#0D1B35', marginLeft: 8 }}>{formatCurrency(item.valor)}</span>
                <span style={{ fontSize: 9.5, color: '#8A9BBC', minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
              </div>
              <div style={{ height: 3, borderRadius: 2, background: '#F0F4FA', marginTop: 1 }}>
                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: widget.cor_destaque, opacity: 1 - i * 0.093, transition: 'width 0.5s' }} />
              </div>
            </div>
          );
        })}
        {rest.length > 0 && (
          <div style={{ fontSize: 10.5, color: '#8A9BBC', fontStyle: 'italic', marginTop: 2 }}>
            ＋ {rest.length} outras · {formatCurrency(restSum)}
          </div>
        )}
      </div>
    </>
  );
}

/* ─── hex to HSL helper ─── */
function hexToHsl(hex: string) {
  let r = 0, g = 0, b = 0;
  if (hex.length === 7) {
    r = parseInt(hex.slice(1, 3), 16) / 255;
    g = parseInt(hex.slice(3, 5), 16) / 255;
    b = parseInt(hex.slice(5, 7), 16) / 255;
  }
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/* ─── Detail Modal (KpiDetalheModal style) ─── */
function DetalheModal({ widget, comp, contaMap, getSoma, getFaturamento, valMap, getContaTipoSemantico, onClose }: {
  widget: Widget; comp: string; contaMap: Record<string, Conta>;
  getSoma: (ids: string[], comp: string) => number;
  getFaturamento: (comp: string) => number;
  valMap: Record<string, number>;
  getContaTipoSemantico: (ids: string[]) => string;
  onClose: () => void;
}) {
  const tipoOpt = TIPO_OPTIONS.find(t => t.value === widget.tipo);
  const eyebrow = `${(tipoOpt?.title || widget.tipo).toUpperCase()} · IA`;
  const prevComp = getPrevCompetencia(comp);
  const somaAtual = getSoma(widget.conta_ids, comp);
  const somaPrev = getSoma(widget.conta_ids, prevComp);
  const fat = getFaturamento(comp);
  const hasAnalise = !!widget.analise_ia;
  const hashChanged = hasAnalise && widget.analise_hash !== computeHash(widget, comp, valMap, contaMap, getSoma);

  // Indicador semaphore
  const indicadorData = useMemo(() => {
    if (widget.tipo !== 'indicador') return null;
    const num = getSoma(widget.conta_ids, comp);
    const den = getSoma(widget.conta_ids_b || [], comp);
    const resultado = den !== 0 ? (num / den) * 100 : 0;
    const meta = widget.meta_valor || 0;
    const direcao = widget.meta_direcao || 'menor_melhor';
    let semaforo: 'verde' | 'ambar' | 'vermelho';
    if (direcao === 'menor_melhor') {
      semaforo = resultado <= meta ? 'verde' : resultado <= meta * 1.05 ? 'ambar' : 'vermelho';
    } else {
      semaforo = resultado >= meta ? 'verde' : resultado >= meta * 0.95 ? 'ambar' : 'vermelho';
    }
    return { resultado, meta, semaforo, distancia: resultado - meta, num, den };
  }, [widget, comp, getSoma]);

  const STATUS_LABEL: Record<string, { text: string; bg: string; color: string }> = {
    verde: { text: 'OK', bg: 'rgba(0,168,107,0.12)', color: '#00A86B' },
    ambar: { text: 'Atenção', bg: 'rgba(217,119,6,0.12)', color: '#D97706' },
    vermelho: { text: 'Crítico', bg: 'rgba(220,38,38,0.12)', color: '#DC2626' },
  };

  const statusCfg = indicadorData ? STATUS_LABEL[indicadorData.semaforo] : null;

  // History: last 6 months
  const histMeses = useMemo(() => getNPrevCompetencias(comp, 6), [comp]);

  const histValues = useMemo(() => {
    return histMeses.map(m => {
      if (widget.tipo === 'indicador') {
        const num = getSoma(widget.conta_ids, m);
        const den = getSoma(widget.conta_ids_b || [], m);
        return den !== 0 ? (num / den) * 100 : 0;
      }
      if (widget.tipo === 'cruzamento') {
        const a = getSoma(widget.conta_ids, m);
        const b = getSoma(widget.conta_ids_b || [], m);
        if (b === 0) return 0;
        return widget.formato_resultado === 'percentual' ? (a / b) * 100 : a / b;
      }
      return getSoma(widget.conta_ids, m);
    });
  }, [widget, histMeses, getSoma]);

  const fmtMonthLong = (c: string) => {
    const d = new Date(c + 'T12:00:00');
    return d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  // Prose description builder
  function buildDescricao() {
    const nomesList = widget.conta_ids.map(id => contaMap[id]?.nome || id.slice(0, 8));
    const fmtNomes = (nomes: string[]) => {
      if (nomes.length <= 3) return nomes.join(', ');
      return `${nomes.slice(0, 3).join(', ')} e mais ${nomes.length - 3} outras`;
    };
    const mesAtual = fmtMonthLong(comp);
    const mesAnterior = fmtMonthLong(prevComp);

    switch (widget.tipo) {
      case 'card_resumo':
        return `Este card soma os valores registrados em ${nomesList.length} conta(s) selecionada(s) — ${fmtNomes(nomesList)} — e exibe o total para ${mesAtual}. O resultado também é comparado com o faturamento total do período para mostrar qual fatia ele representa.`;
      case 'comparativo':
        return `Este card compara o total das contas selecionadas entre dois meses consecutivos — ${mesAnterior} e ${mesAtual} — para mostrar se houve evolução ou queda. A variação é calculada pela diferença entre os dois períodos, em valor (R$) e percentual (%).`;
      case 'grafico_barras':
        return `Este gráfico mostra a evolução mensal das contas selecionadas ao longo dos últimos ${widget.periodo_meses || 6} meses. Cada barra representa o valor registrado naquele mês, permitindo visualizar tendências de crescimento ou queda ao longo do tempo.`;
      case 'grafico_pizza':
        return `Este gráfico mostra como o total de ${mesAtual} está distribuído entre as contas selecionadas. Cada fatia representa a participação percentual de uma conta no total — quanto maior a fatia, maior o peso daquela conta no resultado.`;
      case 'indicador': {
        const nomesNum = fmtNomes(nomesList);
        const nomesDen = fmtNomes((widget.conta_ids_b || []).map(id => contaMap[id]?.nome || id.slice(0, 8)));
        const meta = widget.meta_valor || 0;
        return `Este indicador calcula a proporção entre ${nomesNum} e ${nomesDen} — ou seja, quanto do denominador é consumido pelo numerador. O resultado é comparado com a meta definida de ${meta}%, indicando se o negócio está dentro ou fora do parâmetro esperado.`;
      }
      case 'cruzamento': {
        const nomeA = fmtNomes(nomesList);
        const nomeB = fmtNomes((widget.conta_ids_b || []).map(id => contaMap[id]?.nome || id.slice(0, 8)));
        const isPct = widget.formato_resultado === 'percentual';
        return `Este widget divide o valor de ${nomeA} pelo valor de ${nomeB} para revelar uma relação entre as duas grandezas. O resultado ${isPct ? 'é expresso em %' : 'é expresso como índice'} e acompanha a tendência dos últimos meses para mostrar se essa relação está melhorando ou piorando.`;
      }
      case 'detalhamento': {
        const nomes = fmtNomes(nomesList);
        const ordTxt = (widget as any).ordenacao_lista === 'ordem_plano' ? 'As contas seguem a ordem do plano de contas.' : 'As contas estão ordenadas da maior para a menor contribuição.';
        const zeroTxt = (widget as any).ocultar_zeros ? ' Contas sem movimentação no período estão ocultas.' : '';
        return `Este painel lista individualmente as contas selecionadas para ${mesAtual}, mostrando o valor de cada uma e sua participação no total. ${ordTxt}${zeroTxt}`;
      }
      default: return widget.titulo;
    }
  }

  // Composition table data
  const composicao = useMemo(() => {
    const rows: { nome: string; valor: number; pctFat: number | null; pctTotal?: number }[] = [];
    widget.conta_ids.forEach(id => {
      const v = valMap[`${id}__${comp}`] || 0;
      rows.push({ nome: contaMap[id]?.nome || id.slice(0, 8), valor: v, pctFat: fat ? (Math.abs(v) / Math.abs(fat) * 100) : null });
    });
    if (widget.tipo === 'detalhamento') {
      const total = Math.abs(rows.reduce((s, r) => s + r.valor, 0));
      return rows.map(r => ({ ...r, pctTotal: total > 0 ? (Math.abs(r.valor) / total) * 100 : 0 }));
    }
    if (widget.tipo === 'comparativo') {
      return widget.conta_ids.map(id => ({
        nome: contaMap[id]?.nome || id.slice(0, 8),
        valor: valMap[`${id}__${comp}`] || 0,
        valorPrev: valMap[`${id}__${prevComp}`] || 0,
        pctFat: fat ? (Math.abs(valMap[`${id}__${comp}`] || 0) / Math.abs(fat) * 100) : null,
      }));
    }
    if ((widget.tipo === 'indicador' || widget.tipo === 'cruzamento') && widget.conta_ids_b?.length) {
      (widget.conta_ids_b || []).forEach(id => {
        const v = valMap[`${id}__${comp}`] || 0;
        rows.push({ nome: `${contaMap[id]?.nome || id.slice(0, 8)} (B)`, valor: v, pctFat: fat ? (Math.abs(v) / Math.abs(fat) * 100) : null });
      });
    }
    return rows;
  }, [widget, comp, prevComp, valMap, contaMap, fat]);

  // Sparkline for history
  const sparkMin = Math.min(...histValues);
  const sparkMax = Math.max(...histValues);
  const sparkRange = sparkMax - sparkMin || 1;

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        background: 'rgba(13,27,53,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <style>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes modalEnter { from { opacity: 0; transform: scale(0.96) translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 600, maxHeight: '88vh',
          borderRadius: 16, overflow: 'hidden',
          background: '#FAFCFF',
          boxShadow: '0 25px 60px rgba(0,0,0,0.3)',
          animation: 'modalEnter 0.22s ease',
          display: 'flex', flexDirection: 'column',
        }}
      >
        {/* Header — dark, matching KpiDetalheModal */}
        <div style={{ background: '#0D1B35', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.45)', letterSpacing: '0.15em', marginBottom: 4 }}>{eyebrow}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#FFFFFF' }}>{widget.titulo}</span>
              {statusCfg && indicadorData && (
                <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 8, background: statusCfg.bg, color: statusCfg.color }}>
                  {indicadorData.resultado.toFixed(1)}% · {statusCfg.text}
                </span>
              )}
            </div>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 4, display: 'block' }}>{fmtMonthLong(comp)}</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)', fontSize: 20, cursor: 'pointer', padding: '4px 8px', lineHeight: 1 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: 24, flex: 1 }}>
          {/* Section 1 — COMO É CALCULADO */}
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.15em', display: 'block', marginBottom: 8 }}>📐 COMO É CALCULADO</span>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: 12.5, color: '#4A5E80', lineHeight: 1.7, padding: '0 0 8px', margin: 0 }}>
              {buildDescricao()}
            </p>
          </div>

          {/* Section 2 — COMPOSIÇÃO */}
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.15em', display: 'block', marginBottom: 8 }}>🔢 COMPOSIÇÃO — {fmtMonthLong(comp).toUpperCase()}</span>
            {widget.tipo === 'detalhamento' ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #DDE4F0' }}>
                    <th style={{ textAlign: 'left', fontSize: 10, fontWeight: 700, color: '#8A9BBC', padding: '6px 0' }}>Conta</th>
                    <th style={{ textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#8A9BBC', padding: '6px 0' }}>Valor</th>
                    <th style={{ textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#8A9BBC', padding: '6px 0', minWidth: 60 }}>% do total</th>
                    <th style={{ textAlign: 'right', fontSize: 10, fontWeight: 700, color: '#8A9BBC', padding: '6px 0', minWidth: 60 }}>% do fat.</th>
                  </tr>
                </thead>
                <tbody>
                  {(composicao as any[]).map((item: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #F0F4FA' }}>
                      <td style={{ fontSize: 12, color: '#4A5E80', padding: '6px 0' }}>{item.nome}</td>
                      <td style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#0D1B35', fontWeight: 500, textAlign: 'right', padding: '6px 0' }}>{formatCurrency(item.valor)}</td>
                      <td style={{ fontSize: 11, color: '#4A5E80', textAlign: 'right', padding: '6px 0' }}>{(item.pctTotal ?? 0).toFixed(1)}%</td>
                      <td style={{ fontSize: 11, color: '#8A9BBC', textAlign: 'right', padding: '6px 0' }}>{item.pctFat != null ? `${item.pctFat.toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
                  <tr style={{ borderTop: '1px solid #DDE4F0' }}>
                    <td style={{ fontSize: 12, fontWeight: 700, color: '#0D1B35', padding: '8px 0' }}>Total</td>
                    <td style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: '#0D1B35', textAlign: 'right', padding: '8px 0' }}>{formatCurrency(somaAtual)}</td>
                    <td style={{ fontSize: 11, fontWeight: 700, color: '#0D1B35', textAlign: 'right', padding: '8px 0' }}>100%</td>
                    <td style={{ fontSize: 11, color: '#8A9BBC', textAlign: 'right', padding: '8px 0' }}>{fat ? `${(Math.abs(somaAtual) / Math.abs(fat) * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                </tbody>
              </table>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', marginBottom: 12 }}>
                {(Array.isArray(composicao) ? composicao : []).map((item: any, i: number) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F0F4FA' }}>
                    <span style={{ fontSize: 12, color: '#4A5E80' }}>{item.nome}</span>
                    <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#0D1B35', fontWeight: 500 }}>{formatCurrency(Math.abs(item.valor ?? item.valorPrev ?? 0))}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F0F4FA' }}>
                  <span style={{ fontSize: 12, color: '#4A5E80' }}>Faturamento</span>
                  <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono', monospace", color: '#0D1B35', fontWeight: 500 }}>{formatCurrency(Math.abs(fat))}</span>
                </div>
              </div>
            )}
            {/* Result highlight */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: statusCfg?.bg || 'rgba(26,60,255,0.08)', borderRadius: 10, padding: '12px 16px' }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0D1B35' }}>= {widget.titulo}</span>
              <span style={{ fontSize: 22, fontWeight: 800, color: statusCfg?.color || widget.cor_destaque, fontFamily: "'JetBrains Mono', monospace" }}>
                {widget.tipo === 'indicador' && indicadorData ? `${indicadorData.resultado.toFixed(1)}%` :
                  widget.tipo === 'cruzamento' ? (() => { const a = getSoma(widget.conta_ids, comp); const b = getSoma(widget.conta_ids_b || [], comp); const r = b !== 0 ? a / b : 0; return widget.formato_resultado === 'percentual' ? `${(r * 100).toFixed(1)}%` : r.toFixed(2); })() :
                  formatCurrency(somaAtual)}
              </span>
            </div>
          </div>

          {/* Section 3 — HISTÓRICO */}
          <div style={{ marginBottom: 24 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.15em', display: 'block', marginBottom: 8 }}>📈 HISTÓRICO</span>
            <div style={{ background: '#F6F9FF', border: '1px solid #DDE4F0', borderRadius: 8, padding: '12px 14px' }}>
              <svg width="100%" height={60} viewBox="0 0 500 60" preserveAspectRatio="none" style={{ display: 'block' }}>
                {histValues.length > 1 && (
                  <>
                    <polyline
                      fill="none" stroke={widget.cor_destaque} strokeWidth={2} strokeOpacity={0.7}
                      points={histValues.map((v, i) => `${(i / (histValues.length - 1)) * 480 + 10},${55 - ((v - sparkMin) / sparkRange) * 45}`).join(' ')}
                    />
                    {histValues.map((v, i) => (
                      <circle key={i} cx={(i / (histValues.length - 1)) * 480 + 10} cy={55 - ((v - sparkMin) / sparkRange) * 45}
                        r={i === histValues.length - 1 ? 4 : 2.5}
                        fill={i === histValues.length - 1 ? widget.cor_destaque : '#fff'}
                        stroke={widget.cor_destaque} strokeWidth={1.5} />
                    ))}
                  </>
                )}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                {histMeses.map((m, i) => (
                  <span key={m} style={{ fontSize: 9, color: '#8A9BBC', fontFamily: "'JetBrains Mono', monospace" }}>{fmtCompShort(m)}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Section 4 — ANÁLISE GPI */}
          <div>
            <span style={{ fontSize: 10, fontWeight: 700, color: '#0099E6', letterSpacing: '0.15em', display: 'block', marginBottom: 8 }}>✨ ANÁLISE DO CONSULTOR GPI</span>

            {hasAnalise && !hashChanged && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#00A86B', background: 'rgba(0,168,107,0.1)', padding: '2px 6px', borderRadius: 4 }}>✓ CACHE</span>
                {widget.analise_gerada_em && (
                  <span style={{ fontSize: 11, color: '#8A9BBC' }}>
                    {new Date(widget.analise_gerada_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )}
            {hasAnalise && hashChanged && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 10, fontWeight: 600, color: '#D97706', background: 'rgba(217,119,6,0.1)', padding: '2px 6px', borderRadius: 4 }}>⚠ DESATUALIZADA</span>
              </div>
            )}

            {hasAnalise ? (
              <p style={{ fontSize: 13, color: '#0D1B35', margin: 0, lineHeight: 1.7 }}>{widget.analise_ia}</p>
            ) : (
              <div style={{ background: '#F0F4FA', border: '1px solid #DDE4F0', borderRadius: 12, padding: '24px', textAlign: 'center' }}>
                <Skeleton className="h-4 w-3/4 mb-3 mx-auto" />
                <Skeleton className="h-4 w-full mb-3" />
                <Skeleton className="h-4 w-5/6 mb-3 mx-auto" />
                <Skeleton className="h-4 w-2/3 mx-auto" />
                <p style={{ fontSize: 11, color: '#8A9BBC', marginTop: 12 }}>Analisando indicadores...</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer — matching KpiDetalheModal pattern */}
        <div style={{ borderTop: '1px solid #DDE4F0', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: '#8A9BBC' }}>{fmtMonthLong(comp)}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => toast({ title: 'Em breve' })}
              style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, background: '#F0F4FA', border: '1px solid #DDE4F0', color: '#4A5E80', cursor: 'pointer', opacity: hasAnalise ? 1 : 0.4 }}
              disabled={!hasAnalise}
            >
              🔄 Regenerar
            </button>
            {!hasAnalise && (
              <button onClick={() => toast({ title: 'Em breve' })} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 11, background: '#F6F9FF', border: '1px solid #DDE4F0', color: '#1A3CFF', cursor: 'pointer', fontWeight: 600 }}>
                ✨ Gerar análise
              </button>
            )}
            <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: '#1A3CFF', color: '#fff', border: 'none', cursor: 'pointer' }}>✕ Fechar</button>
          </div>
        </div>
      </div>
    </div>
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
  const [selectedContasB, setSelectedContasB] = useState<string[]>(isEdit ? (widget!.conta_ids_b || []) : []);
  const [colunas, setColunas] = useState(isEdit ? widget!.colunas : 1);
  const [corDestaque, setCorDestaque] = useState(isEdit ? widget!.cor_destaque : '#1A3CFF');
  const [periodoMeses, setPeriodoMeses] = useState(isEdit ? (widget!.periodo_meses || 6) : 6);
  const [metaValor, setMetaValor] = useState(isEdit ? (widget!.meta_valor || 0) : 0);
  const [metaDirecao, setMetaDirecao] = useState(isEdit ? (widget!.meta_direcao || 'menor_melhor') : 'menor_melhor');
  const [formatoResultado, setFormatoResultado] = useState(isEdit ? (widget!.formato_resultado || 'percentual') : 'percentual');
  const [saving, setSaving] = useState(false);
  const [buscaConta, setBuscaConta] = useState('');
  const [ordenacaoLista, setOrdenacaoLista] = useState(isEdit ? ((widget as any).ordenacao_lista || 'maior_primeiro') : 'maior_primeiro');
  const [ocultarZeros, setOcultarZeros] = useState(isEdit ? ((widget as any).ocultar_zeros ?? true) : true);

  const TIPO_CORES: Record<string, string> = { receita: '#1A3CFF', custo_variavel: '#DC2626', despesa_fixa: '#D97706', investimento: '#0099E6', financeiro: '#00A86B' };

  const needsContasB = tipo === 'indicador' || tipo === 'cruzamento';
  const needsPeriodo = tipo === 'grafico_barras';
  const needsMeta = tipo === 'indicador';
  const needsFormato = tipo === 'cruzamento';
  const needsDetalhamento = tipo === 'detalhamento';

  const allContas = contas;

  const contasFiltradas = useMemo(() => {
    if (!buscaConta.trim()) return null;
    const term = buscaConta.toLowerCase();
    return allContas.filter(c => c.nivel >= 1 && c.nome.toLowerCase().includes(term));
  }, [buscaConta, allContas]);

  const hierarquia = useMemo(() => {
    const grupos = allContas.filter(c => c.nivel === 0);
    const subgrupos = allContas.filter(c => c.nivel === 1);
    const categorias = allContas.filter(c => c.nivel === 2);

    return grupos.map(grupo => ({
      grupo,
      subgrupos: subgrupos
        .filter(sub => sub.conta_pai_id === grupo.id)
        .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
        .map(sub => ({
          sub,
          categorias: categorias
            .filter(cat => cat.conta_pai_id === sub.id)
            .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0))
        }))
    }));
  }, [allContas]);

  // Duplicate detection
  const duplicateAlerts = useMemo(() => {
    const alerts: string[] = [];
    const allSelected = [...selectedContas, ...selectedContasB];
    allSelected.forEach(id => {
      const c = allContas.find(x => x.id === id);
      if (!c) return;
      // Check if any parent is also selected
      if (c.conta_pai_id && allSelected.includes(c.conta_pai_id)) {
        const parent = allContas.find(x => x.id === c.conta_pai_id);
        if (parent) alerts.push(`${parent.nome} já totaliza ${c.nome}`);
      }
      // Check if any child is also selected
      allContas.filter(x => x.conta_pai_id === id && allSelected.includes(x.id)).forEach(child => {
        // Already covered by the child → parent check above
      });
    });
    return [...new Set(alerts)];
  }, [selectedContas, selectedContasB, allContas]);

  const handleSave = async () => {
    if (!titulo.trim() || !selectedContas.length) return;
    setSaving(true);
    try {
      if (isEdit && widget) {
        const { error } = await supabase.from('painel_widgets' as any).update({
          titulo: titulo.trim(),
          conta_ids: selectedContas,
          conta_ids_b: selectedContasB,
          colunas,
          cor_destaque: corDestaque,
          periodo_meses: periodoMeses,
          meta_valor: metaValor || null,
          meta_direcao: metaDirecao,
          formato_resultado: formatoResultado,
          ocultar_zeros: ocultarZeros,
          ordenacao_lista: ordenacaoLista,
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
          conta_ids_b: selectedContasB,
          cor_destaque: corDestaque,
          colunas,
          ordem: maxOrdem + 1,
          periodo_meses: periodoMeses,
          meta_valor: metaValor || null,
          meta_direcao: metaDirecao,
          formato_resultado: formatoResultado,
          ocultar_zeros: ocultarZeros,
          ordenacao_lista: ordenacaoLista,
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

  const renderContaSelector = (selected: string[], setSelected: (fn: (prev: string[]) => string[]) => void, label: string) => (
    <>
      <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>{label} *</label>
      {/* Chips */}
      <div className="flex flex-wrap gap-1.5 mb-2" style={{ minHeight: 24 }}>
        {selected.length === 0 ? (
          <span style={{ fontSize: 10, color: '#8A9BBC' }}>Nenhuma conta selecionada</span>
        ) : selected.map(id => {
          const c = allContas.find(x => x.id === id);
          const nome = c?.nome || id.slice(0, 8);
          return (
            <span key={id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(26,60,255,0.07)', border: '1px solid rgba(26,60,255,0.2)', borderRadius: 6, padding: '3px 9px', fontSize: 10, fontWeight: 700, color: '#1A3CFF' }}>
              {nome.length > 22 ? nome.slice(0, 22) + '…' : nome}
              <button onClick={() => setSelected(prev => prev.filter(x => x !== id))} style={{ fontSize: 13, color: '#1A3CFF', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </span>
          );
        })}
      </div>
      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <svg style={{ position: 'absolute', left: 10, top: 9, width: 14, height: 14, color: '#8A9BBC' }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        <input value={buscaConta} onChange={e => setBuscaConta(e.target.value)} placeholder="Buscar conta pelo nome..." style={{ width: '100%', padding: '8px 12px 8px 32px', borderRadius: 8, border: '1px solid #DDE4F0', fontSize: 12, color: '#0D1B35', outline: 'none' }} />
      </div>
      {/* List */}
      <div style={{ border: '1px solid #DDE4F0', borderRadius: 8, maxHeight: 220, overflowY: 'auto', background: '#FAFCFF', marginBottom: 10 }}>
        {contasFiltradas !== null ? (
          contasFiltradas.length === 0 ? (
            <p style={{ textAlign: 'center', padding: 16, fontSize: 12, color: '#8A9BBC' }}>Nenhuma conta encontrada</p>
          ) : contasFiltradas.map(c => {
            const sel = selected.includes(c.id);
            return (
              <button key={c.id} onClick={() => setSelected(prev => sel ? prev.filter(x => x !== c.id) : [...prev, c.id])} className="w-full text-left flex items-center gap-2 transition-colors" style={{ padding: '7px 12px', fontSize: 11, color: '#0D1B35', background: sel ? 'rgba(26,60,255,0.06)' : 'transparent', borderBottom: '1px solid #F0F4FA' }}>
                <input type="checkbox" checked={sel} readOnly style={{ accentColor: '#1A3CFF', width: 13, height: 13 }} />
                <span>{c.nome}</span>
                <span style={{ marginLeft: 'auto', fontSize: 7, background: c.nivel === 1 ? '#F0F4FA' : '#F6F9FF', color: c.nivel === 1 ? '#8A9BBC' : '#C4CFEA', padding: '1px 5px', borderRadius: 3 }}>
                  {c.nivel === 1 ? 'subgrupo' : 'categoria'}
                </span>
              </button>
            );
          })
        ) : (
          hierarquia.map((h, gi) => (
            <div key={h.grupo.id}>
              {gi > 0 && <div style={{ height: 1, background: '#DDE4F0' }} />}
              <div style={{ background: '#E8EEF8', padding: '6px 12px' }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', color: '#4A5E80', letterSpacing: '0.1em' }}>{h.grupo.nome}</span>
              </div>
              {h.subgrupos.map(({ sub, categorias }) => {
                const filhaIds = categorias.map(c => c.id);
                const selSub = selected.includes(sub.id);
                const filhasSel = filhaIds.filter(id => selected.includes(id)).length;
                const todasSel = filhaIds.length > 0 && filhasSel === filhaIds.length;
                const algumaSel = filhasSel > 0 && !todasSel;
                const checkado = selSub || todasSel;
                const tipoCor = TIPO_CORES[sub.tipo] || '#8A9BBC';
                const handleSubClick = () => {
                  const ids = [sub.id, ...filhaIds];
                  if (checkado) {
                    setSelected(prev => prev.filter(x => !ids.includes(x)));
                  } else {
                    setSelected(prev => Array.from(new Set([...prev, ...ids])));
                  }
                };
                return (
                  <div key={sub.id}>
                    <button onClick={handleSubClick} className="w-full text-left flex items-center gap-2 transition-colors" style={{ padding: '8px 12px 8px 20px', background: checkado ? 'rgba(26,60,255,0.06)' : 'transparent' }} onMouseEnter={e => { if (!checkado) (e.currentTarget as HTMLElement).style.background = 'rgba(26,60,255,0.04)'; }} onMouseLeave={e => { if (!checkado) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                      <input
                        type="checkbox"
                        checked={checkado}
                        readOnly
                        ref={el => { if (el) el.indeterminate = algumaSel; }}
                        style={{ accentColor: '#1A3CFF', width: 13, height: 13 }}
                      />
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: tipoCor, flexShrink: 0 }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#0D1B35' }}>{sub.nome}</span>
                      <span style={{ marginLeft: 'auto', fontSize: 7, background: '#F0F4FA', color: '#8A9BBC', padding: '1px 5px', borderRadius: 3 }}>subgrupo</span>
                    </button>
                    {categorias.map(cat => {
                      const selCat = selected.includes(cat.id);
                      return (
                        <button key={cat.id} onClick={() => setSelected(prev => selCat ? prev.filter(x => x !== cat.id) : [...prev, cat.id])} className="w-full text-left flex items-center gap-2 transition-colors" style={{ padding: '6px 12px 6px 36px', background: selCat ? 'rgba(26,60,255,0.04)' : 'transparent' }} onMouseEnter={e => { if (!selCat) (e.currentTarget as HTMLElement).style.background = 'rgba(26,60,255,0.03)'; }} onMouseLeave={e => { if (!selCat) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                          <input type="checkbox" checked={selCat} readOnly style={{ accentColor: '#1A3CFF', width: 13, height: 13 }} />
                          <span style={{ width: 5, height: 5, borderRadius: '50%', background: tipoCor, flexShrink: 0 }} />
                          <span style={{ fontSize: 11, color: '#4A5E80' }}>{cat.nome}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </>
  );

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(13,27,53,0.45)' }} />
      <div style={{
        position: 'relative', borderRadius: 16, background: '#fff', width: '100%', maxWidth: 560,
        maxHeight: '88vh', overflow: 'auto', animation: 'modalEnter 0.22s cubic-bezier(0.16,1,0.3,1)',
      }}>
        <div className="p-6">
          {step === 1 ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0D1B35', marginBottom: 4 }}>Novo Widget</h3>
                  <p style={{ fontSize: 11, color: '#8A9BBC' }}>Escolha o tipo de widget</p>
                </div>
                <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#F0F4FA', color: '#4A5E80', border: '1px solid #DDE4F0', cursor: 'pointer' }}>Cancelar</button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                {TIPO_OPTIONS.map(opt => (
                  <button key={opt.value} onClick={() => setTipo(opt.value)} style={{ padding: 14, borderRadius: 10, textAlign: 'center', cursor: 'pointer', border: `1.5px solid ${tipo === opt.value ? '#1A3CFF' : '#DDE4F0'}`, background: tipo === opt.value ? 'rgba(26,60,255,0.07)' : '#fff', transition: 'all 0.15s' }}>
                    <span style={{ fontSize: 28, display: 'block' }}>
                      {opt.icon === 'detail' ? (
                        <svg width={28} height={28} viewBox="0 0 28 28" style={{ display: 'inline-block', background: 'rgba(74,94,128,0.1)', borderRadius: 6, padding: 4 }}>
                          <rect x={5} y={9} width={14} height={2} rx={1} fill="#4A5E80" />
                          <rect x={5} y={14} width={10} height={2} rx={1} fill="#4A5E80" />
                          <rect x={5} y={19} width={7} height={2} rx={1} fill="#4A5E80" />
                        </svg>
                      ) : opt.icon}
                    </span>
                    <p style={{ fontSize: 12, fontWeight: 700, color: '#0D1B35', marginTop: 6 }}>{opt.title}</p>
                    <p style={{ fontSize: 10, color: '#8A9BBC', marginTop: 2 }}>{opt.desc}</p>
                  </button>
                ))}
              </div>
              <div className="flex justify-end mt-5">
                <button disabled={!tipo} onClick={() => setStep(2)} style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#1A3CFF', color: '#fff', opacity: tipo ? 1 : 0.45, cursor: tipo ? 'pointer' : 'default' }}>Próximo</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: '#0D1B35' }}>{isEdit ? 'Editar Widget' : 'Configurar Widget'}</h3>
                <button onClick={onClose} style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#F0F4FA', color: '#4A5E80', border: '1px solid #DDE4F0', cursor: 'pointer' }}>Cancelar</button>
              </div>
              {isEdit && (
                <span style={{ display: 'inline-block', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: 'rgba(26,60,255,0.07)', color: '#1A3CFF', padding: '3px 8px', borderRadius: 4, marginBottom: 12 }}>{tipoLabel}</span>
              )}
              {!isEdit && <div style={{ marginBottom: 12 }} />}

              {/* Title */}
              <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Título do widget *</label>
              <input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Custos Operacionais" style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDE4F0', fontSize: 13, color: '#0D1B35', marginBottom: 14, outline: 'none' }} />

              {/* Contas A */}
              {renderContaSelector(selectedContas, setSelectedContas, needsContasB ? 'Contas (Numerador)' : 'Contas incluídas')}

              {/* Contas B for indicador/cruzamento */}
              {needsContasB && renderContaSelector(selectedContasB, setSelectedContasB, 'Contas (Denominador)')}

              {/* Periodo for barras */}
              {needsPeriodo && (
                <>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Período</label>
                  <select value={periodoMeses} onChange={e => setPeriodoMeses(Number(e.target.value))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDE4F0', fontSize: 12, color: '#0D1B35', marginBottom: 14 }}>
                    <option value={3}>3 meses</option>
                    <option value={6}>6 meses</option>
                    <option value={12}>12 meses</option>
                  </select>
                </>
              )}

              {/* Meta for indicador */}
              {needsMeta && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Meta (%)</label>
                    <input type="number" value={metaValor} onChange={e => setMetaValor(Number(e.target.value))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDE4F0', fontSize: 12, color: '#0D1B35' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Direção</label>
                    <select value={metaDirecao} onChange={e => setMetaDirecao(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDE4F0', fontSize: 12, color: '#0D1B35' }}>
                      <option value="menor_melhor">Menor é melhor</option>
                      <option value="maior_melhor">Maior é melhor</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Formato for cruzamento */}
              {needsFormato && (
                <>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Formato do resultado</label>
                  <select value={formatoResultado} onChange={e => setFormatoResultado(e.target.value)} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDE4F0', fontSize: 12, color: '#0D1B35', marginBottom: 14 }}>
                    <option value="percentual">Percentual (%)</option>
                    <option value="indice">Índice (decimal)</option>
                  </select>
                </>
              )}

              {/* Detalhamento options */}
              {needsDetalhamento && (
                <>
                  <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Ordenar lista por</label>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 14 }}>
                    {[{ value: 'maior_primeiro', label: 'Maior valor primeiro' }, { value: 'ordem_plano', label: 'Ordem do plano de contas' }].map(opt => (
                      <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#0D1B35', cursor: 'pointer' }}>
                        <input type="radio" name="ordenacao_lista" checked={ordenacaoLista === opt.value} onChange={() => setOrdenacaoLista(opt.value)} style={{ accentColor: '#1A3CFF' }} />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80' }}>Ocultar contas com valor R$ 0</label>
                    <button
                      onClick={() => setOcultarZeros(p => !p)}
                      style={{
                        width: 38, height: 20, borderRadius: 10, padding: 2,
                        background: ocultarZeros ? '#1A3CFF' : '#DDE4F0',
                        border: 'none', cursor: 'pointer', transition: 'background 0.2s',
                        display: 'flex', alignItems: 'center',
                      }}
                    >
                      <span style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', transition: 'transform 0.2s', transform: ocultarZeros ? 'translateX(18px)' : 'translateX(0)' }} />
                    </button>
                  </div>
                </>
              )}


              {tipo !== 'detalhamento' && duplicateAlerts.length > 0 && (
                <div style={{ background: 'rgba(217,119,6,0.08)', border: '1px solid rgba(217,119,6,0.3)', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
                  {duplicateAlerts.map((a, i) => (
                    <p key={i} style={{ fontSize: 10.5, color: '#92400E' }}>⚠️ Atenção: {a}. Isso pode duplicar valores no resultado.</p>
                  ))}
                </div>
              )}

              {/* Size */}
              <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 4 }}>Tamanho</label>
              <select value={colunas} onChange={e => setColunas(Number(e.target.value))} style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #DDE4F0', fontSize: 12, color: '#0D1B35', marginBottom: 14 }}>
                <option value={1}>Pequeno — 1 coluna</option>
                <option value={2}>Médio — 2 colunas</option>
                <option value={3}>Grande — 3 colunas</option>
              </select>

              {/* Color */}
              <label style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80', display: 'block', marginBottom: 6 }}>Cor de destaque</label>
              <div className="flex gap-2 mb-5">
                {COLOR_SWATCHES.map(c => (
                  <button key={c} onClick={() => setCorDestaque(c)} style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', border: corDestaque === c ? '2px solid #0D1B35' : '2px solid transparent', transition: 'border 0.15s' }} />
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
                  style={{ padding: '8px 20px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: '#1A3CFF', color: '#fff', opacity: titulo.trim() && selectedContas.length ? 1 : 0.45, cursor: titulo.trim() && selectedContas.length ? 'pointer' : 'default' }}
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
