import { useState, useCallback, useMemo } from 'react';
import { type ContaRow, formatCurrency, getCompetenciaAtual } from '@/lib/plano-contas-utils';
import { GripVertical, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { EditContaDialog } from './EditContaDialog';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';


interface Props {
  contas: ContaRow[];
  valoresMetas: Record<string, number | null>;
  clienteId: string;
  onRefresh: () => void;
}

type ContaNode = ContaRow & { filhos: ContaNode[] };

function buildTree(contas: ContaRow[]): ContaNode[] {
  const map = new Map<string, ContaNode>();
  const roots: ContaNode[] = [];
  contas.forEach(c => map.set(c.id, { ...c, filhos: [] }));
  contas.forEach(c => {
    const node = map.get(c.id)!;
    if (c.conta_pai_id && map.has(c.conta_pai_id)) {
      map.get(c.conta_pai_id)!.filhos.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortNodes = (nodes: ContaNode[]) => {
    nodes.sort((a, b) => a.ordem - b.ordem);
    nodes.forEach(n => sortNodes(n.filhos));
  };
  sortNodes(roots);
  return roots;
}

// ─── Sortable row wrapper ───────────────────────────
function SortableRow({ id, children, nivel }: { id: string; children: React.ReactNode; nivel: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    outline: isDragging ? '2px dashed #1A3CFF' : 'none',
    position: 'relative' as const,
    zIndex: isDragging ? 10 : 'auto',
  };
  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      {typeof children === 'function' ? (children as any)(listeners) : children}
    </div>
  );
}

export function ContasTree({ contas, valoresMetas, clienteId, onRefresh }: Props) {
  const queryClient = useQueryClient();
  const [addingParentId, setAddingParentId] = useState<string | null>(null);
  const [addingNivel, setAddingNivel] = useState<number>(1);
  const [newName, setNewName] = useState('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingConta, setEditingConta] = useState<ContaRow | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  const tree = buildTree(contas);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const openEditDialog = (conta: ContaRow) => {
    setEditingConta(conta);
    setEditDialogOpen(true);
  };

  const startAdd = (parentId: string | null, nivel: number) => {
    setAddingParentId(parentId);
    setAddingNivel(nivel);
    setNewName('');
  };

  const saveAdd = async () => {
    if (!newName.trim()) return;
    const parent = contas.find(c => c.id === addingParentId);
    const tipo = parent?.tipo || 'despesa_fixa';
    const maxOrdem = Math.max(0, ...contas.filter(c => c.conta_pai_id === addingParentId).map(c => c.ordem));
    await supabase.from('plano_de_contas').insert({
      cliente_id: clienteId,
      nome: newName.trim(),
      tipo,
      nivel: addingNivel,
      is_total: false,
      ordem: maxOrdem + 1,
      conta_pai_id: addingParentId,
    });
    setAddingParentId(null);
    setNewName('');
    onRefresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este item e todos os seus filhos?')) return;
    const deleteRecursive = async (parentId: string) => {
      const children = contas.filter(c => c.conta_pai_id === parentId);
      for (const child of children) {
        await deleteRecursive(child.id);
      }
      await supabase.from('plano_de_contas').delete().eq('id', parentId);
    };
    await deleteRecursive(id);
    toast.success('Item excluído');
    onRefresh();
  };

  // ─── Drag-and-drop handler ───────────────────────────
  const handleDragStart = (event: DragStartEvent) => {
    setActiveDragId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeItem = contas.find(c => c.id === active.id);
    const overItem = contas.find(c => c.id === over.id);
    if (!activeItem || !overItem) return;

    // Only allow reordering within same parent and same nivel
    if (activeItem.conta_pai_id !== overItem.conta_pai_id || activeItem.nivel !== overItem.nivel) return;

    // Get siblings in current order
    const parentId = activeItem.conta_pai_id;
    const nivel = activeItem.nivel;
    let siblings: ContaNode[];

    if (nivel === 0) {
      siblings = tree;
    } else {
      // Find siblings from flat contas
      const siblingContas = contas
        .filter(c => c.conta_pai_id === parentId && c.nivel === nivel)
        .sort((a, b) => a.ordem - b.ordem);
      siblings = siblingContas.map(c => ({ ...c, filhos: [] }));
    }

    const oldIndex = siblings.findIndex(s => s.id === active.id);
    const newIndex = siblings.findIndex(s => s.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    // Reorder
    const reordered = [...siblings];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    // Persist new order
    const updates = reordered.map((item, idx) => 
      supabase.from('plano_de_contas').update({ ordem: idx }).eq('id', item.id)
    );
    await Promise.all(updates);
    onRefresh();
  };

  // ─── Inline add row ───────────────────────────
  const renderInlineAdd = (parentId: string, nivel: number, indentClass: string) => {
    if (addingParentId !== parentId || addingNivel !== nivel) return null;
    return (
      <div className={`flex items-center gap-2 ${indentClass} pr-4 py-2`} style={{ background: '#F0F9FF', borderBottom: '1px solid #F3F4F6' }}>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={nivel === 1 ? 'Nome do subgrupo' : 'Nome da categoria'} className="h-7 text-xs w-60" autoFocus onKeyDown={(e) => e.key === 'Enter' && saveAdd()} />
        <button onClick={saveAdd} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check className="h-3.5 w-3.5" /></button>
        <button onClick={() => setAddingParentId(null)} className="p-1 text-red-600 hover:bg-red-50 rounded"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  };

  // ─── Render nivel=2 category row ───────────────────────────
  const renderCategoria = (node: ContaNode, listeners?: any) => {
    const hasEntradaPrefix = node.nome.startsWith('(+)');
    const hasSaidaPrefix = node.nome.startsWith('(-)');
    const isEntrada = hasEntradaPrefix || (!hasSaidaPrefix && node.tipo === 'receita');
    const displayName = node.nome.replace(/^\([+-]\)\s*/, '');
    const meta = valoresMetas[node.id] ?? null;

    return (
      <div className="group flex items-center justify-between" style={{ background: '#FFFFFF', padding: '8px 16px 8px 40px', borderBottom: '1px solid #F3F4F6' }}>
        <div className="flex items-center min-w-0" style={{ gap: 8 }}>
          <GripVertical
            className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
            style={{ color: '#8A9BBC' }}
            {...(listeners || {})}
          />
          <span style={{ color: isEntrada ? '#16A34A' : '#DC2626', fontWeight: 700, fontSize: 13 }}>
            {isEntrada ? '↑' : '↓'}
          </span>
          <span className="text-[13px] font-normal" style={{ color: '#0D1B35' }}>{displayName}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-mono min-w-[80px] text-right" style={{ color: '#6B7280' }}>
            {meta != null ? formatCurrency(meta) : '—'}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => openEditDialog(node)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Editar">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => handleDelete(node.id)} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded hover:bg-red-50" title="Excluir">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ─── Render nivel=1 subgroup ───────────────────────────
  const renderSubgrupo = (node: ContaNode, listeners?: any) => {
    const catIds = node.filhos.map(f => f.id);
    return (
      <div>
        <div className="group flex items-center justify-between" style={{ background: '#FFFFFF', padding: '10px 16px', borderBottom: '1px solid #F3F4F6' }}>
          <div className="flex items-center gap-2 min-w-0">
            <GripVertical
              className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
              style={{ color: '#8A9BBC' }}
              {...(listeners || {})}
            />
            <span className="text-[13px] font-semibold" style={{ color: '#0D1B35' }}>{node.nome}</span>
          </div>
          <div className="flex items-center gap-3">
            <span style={{ color: '#8A9BBC', fontStyle: 'italic', fontSize: 11 }}>subtotal</span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => openEditDialog(node)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Editar">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => startAdd(node.id, 2)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Adicionar categoria">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => handleDelete(node.id)} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded hover:bg-red-50" title="Excluir">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        {renderInlineAdd(node.id, 2, 'pl-[56px]')}
        {/* Sortable categories */}
        <SortableContext items={catIds} strategy={verticalListSortingStrategy}>
          {node.filhos.map(cat => (
            <SortableRow key={cat.id} id={cat.id} nivel={2}>
              {(dragListeners: any) => renderCategoria(cat, dragListeners)}
            </SortableRow>
          ))}
        </SortableContext>
      </div>
    );
  };

  // ─── Render nivel=0 group ───────────────────────────
  const renderGrupo = (node: ContaNode, listeners?: any) => {
    const subIds = node.filhos.map(f => f.id);
    return (
      <div>
        <div className="group flex items-center justify-between" style={{ background: '#E5E7EB', padding: '10px 16px', borderBottom: '1px solid #F3F4F6' }}>
          <div className="flex items-center gap-2 min-w-0">
            <GripVertical
              className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing"
              style={{ color: '#8A9BBC' }}
              {...(listeners || {})}
            />
            <span className="text-[13px] font-semibold uppercase tracking-wide" style={{ color: '#374151' }}>{node.nome}</span>
          </div>
          <div className="flex items-center gap-3">
            <span style={{ color: '#8A9BBC', fontStyle: 'italic', fontSize: 11 }}>subtotal</span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => openEditDialog(node)} className="p-1 text-[#6B7280] hover:text-[#374151] rounded hover:bg-black/5" title="Editar">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => startAdd(node.id, 1)} className="p-1 text-[#6B7280] hover:text-[#374151] rounded hover:bg-black/5" title="Adicionar subgrupo">
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        {renderInlineAdd(node.id, 1, 'px-4')}
        {/* Sortable subgroups */}
        <SortableContext items={subIds} strategy={verticalListSortingStrategy}>
          {node.filhos.map(sub => (
            <SortableRow key={sub.id} id={sub.id} nivel={1}>
              {(dragListeners: any) => renderSubgrupo(sub, dragListeners)}
            </SortableRow>
          ))}
        </SortableContext>
      </div>
    );
  };

  const rootIds = tree.map(t => t.id);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        modifiers={[restrictToVerticalAxis]}
      >
        <div style={{ boxShadow: 'none' }}>
          <SortableContext items={rootIds} strategy={verticalListSortingStrategy}>
            {tree.map(grupo => (
              <SortableRow key={grupo.id} id={grupo.id} nivel={0}>
                {(dragListeners: any) => renderGrupo(grupo, dragListeners)}
              </SortableRow>
            ))}
          </SortableContext>
        </div>
      </DndContext>

      <EditContaDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        conta={editingConta}
        contas={contas}
        onSaved={onRefresh}
      />
    </>
  );
}
