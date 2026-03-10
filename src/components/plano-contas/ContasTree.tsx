import { useState, useRef } from 'react';
import { type ContaRow, type ContaTipo, tipoBadgeColors, tipoLabels, formatCurrency, getCompetenciaAtual } from '@/lib/plano-contas-utils';
import { ChevronRight, ChevronDown, GripVertical, Pencil, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface Props {
  contas: ContaRow[];
  valoresMetas: Record<string, number | null>;
  clienteId: string;
  onRefresh: () => void;
}

const nivelLabels: Record<number, { label: string; color: string }> = {
  1: { label: 'Categoria DRE', color: 'bg-primary/10 text-primary border-primary/20' },
  2: { label: 'Grupo', color: 'bg-amber/10 text-amber border-amber/20' },
  3: { label: 'Conta', color: 'bg-muted text-txt-sec border-border' },
};

function SortableRow({
  conta,
  meta,
  collapsed,
  hasChildren,
  onToggle,
  onMetaSave,
  onDelete,
  onRename,
  onChangeTipo,
  onChangeNivel,
}: {
  conta: ContaRow;
  meta: number | null;
  collapsed: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  onMetaSave: (contaId: string, valor: number | null) => void;
  onDelete: (contaId: string) => void;
  onRename: (contaId: string, nome: string) => void;
  onChangeTipo: (contaId: string, tipo: ContaTipo) => void;
  onChangeNivel: (contaId: string, nivel: number) => void;
}) {
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaValue, setMetaValue] = useState<string>(meta != null ? String(meta) : '');
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(conta.nome);
  const [editingTipo, setEditingTipo] = useState(false);
  const [editingNivel, setEditingNivel] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const isGroup = conta.nivel === 2;
  const isCategoryHeader = conta.nivel === 1 || conta.is_total;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: conta.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  const handleMetaSubmit = () => {
    const val = metaValue.trim() ? Number(metaValue) : null;
    onMetaSave(conta.id, val);
    setEditingMeta(false);
  };

  const handleNameSubmit = () => {
    if (nameValue.trim() && nameValue !== conta.nome) {
      onRename(conta.id, nameValue.trim());
    }
    setEditingName(false);
  };

  const nivelInfo = nivelLabels[conta.nivel] || nivelLabels[3];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group flex items-center gap-1 border-b py-2 pr-2 ${
        isGroup
          ? 'border-border bg-surface-hi/60'
          : isCategoryHeader
            ? 'border-border bg-primary/5'
            : 'border-border/40 hover:bg-surface-hi/50'
      }`}
    >
      <button {...attributes} {...listeners} className="cursor-grab p-1 text-txt-muted opacity-0 group-hover:opacity-100">
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div style={{ width: (conta.nivel - 1) * 20 }} className="shrink-0" />

      {/* Collapse toggle for groups */}
      <button onClick={onToggle} className="w-5 shrink-0 text-txt-muted">
        {hasChildren ? (
          collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />
        ) : null}
      </button>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        {editingName ? (
          <input
            className="rounded border border-primary bg-surface-hi px-1.5 py-0.5 text-sm text-txt outline-none"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') setEditingName(false); }}
            autoFocus
          />
        ) : (
          <span className={`truncate text-sm ${
            isCategoryHeader
              ? 'font-bold text-txt uppercase tracking-wide text-xs'
              : isGroup
                ? 'font-semibold text-txt'
                : 'text-txt-sec'
          }`}>
            {conta.nome}
          </span>
        )}

        {/* Tipo badge */}
        {editingTipo ? (
          <select
            className="shrink-0 rounded border border-primary bg-surface-hi px-1.5 py-0.5 text-[10px] font-medium text-txt outline-none"
            value={conta.tipo}
            onChange={(e) => { onChangeTipo(conta.id, e.target.value as ContaTipo); setEditingTipo(false); }}
            onBlur={() => setEditingTipo(false)}
            autoFocus
          >
            {Object.entries(tipoLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setEditingTipo(true)}
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer hover:ring-1 hover:ring-primary/50 ${tipoBadgeColors[conta.tipo as ContaTipo]}`}
          >
            {tipoLabels[conta.tipo as ContaTipo]}
          </button>
        )}

        {/* Nivel badge */}
        {editingNivel ? (
          <select
            className="shrink-0 rounded border border-primary bg-surface-hi px-1.5 py-0.5 text-[10px] font-medium text-txt outline-none"
            value={conta.nivel}
            onChange={(e) => { onChangeNivel(conta.id, Number(e.target.value)); setEditingNivel(false); }}
            onBlur={() => setEditingNivel(false)}
            autoFocus
          >
            <option value={1}>N1 — Categoria DRE</option>
            <option value={2}>N2 — Grupo</option>
            <option value={3}>N3 — Conta</option>
          </select>
        ) : (
          <button
            onClick={() => setEditingNivel(true)}
            className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium cursor-pointer hover:ring-1 hover:ring-primary/50 ${nivelInfo.color}`}
          >
            N{conta.nivel}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Meta editing - only for leaf accounts (nivel 3) */}
        {conta.nivel >= 3 || (!hasChildren) ? (
          editingMeta ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-txt-muted">R$</span>
              <input
                ref={inputRef}
                type="number"
                className="w-24 rounded border border-primary bg-surface-hi px-2 py-0.5 text-right font-mono text-sm text-txt outline-none"
                value={metaValue}
                onChange={(e) => setMetaValue(e.target.value)}
                onBlur={handleMetaSubmit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleMetaSubmit();
                  if (e.key === 'Escape') { setEditingMeta(false); setMetaValue(meta != null ? String(meta) : ''); }
                }}
                autoFocus
              />
            </div>
          ) : (
            <button
              onClick={() => { setEditingMeta(true); setMetaValue(meta != null ? String(meta) : ''); }}
              className="min-w-[80px] text-right font-mono text-sm text-txt-sec hover:text-primary"
            >
              {meta != null ? formatCurrency(meta) : '—'}
            </button>
          )
        ) : (
          <span className="min-w-[80px] text-right font-mono text-[11px] text-txt-muted italic">subtotal</span>
        )}

        {meta != null && conta.nivel >= 3 ? (
          <span className="rounded-full bg-green/10 px-1.5 py-0.5 text-[10px] font-medium text-green">✓ definida</span>
        ) : conta.nivel >= 3 ? (
          <span className="rounded-full bg-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-amber">pendente</span>
        ) : (
          <span className="w-[60px]" />
        )}

        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
          <button onClick={() => setEditingName(true)} className="rounded p-1 text-txt-muted hover:text-primary">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => onDelete(conta.id)} className="rounded p-1 text-txt-muted hover:text-red">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContasTree({ contas, valoresMetas, clienteId, onRefresh }: Props) {
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [orderedContas, setOrderedContas] = useState(contas);
  const queryClient = useQueryClient();

  if (contas !== orderedContas) {
    setOrderedContas(contas);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const childrenMap = new Map<string | null, string[]>();
  orderedContas.forEach((c) => {
    const parentKey = c.conta_pai_id || '__root__';
    if (!childrenMap.has(parentKey)) childrenMap.set(parentKey, []);
    childrenMap.get(parentKey)!.push(c.id);
  });

  // Also detect children by nivel adjacency (for flat imports without conta_pai_id)
  const hasChildrenByNivel = (index: number): boolean => {
    const conta = orderedContas[index];
    const next = orderedContas[index + 1];
    return !!next && next.nivel > conta.nivel;
  };

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const getVisibleContas = (): ContaRow[] => {
    const result: ContaRow[] = [];
    let skipUntilNivel = -1;

    for (let i = 0; i < orderedContas.length; i++) {
      const c = orderedContas[i];

      // If we're skipping children of a collapsed group
      if (skipUntilNivel >= 0) {
        if (c.nivel > skipUntilNivel) continue;
        else skipUntilNivel = -1;
      }

      result.push(c);

      // If this item is collapsed, skip its children
      if (collapsedIds.has(c.id)) {
        skipUntilNivel = c.nivel;
      }
    }

    return result;
  };

  const visibleContas = getVisibleContas();

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedContas.findIndex((c) => c.id === active.id);
    const newIndex = orderedContas.findIndex((c) => c.id === over.id);
    const newOrder = arrayMove(orderedContas, oldIndex, newIndex);
    setOrderedContas(newOrder);

    const updates = newOrder.map((c, i) => ({ id: c.id, ordem: i, cliente_id: c.cliente_id, nome: c.nome, tipo: c.tipo, nivel: c.nivel }));
    for (const u of updates) {
      await supabase.from('plano_de_contas').update({ ordem: u.ordem }).eq('id', u.id);
    }
  };

  const handleMetaSave = async (contaId: string, valor: number | null) => {
    const comp = getCompetenciaAtual();
    if (valor !== null) {
      await supabase.from('valores_mensais').upsert(
        { conta_id: contaId, competencia: comp, valor_meta: valor },
        { onConflict: 'conta_id,competencia' }
      );
    }
    queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
    queryClient.invalidateQueries({ queryKey: ['metas-pendentes'] });
    onRefresh();
  };

  const handleDelete = async (contaId: string) => {
    if (!confirm('Excluir esta conta?')) return;
    const { error } = await supabase.from('plano_de_contas').delete().eq('id', contaId);
    if (error) { toast.error('Erro ao excluir'); return; }
    toast.success('Conta excluída');
    onRefresh();
  };

  const handleRename = async (contaId: string, nome: string) => {
    await supabase.from('plano_de_contas').update({ nome }).eq('id', contaId);
    onRefresh();
  };

  const handleChangeTipo = async (contaId: string, tipo: ContaTipo) => {
    await supabase.from('plano_de_contas').update({ tipo }).eq('id', contaId);
    onRefresh();
  };

  const handleChangeNivel = async (contaId: string, nivel: number) => {
    await supabase.from('plano_de_contas').update({ nivel }).eq('id', contaId);
    onRefresh();
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={visibleContas.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="rounded-xl border border-border bg-surface">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-border px-4 py-2.5 text-xs font-semibold uppercase text-txt-muted tracking-wider">
            <span className="w-10" />
            <span className="flex-1">Conta</span>
            <span className="w-28 text-right">Meta mensal</span>
            <span className="w-[60px]">Status</span>
            <span className="w-16" />
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 border-b border-border/50 px-4 py-1.5 bg-muted/30">
            <span className="text-[10px] text-txt-muted">Legenda:</span>
            {Object.entries(nivelLabels).map(([n, info]) => (
              <span key={n} className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${info.color}`}>
                N{n} — {info.label}
              </span>
            ))}
          </div>

          {visibleContas.map((conta, idx) => {
            const globalIdx = orderedContas.findIndex((c) => c.id === conta.id);
            const hasKids = (childrenMap.has(conta.id) && (childrenMap.get(conta.id)?.length || 0) > 0) || hasChildrenByNivel(globalIdx);

            return (
              <SortableRow
                key={conta.id}
                conta={conta}
                meta={valoresMetas[conta.id] ?? null}
                collapsed={collapsedIds.has(conta.id)}
                hasChildren={hasKids}
                onToggle={() => toggleCollapse(conta.id)}
                onMetaSave={handleMetaSave}
                onDelete={handleDelete}
                onRename={handleRename}
                onChangeTipo={handleChangeTipo}
                onChangeNivel={handleChangeNivel}
              />
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}
