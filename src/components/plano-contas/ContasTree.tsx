import { useState, useRef } from 'react';
import { type ContaRow, type ContaTipo, tipoBadgeColors, tipoLabels, formatCurrency, getCompetenciaAtual } from '@/lib/plano-contas-utils';
import { ChevronRight, ChevronDown, GripVertical, Pencil, Trash2, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
}) {
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaValue, setMetaValue] = useState<string>(meta != null ? String(meta) : '');
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(conta.nome);
  const [editingTipo, setEditingTipo] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-1 border-b border-border/40 py-2 pr-2 hover:bg-surface-hi/50"
    >
      <button {...attributes} {...listeners} className="cursor-grab p-1 text-txt-muted opacity-0 group-hover:opacity-100">
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <div style={{ width: (conta.nivel - 1) * 20 }} className="shrink-0" />

      <button onClick={onToggle} className="w-5 shrink-0 text-txt-muted">
        {hasChildren ? (collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />) : null}
      </button>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        {editingName ? (
          <div className="flex items-center gap-1">
            <input
              className="rounded border border-primary bg-surface-hi px-1.5 py-0.5 text-sm text-txt outline-none"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value)}
              onBlur={handleNameSubmit}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); if (e.key === 'Escape') setEditingName(false); }}
              autoFocus
            />
          </div>
        ) : (
          <span className={`truncate text-sm ${conta.is_total || conta.nivel === 1 ? 'font-bold text-txt' : 'text-txt-sec'}`}>
            {conta.nome}
          </span>
        )}
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
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {editingMeta ? (
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
        )}

        {meta != null ? (
          <span className="rounded-full bg-green/10 px-1.5 py-0.5 text-[10px] font-medium text-green">✓ definida</span>
        ) : (
          <span className="rounded-full bg-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-amber">pendente</span>
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

  // Sync when contas prop changes
  if (contas !== orderedContas && contas.length !== orderedContas.length) {
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

  const toggleCollapse = (id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Flatten visible contas
  const getVisibleContas = (): ContaRow[] => {
    const result: ContaRow[] = [];
    const isAncestorCollapsed = (conta: ContaRow): boolean => {
      if (!conta.conta_pai_id) return false;
      if (collapsedIds.has(conta.conta_pai_id)) return true;
      const parent = orderedContas.find((c) => c.id === conta.conta_pai_id);
      return parent ? isAncestorCollapsed(parent) : false;
    };
    orderedContas.forEach((c) => {
      if (!isAncestorCollapsed(c)) result.push(c);
    });
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

    // Update order in DB
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={visibleContas.map((c) => c.id)} strategy={verticalListSortingStrategy}>
        <div className="rounded-xl border border-border bg-surface">
          <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-semibold uppercase text-txt-muted">
            <span className="w-10" />
            <span className="flex-1">Conta</span>
            <span className="w-28 text-right">Meta mensal</span>
            <span className="w-20">Status</span>
            <span className="w-16" />
          </div>
          {visibleContas.map((conta) => (
            <SortableRow
              key={conta.id}
              conta={conta}
              meta={valoresMetas[conta.id] ?? null}
              collapsed={collapsedIds.has(conta.id)}
              hasChildren={childrenMap.has(conta.id) && (childrenMap.get(conta.id)?.length || 0) > 0}
              onToggle={() => toggleCollapse(conta.id)}
              onMetaSave={handleMetaSave}
              onDelete={handleDelete}
              onRename={handleRename}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
