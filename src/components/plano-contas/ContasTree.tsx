import { useState, useRef } from 'react';
import { type ContaRow, type ContaTipo, formatCurrency, getCompetenciaAtual } from '@/lib/plano-contas-utils';
import { GripVertical, Pencil, Trash2, Plus, Check, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';

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

export function ContasTree({ contas, valoresMetas, clienteId, onRefresh }: Props) {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addingParentId, setAddingParentId] = useState<string | null>(null);
  const [addingNivel, setAddingNivel] = useState<number>(1);
  const [newName, setNewName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const tree = buildTree(contas);

  const startEdit = (id: string, nome: string) => {
    setEditingId(id);
    setEditValue(nome);
  };

  const saveEdit = async () => {
    if (!editingId || !editValue.trim()) return;
    await supabase.from('plano_de_contas').update({ nome: editValue.trim() }).eq('id', editingId);
    setEditingId(null);
    onRefresh();
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

  const renderEditOrName = (id: string, nome: string, className: string) => {
    if (editingId === id) {
      return (
        <div className="flex items-center gap-1.5">
          <Input value={editValue} onChange={(e) => setEditValue(e.target.value)} className="h-7 text-xs w-48" autoFocus onKeyDown={(e) => e.key === 'Enter' && saveEdit()} />
          <button onClick={saveEdit} className="p-1 text-green hover:bg-green/10 rounded"><Check className="h-3.5 w-3.5" /></button>
          <button onClick={() => setEditingId(null)} className="p-1 text-red hover:bg-red/10 rounded"><X className="h-3.5 w-3.5" /></button>
        </div>
      );
    }
    return <span className={className}>{nome}</span>;
  };

  const renderInlineAdd = (parentId: string, nivel: number, indentClass: string) => {
    if (addingParentId !== parentId || addingNivel !== nivel) return null;
    return (
      <div className={`flex items-center gap-2 ${indentClass} pr-4 py-2`} style={{ background: '#F0F9FF', borderBottom: '1px solid #F3F4F6' }}>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={nivel === 1 ? 'Nome do subgrupo' : 'Nome da categoria'} className="h-7 text-xs w-60" autoFocus onKeyDown={(e) => e.key === 'Enter' && saveAdd()} />
        <button onClick={saveAdd} className="p-1 text-green hover:bg-green/10 rounded"><Check className="h-3.5 w-3.5" /></button>
        <button onClick={() => setAddingParentId(null)} className="p-1 text-red hover:bg-red/10 rounded"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
  };

  const renderConta = (node: ContaNode): React.ReactNode => {
    if (node.nivel === 0) {
      return (
        <div key={node.id}>
          <div className="group flex items-center justify-between" style={{ background: '#E5E7EB', padding: '10px 16px', borderBottom: '1px solid #F3F4F6' }}>
            <div className="flex items-center gap-2 min-w-0">
              {renderEditOrName(node.id, node.nome, 'text-[13px] font-semibold uppercase tracking-wide text-[#374151]')}
            </div>
            <div className="flex items-center gap-3">
              <span style={{ color: '#8A9BBC', fontStyle: 'italic', fontSize: 11 }}>subtotal</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => startEdit(node.id, node.nome)} className="p-1 text-[#6B7280] hover:text-[#374151] rounded hover:bg-black/5" title="Editar nome">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => startAdd(node.id, 1)} className="p-1 text-[#6B7280] hover:text-[#374151] rounded hover:bg-black/5" title="Adicionar subgrupo">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          {renderInlineAdd(node.id, 1, 'px-4')}
          {node.filhos.map(renderConta)}
        </div>
      );
    }

    if (node.nivel === 1) {
      return (
        <div key={node.id}>
          <div className="group flex items-center justify-between" style={{ background: '#FFFFFF', padding: '10px 16px', borderBottom: '1px solid #F3F4F6' }}>
            <div className="flex items-center gap-2 min-w-0">
              <GripVertical className="h-4 w-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: '#D1D5DB' }} />
              {renderEditOrName(node.id, node.nome, 'text-[13px] font-semibold text-[#0D1B35]')}
            </div>
            <div className="flex items-center gap-3">
              <span style={{ color: '#8A9BBC', fontStyle: 'italic', fontSize: 11 }}>subtotal</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => startEdit(node.id, node.nome)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Editar nome">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => startAdd(node.id, 2)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Adicionar categoria">
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDelete(node.id)} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded hover:bg-red-50" title="Excluir subgrupo">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
          {renderInlineAdd(node.id, 2, 'pl-[56px]')}
          {node.filhos.map(renderConta)}
        </div>
      );
    }

    if (node.nivel === 2) {
      const hasEntradaPrefix = node.nome.startsWith('(+)');
      const hasSaidaPrefix = node.nome.startsWith('(-)');
      const isEntrada = hasEntradaPrefix || (!hasSaidaPrefix && node.tipo === 'receita');
      const displayName = node.nome.replace(/^\([+-]\)\s*/, '');
      const meta = valoresMetas[node.id] ?? null;

      return (
        <div key={node.id} className="group flex items-center justify-between" style={{ background: '#FFFFFF', padding: '8px 16px 8px 40px', borderBottom: '1px solid #F3F4F6' }}>
          <div className="flex items-center min-w-0" style={{ gap: 8 }}>
            <span style={{ color: isEntrada ? '#16A34A' : '#DC2626', fontWeight: 700, fontSize: 13 }}>
              {isEntrada ? '↑' : '↓'}
            </span>
            {renderEditOrName(node.id, displayName, 'text-[13px] font-normal text-[#0D1B35]')}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-mono text-[#6B7280] min-w-[80px] text-right">
              {meta != null ? formatCurrency(meta) : '—'}
            </span>
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button onClick={() => startEdit(node.id, node.nome)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Editar nome">
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => handleDelete(node.id)} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded hover:bg-red-50" title="Excluir categoria">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div style={{ boxShadow: 'none' }}>
      {tree.map(renderConta)}
    </div>
  );
}
