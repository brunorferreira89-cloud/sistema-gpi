import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { FileSpreadsheet, Upload, Plus, Pencil, Trash2, ArrowUp, ArrowDown, GripVertical, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseCategoriasNibo, type ResultadoParseCategorias, type CategoriaParseada } from '@/lib/nibo-categorias-parser';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from '@/components/ui/alert-dialog';

const segmentColors: Record<string, { bg: string; text: string }> = {
  alimentacao: { bg: 'bg-[#FFF7ED]', text: 'text-amber' },
  saude: { bg: 'bg-[#F0FDF4]', text: 'text-green' },
  estetica: { bg: 'bg-[#FDF4FF]', text: 'text-[#9333EA]' },
  varejo: { bg: 'bg-surface-hi', text: 'text-primary' },
  servicos: { bg: 'bg-surface-hi', text: 'text-cyan' },
  outro: { bg: 'bg-surface-hi', text: 'text-txt-sec' },
};

const segmentLabels: Record<string, string> = {
  alimentacao: 'Alimentação',
  saude: 'Saúde',
  estetica: 'Estética',
  varejo: 'Varejo',
  servicos: 'Serviços',
  outro: 'Outro',
};

export default function PlanoDeContasPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedClienteId, setSelectedClienteId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [isReimport, setIsReimport] = useState(false);

  const { data: clientes, isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('*').eq('status', 'ativo').order('nome_empresa');
      if (error) throw error;
      return data;
    },
  });

  const { data: contasCount } = useQuery({
    queryKey: ['plano-contas-count'],
    queryFn: async () => {
      const { data, error } = await supabase.from('plano_de_contas').select('cliente_id, id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach((c) => { counts[c.cliente_id] = (counts[c.cliente_id] || 0) + 1; });
      return counts;
    },
  });

  const openImport = (clienteId: string, reimport: boolean) => {
    setSelectedClienteId(clienteId);
    setIsReimport(reimport);
    setImportOpen(true);
  };

  const handleImportClose = () => {
    setImportOpen(false);
    setSelectedClienteId(null);
    setIsReimport(false);
    queryClient.invalidateQueries({ queryKey: ['plano-contas-count'] });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-txt">Plano de Contas</h2>
        <p className="text-sm text-txt-muted">Estrutura DRE por cliente</p>
      </div>

      {!clientes?.length ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <FileSpreadsheet className="h-16 w-16 text-txt-muted opacity-40" />
          <p className="text-txt-sec">Nenhum cliente cadastrado</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clientes.map((cliente) => {
            const count = contasCount?.[cliente.id] || 0;
            const seg = segmentColors[cliente.segmento] || segmentColors.outro;
            const hasPlano = count > 0;

            return (
              <div key={cliente.id} className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 transition-shadow hover:shadow-md">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-txt">{cliente.razao_social || cliente.nome_empresa}</h3>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${seg.bg} ${seg.text}`}>
                      {segmentLabels[cliente.segmento] || cliente.segmento}
                    </span>
                  </div>
                </div>

                {hasPlano ? (
                  <>
                    <p className="text-sm font-mono text-txt-sec">{count} contas</p>
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-green/10 px-2 py-0.5 text-xs font-medium text-green">Configurado</span>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => navigate(`/plano-de-contas/${cliente.id}`)}
                          className="rounded-lg bg-primary-lo px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-md"
                        >
                          Abrir
                        </button>
                        <button
                          onClick={() => openImport(cliente.id, true)}
                          className="rounded-lg border border-border px-2 py-1.5 text-xs text-txt-muted transition-colors hover:bg-surface-hi"
                          title="Reimportar plano"
                        >
                          <Upload className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-txt-muted">Nenhum plano configurado</p>
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-red/10 px-2 py-0.5 text-xs font-medium text-red">Não configurado</span>
                      <button
                        onClick={() => openImport(cliente.id, false)}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                      >
                        Importar categorias
                      </button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {selectedClienteId && (
        <ImportCategoriasDialog
          open={importOpen}
          onOpenChange={handleImportClose}
          clienteId={selectedClienteId}
          clienteNome={clientes?.find((c) => c.id === selectedClienteId)?.nome_empresa || ''}
          isReimport={isReimport}
        />
      )}
    </div>
  );
}

// =====================================================
// PLANO DE CONTAS DETAIL VIEW (used on /plano-de-contas/:id)
// =====================================================

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

export function PlanoDeContasDetail({ clienteId, contas, onRefresh }: {
  clienteId: string;
  contas: ContaRow[];
  onRefresh: () => void;
}) {
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
    const parent = contas.find((c) => c.id === addingParentId);
    const tipo = parent?.tipo || 'despesa_fixa';
    const maxOrdem = Math.max(0, ...contas.filter((c) => c.conta_pai_id === addingParentId).map((c) => c.ordem));
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

  const confirmDelete = async () => {
    if (!deleteId) return;
    // Delete children recursively
    const deleteRecursive = async (parentId: string) => {
      const children = contas.filter((c) => c.conta_pai_id === parentId);
      for (const child of children) {
        await deleteRecursive(child.id);
      }
      await supabase.from('plano_de_contas').delete().eq('id', parentId);
    };
    await deleteRecursive(deleteId);
    setDeleteId(null);
    onRefresh();
  };

  const renderInlineAdd = (parentId: string, nivel: number, indentClass: string) => {
    if (addingParentId !== parentId || addingNivel !== nivel) return null;
    return (
      <div className={`flex items-center gap-2 ${indentClass} pr-4 py-2 bg-primary/5 border-b border-[#F3F4F6]`}>
        <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={nivel === 1 ? 'Nome do subgrupo' : 'Nome da categoria'} className="h-7 text-xs w-60" autoFocus onKeyDown={(e) => e.key === 'Enter' && saveAdd()} />
        <button onClick={saveAdd} className="p-1 text-green hover:bg-green/10 rounded"><Check className="h-3.5 w-3.5" /></button>
        <button onClick={() => setAddingParentId(null)} className="p-1 text-red hover:bg-red/10 rounded"><X className="h-3.5 w-3.5" /></button>
      </div>
    );
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

  const renderConta = (node: ContaNode) => {
    if (node.nivel === 0) {
      return (
        <div key={node.id}>
          <div className="group flex items-center justify-between" style={{ background: '#E5E7EB', padding: '10px 16px', borderBottom: '1px solid #F3F4F6' }}>
            <div className="flex items-center gap-2 min-w-0">
              {renderEditOrName(node.id, node.nome, 'text-[13px] font-semibold uppercase tracking-wide' + ' text-[#374151]')}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] italic text-[#8A9BBC]">subtotal</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
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
              <GripVertical className="h-4 w-4 text-[#D1D5DB] shrink-0 opacity-0 group-hover:opacity-100" />
              {renderEditOrName(node.id, node.nome, 'text-[13px] font-semibold text-[#0D1B35]')}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[11px] italic text-[#8A9BBC]">subtotal</span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button onClick={() => startEdit(node.id, node.nome)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Editar nome">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => startAdd(node.id, 2)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Adicionar categoria">
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => setDeleteId(node.id)} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded hover:bg-red-50" title="Excluir subgrupo">
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

      return (
        <div key={node.id} className="group flex items-center justify-between" style={{ background: '#FFFFFF', padding: '8px 16px 8px 40px', borderBottom: '1px solid #F3F4F6' }}>
          <div className="flex items-center min-w-0" style={{ gap: 8 }}>
            <span style={{ color: isEntrada ? '#16A34A' : '#DC2626', fontWeight: 700, fontSize: 13 }}>
              {isEntrada ? '↑' : '↓'}
            </span>
            {renderEditOrName(node.id, displayName, 'text-[13px] font-normal text-[#0D1B35]')}
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
            <button onClick={() => startEdit(node.id, node.nome)} className="p-1 text-[#9CA3AF] hover:text-[#374151] rounded hover:bg-[#F3F4F6]" title="Editar nome">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setDeleteId(node.id)} className="p-1 text-[#9CA3AF] hover:text-[#DC2626] rounded hover:bg-red-50" title="Excluir categoria">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="space-y-0">
      {tree.map(renderConta)}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir item</AlertDialogTitle>
            <AlertDialogDescription>
              Este item e todos os seus filhos serão excluídos permanentemente. Deseja continuar?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =====================================================
// IMPORT CATEGORIAS DIALOG
// =====================================================

interface ImportProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteNome: string;
  isReimport: boolean;
}

function ImportCategoriasDialog({ open, onOpenChange, clienteId, clienteNome, isReimport }: ImportProps) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [parseResult, setParseResult] = useState<ResultadoParseCategorias | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ grupos: number; subgrupos: number; categorias: number } | null>(null);
  const queryClient = useQueryClient();

  const handleFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const result = await parseCategoriasNibo(file);
      setParseResult(result);
      if (!result.valido) {
        toast.error(result.erro || 'Erro ao processar arquivo');
      }
    } catch {
      toast.error('Erro ao processar o arquivo');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.xlsx')) handleFile(file);
    else toast.error('Apenas arquivos .xlsx são aceitos');
  }, [handleFile]);

  const handleConfirm = async () => {
    if (!parseResult || !parseResult.valido) return;
    setIsSaving(true);
    try {
      // If reimporting, delete existing plan first
      if (isReimport) {
        const { error: delErr } = await supabase.from('plano_de_contas').delete().eq('cliente_id', clienteId);
        if (delErr) throw delErr;
      }

      let ordem = 0;

      // PASSO 1: Create grupos (nivel=0)
      const grupoIdMap: Record<string, string> = {};
      for (const grupo of parseResult.grupos) {
        const tipo = parseResult.categorias.find((c) => c.grupo === grupo)?.tipo || 'despesa_fixa';
        const { data, error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: grupo,
          tipo,
          nivel: 0,
          is_total: false,
          ordem: ordem++,
          conta_pai_id: null,
        }).select('id').single();
        if (error) throw error;
        grupoIdMap[grupo] = data.id;
      }

      // PASSO 2: Create subgrupos (nivel=1)
      const subgrupoIdMap: Record<string, string> = {};
      for (const sub of parseResult.subgrupos) {
        const tipo = parseResult.categorias.find((c) => c.grupo === sub.grupo)?.tipo || 'despesa_fixa';
        const paiId = grupoIdMap[sub.grupo] || null;
        const key = `${sub.grupo}|||${sub.nome}`;
        const { data, error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: sub.nome,
          tipo,
          nivel: 1,
          is_total: false,
          ordem: ordem++,
          conta_pai_id: paiId,
        }).select('id').single();
        if (error) throw error;
        subgrupoIdMap[key] = data.id;
      }

      // PASSO 3: Create categorias (nivel=2)
      for (const cat of parseResult.categorias) {
        const subKey = `${cat.grupo}|||${cat.subgrupo}`;
        const paiId = subgrupoIdMap[subKey] || null;
        const { error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: cat.nomeLimpo,
          tipo: cat.tipo,
          nivel: 2,
          is_total: false,
          ordem: ordem++,
          conta_pai_id: paiId,
        });
        if (error) throw error;
      }

      setSaveResult({
        grupos: parseResult.grupos.length,
        subgrupos: parseResult.subgrupos.length,
        categorias: parseResult.categorias.length,
      });
      setStep(4);
      queryClient.invalidateQueries({ queryKey: ['plano-contas'] });
      queryClient.invalidateQueries({ queryKey: ['plano-contas-count'] });
    } catch (err) {
      console.error('Erro ao criar plano:', err);
      toast.error('Erro ao criar plano de contas. Verifique e tente novamente.');
      // Rollback: delete what was created in this session
      await supabase.from('plano_de_contas').delete().eq('cliente_id', clienteId);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setParseResult(null);
    setSaveResult(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && 'Importar categorias do Nibo'}
            {step === 2 && 'Visualizar estrutura'}
            {step === 3 && 'Confirmar criação'}
            {step === 4 && 'Plano criado'}
          </DialogTitle>
        </DialogHeader>

        {/* STEP 1: Upload */}
        {step === 1 && (
          <div className="space-y-4">
            {isReimport && (
              <div className="flex items-start gap-3 rounded-lg border border-amber/30 bg-amber/5 p-3">
                <span className="text-amber text-sm">⚠</span>
                <p className="text-sm text-txt-sec">Ao importar, o plano de contas existente será <strong>substituído</strong> completamente.</p>
              </div>
            )}

            <div className="text-center">
              <p className="text-xs text-txt-muted mb-4">No Nibo: <strong>Configurações → Categorias → Exportar</strong></p>
            </div>

            <div
              className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border p-12 transition-colors hover:border-primary"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              {isUploading ? (
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              ) : (
                <>
                  <Upload className="h-12 w-12 text-txt-muted" />
                  <p className="text-sm text-txt-sec text-center">Arraste o arquivo de categorias exportado do Nibo</p>
                  <p className="text-xs text-txt-muted">Cliente: <strong>{clienteNome}</strong></p>
                  <label className="cursor-pointer">
                    <Button variant="outline" size="sm" asChild>
                      <span><FileSpreadsheet className="mr-2 h-4 w-4" />Selecionar arquivo</span>
                    </Button>
                    <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                  </label>
                </>
              )}
            </div>

            {parseResult && parseResult.valido && (
              <div className="space-y-3">
                <div className="rounded-lg border border-green/30 bg-green/5 p-4">
                  <p className="text-sm font-medium text-txt">✓ {parseResult.grupos.length} grupos · {parseResult.subgrupos.length} subgrupos · {parseResult.categorias.length} categorias encontradas</p>
                </div>
                {parseResult.avisos.length > 0 && (
                  <div className="rounded-lg border border-amber/30 bg-amber/5 p-3">
                    {parseResult.avisos.map((a, i) => (
                      <p key={i} className="text-xs text-amber">⚠ {a}</p>
                    ))}
                  </div>
                )}
                <Button onClick={() => setStep(2)}>Visualizar estrutura →</Button>
              </div>
            )}

            {parseResult && !parseResult.valido && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm text-destructive">{parseResult.erro}</p>
              </div>
            )}
          </div>
        )}

        {/* STEP 2: Preview */}
        {step === 2 && parseResult && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border overflow-hidden max-h-[55vh] overflow-y-auto">
              {parseResult.grupos.map((grupo) => {
                const subs = parseResult.subgrupos.filter((s) => s.grupo === grupo);
                return (
                  <div key={grupo}>
                    <div className="bg-[#E5E7EB] px-4 py-2.5 border-b border-[#F3F4F6]">
                      <span className="text-xs font-semibold uppercase tracking-wide text-txt">{grupo}</span>
                    </div>
                    {subs.map((sub) => {
                      const cats = parseResult.categorias.filter((c) => c.grupo === grupo && c.subgrupo === sub.nome);
                      return (
                        <div key={`${grupo}|||${sub.nome}`}>
                          <div className="flex items-center gap-2 px-4 py-2.5 bg-white border-b border-[#F3F4F6]">
                            <GripVertical className="h-4 w-4 text-[#D1D5DB]" />
                            <span className="text-sm font-bold text-txt">{sub.nome}</span>
                          </div>
                          {cats.map((cat, idx) => (
                            <div key={idx} className="flex items-center gap-2 pl-10 pr-4 py-2 bg-white border-b border-[#F3F4F6]">
                              <span className="text-[#9CA3AF]">└─</span>
                              {cat.prefixo === '+' ? (
                                <ArrowUp className="h-3.5 w-3.5 text-[#16A34A] shrink-0" />
                              ) : (
                                <ArrowDown className="h-3.5 w-3.5 text-[#DC2626] shrink-0" />
                              )}
                              <span className="text-sm text-txt">{cat.nomeLimpo}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(1)}>← Voltar</Button>
              <Button onClick={handleConfirm} disabled={isSaving}>
                {isSaving ? 'Criando plano...' : 'Confirmar e criar plano'}
              </Button>
            </div>
          </div>
        )}

        {/* STEP 4: Success */}
        {step === 4 && saveResult && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl border border-green/30 bg-green/5 p-5">
              <span className="text-green text-xl">✓</span>
              <div>
                <h3 className="text-sm font-bold text-txt">Plano criado com sucesso</h3>
                <p className="text-sm text-txt-sec mt-1">{saveResult.grupos} grupos · {saveResult.subgrupos} subgrupos · {saveResult.categorias} categorias</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleClose}>Ver plano de contas</Button>
              <Button variant="outline" onClick={handleClose}>Fechar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
