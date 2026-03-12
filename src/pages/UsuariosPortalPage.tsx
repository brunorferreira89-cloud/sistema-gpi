import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Search, Plus, Pencil, Trash2, Copy, Check, ChevronDown, MessageCircle } from 'lucide-react';

interface PortalUser {
  id: string;
  nome: string | null;
  email: string | null;
  created_at: string;
  role: string;
  empresas: { cliente_id: string; nome_empresa: string; razao_social: string | null; ativo: boolean; empresa_padrao: boolean }[];
  anyActive: boolean;
}

export default function UsuariosPortalPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const preselectedCliente = searchParams.get('cliente');
  const highlightUsuario = searchParams.get('usuario');

  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(() => !!preselectedCliente);
  const [editingUser, setEditingUser] = useState<PortalUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<PortalUser | null>(null);

  // Post-creation state
  const [createdInfo, setCreatedInfo] = useState<{ nome: string; email: string; senha: string | null } | null>(null);

  // Fetch all portal users with their linked companies
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['portal-users-all'],
    queryFn: async () => {
      // Get all client profiles
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, nome, email, created_at, role')
        .eq('role', 'cliente')
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;
      if (!profiles?.length) return [] as PortalUser[];

      const userIds = profiles.map((p) => p.id);

      // Get all portal_usuario_clientes links
      const { data: links, error: lErr } = await supabase
        .from('portal_usuario_clientes' as any)
        .select('usuario_id, cliente_id, ativo, empresa_padrao')
        .in('usuario_id', userIds);
      if (lErr) throw lErr;

      // Get all clientes for names
      const clienteIds = [...new Set((links as any[] || []).map((l: any) => l.cliente_id))];
      let clientesMap: Record<string, { nome_empresa: string; razao_social: string | null }> = {};
      if (clienteIds.length) {
        const { data: clientes } = await supabase
          .from('clientes')
          .select('id, nome_empresa, razao_social')
          .in('id', clienteIds);
        (clientes || []).forEach((c) => {
          clientesMap[c.id] = { nome_empresa: c.nome_empresa, razao_social: c.razao_social };
        });
      }

      return profiles.map((p): PortalUser => {
        const userLinks = ((links as any[]) || []).filter((l: any) => l.usuario_id === p.id);
        const empresas = userLinks.map((l: any) => ({
          cliente_id: l.cliente_id,
          nome_empresa: clientesMap[l.cliente_id]?.nome_empresa || '?',
          razao_social: clientesMap[l.cliente_id]?.razao_social || null,
          ativo: l.ativo,
          empresa_padrao: l.empresa_padrao,
        }));
        return {
          ...p,
          empresas,
          anyActive: empresas.some((e) => e.ativo),
        };
      });
    },
  });

  const filtered = users.filter((u) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (u.nome?.toLowerCase().includes(q)) || (u.email?.toLowerCase().includes(q));
  });

  const handleDelete = async () => {
    if (!deleteUser) return;
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: { action: 'delete', user_id: deleteUser.id },
      });
      if (res.error || !res.data?.success) throw new Error(res.data?.error || 'Erro');
      queryClient.invalidateQueries({ queryKey: ['portal-users-all'] });
      setDeleteUser(null);
      toast({ title: 'Usuário removido.' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-txt">👥 Usuários do Portal</h1>
        <Button className="gap-2" onClick={() => { setEditingUser(null); setCreatedInfo(null); setModalOpen(true); }}>
          <Plus className="h-4 w-4" /> Novo Usuário
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-txt-muted" />
        <Input
          placeholder="Buscar por nome ou e-mail..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-12 text-center">
          <p className="text-sm text-txt-muted">Nenhum usuário encontrado.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Empresas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => (
                <TableRow key={u.id} className={highlightUsuario === u.id ? 'bg-primary/5' : ''}>
                  <TableCell className="font-medium text-txt">{u.nome || '—'}</TableCell>
                  <TableCell className="text-sm text-txt-muted">{u.email || '—'}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.empresas.slice(0, 2).map((e) => (
                        <Badge key={e.cliente_id} variant="outline" className="text-[10px]">
                          {e.razao_social || e.nome_empresa}
                        </Badge>
                      ))}
                      {u.empresas.length > 2 && (
                        <Badge variant="outline" className="text-[10px] text-txt-muted">
                          +{u.empresas.length - 2}
                        </Badge>
                      )}
                      {u.empresas.length === 0 && <span className="text-xs text-txt-muted">—</span>}
                    </div>
                  </TableCell>
                  <TableCell>
                    {u.anyActive ? (
                      <Badge className="bg-green-500/10 text-green-600 border-green-500/30 text-[10px]" variant="outline">● Ativo</Badge>
                    ) : (
                      <Badge className="text-txt-muted text-[10px]" variant="outline">○ Inativo</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-txt-muted">
                    {new Date(u.created_at).toLocaleDateString('pt-BR')}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => { setEditingUser(u); setCreatedInfo(null); setModalOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setDeleteUser(u)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Modal */}
      <UsuarioFormModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        editingUser={editingUser}
        preselectedClienteId={preselectedCliente}
        onCreated={(info) => {
          setCreatedInfo(info);
          queryClient.invalidateQueries({ queryKey: ['portal-users-all'] });
        }}
        onUpdated={() => {
          queryClient.invalidateQueries({ queryKey: ['portal-users-all'] });
          setModalOpen(false);
        }}
      />

      {/* Post-creation message card */}
      {createdInfo && (
        <MensagemAcessoModal
          open={!!createdInfo}
          onOpenChange={(o) => { if (!o) setCreatedInfo(null); }}
          nome={createdInfo.nome}
          email={createdInfo.email}
          senha={createdInfo.senha}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={(o) => { if (!o) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {deleteUser?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação remove o acesso ao portal de todas as empresas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Remover
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── Form Modal (Create / Edit) ─────────────────────── */

function UsuarioFormModal({
  open, onOpenChange, editingUser, preselectedClienteId, onCreated, onUpdated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  editingUser: PortalUser | null;
  preselectedClienteId: string | null;
  onCreated: (info: { nome: string; email: string; senha: string | null }) => void;
  onUpdated: () => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [selectedClientes, setSelectedClientes] = useState<string[]>([]);
  const [empresaPadrao, setEmpresaPadrao] = useState<string>('');
  const [clienteSearch, setClienteSearch] = useState('');
  const [loading, setLoading] = useState(false);

  const isEditing = !!editingUser;

  // Fetch all active clientes
  const { data: allClientes = [] } = useQuery({
    queryKey: ['all-clientes-for-portal'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('id, nome_empresa, razao_social')
        .eq('status', 'ativo')
        .order('razao_social', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: open,
  });

  // Reset form when modal opens
  const resetForm = useCallback(() => {
    if (editingUser) {
      setNome(editingUser.nome || '');
      setEmail(editingUser.email || '');
      setSenha('');
      setSelectedClientes(editingUser.empresas.map((e) => e.cliente_id));
      setEmpresaPadrao(editingUser.empresas.find((e) => e.empresa_padrao)?.cliente_id || editingUser.empresas[0]?.cliente_id || '');
    } else {
      setNome('');
      setEmail('');
      setSenha('');
      setSelectedClientes(preselectedClienteId ? [preselectedClienteId] : []);
      setEmpresaPadrao(preselectedClienteId || '');
    }
    setClienteSearch('');
    setLoading(false);
  }, [editingUser, preselectedClienteId]);

  // Reset on open change
  const handleOpenChange = (o: boolean) => {
    if (o) resetForm();
    onOpenChange(o);
  };

  // Also reset when editingUser changes while open
  useState(() => { if (open) resetForm(); });

  const filteredClientes = allClientes.filter((c) => {
    if (!clienteSearch) return true;
    const q = clienteSearch.toLowerCase();
    return (c.razao_social?.toLowerCase().includes(q)) || c.nome_empresa.toLowerCase().includes(q);
  });

  const toggleCliente = (id: string) => {
    setSelectedClientes((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (!next.includes(empresaPadrao)) setEmpresaPadrao(next[0] || '');
      return next;
    });
  };

  const handleSave = async () => {
    if (!nome.trim() || !email.trim()) {
      toast({ title: 'Preencha nome e e-mail', variant: 'destructive' });
      return;
    }
    if (selectedClientes.length === 0) {
      toast({ title: 'Selecione pelo menos uma empresa', variant: 'destructive' });
      return;
    }
    if (!isEditing && senha.length < 6) {
      toast({ title: 'A senha deve ter pelo menos 6 caracteres', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      if (isEditing) {
        // Update profile
        await supabase.from('profiles').update({ nome: nome.trim(), email: email.trim() }).eq('id', editingUser!.id);

        // Sync portal_usuario_clientes: delete removed, upsert new
        const existing = editingUser!.empresas.map((e) => e.cliente_id);
        const toRemove = existing.filter((id) => !selectedClientes.includes(id));
        const toAdd = selectedClientes.filter((id) => !existing.includes(id));

        if (toRemove.length) {
          await supabase.from('portal_usuario_clientes' as any).delete().eq('usuario_id', editingUser!.id).in('cliente_id', toRemove);
        }
        if (toAdd.length) {
          await supabase.from('portal_usuario_clientes' as any).insert(
            toAdd.map((cid) => ({ usuario_id: editingUser!.id, cliente_id: cid, ativo: true, empresa_padrao: cid === empresaPadrao }))
          );
        }
        // Update empresa_padrao flag
        await supabase.from('portal_usuario_clientes' as any).update({ empresa_padrao: false }).eq('usuario_id', editingUser!.id);
        if (empresaPadrao) {
          await supabase.from('portal_usuario_clientes' as any).update({ empresa_padrao: true }).eq('usuario_id', editingUser!.id).eq('cliente_id', empresaPadrao);
        }

        toast({ title: 'Usuário atualizado.' });
        onUpdated();
      } else {
        // Create user
        const res = await supabase.functions.invoke('criar-usuario', {
          body: {
            action: 'create',
            email: email.trim(),
            password: senha,
            nome: nome.trim(),
            cliente_id: selectedClientes[0], // legacy field
          },
        });
        if (res.error || !res.data?.success) {
          const errMsg = res.data?.error;
          if (errMsg === 'email_exists') {
            toast({ title: 'E-mail já cadastrado', variant: 'destructive' });
            return;
          }
          throw new Error(errMsg || res.error?.message || 'Erro');
        }
        const newUserId = res.data.profile.id;

        // Insert portal_usuario_clientes for all selected companies
        const inserts = selectedClientes.map((cid) => ({
          usuario_id: newUserId,
          cliente_id: cid,
          ativo: true,
          empresa_padrao: cid === empresaPadrao,
        }));
        await supabase.from('portal_usuario_clientes' as any).insert(inserts);

        // Update profiles email
        await supabase.from('profiles').update({ email: email.trim() }).eq('id', newUserId);

        toast({ title: 'Acesso criado!' });
        onOpenChange(false);
        onCreated({ nome: nome.trim(), email: email.trim(), senha });
      }
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Editar Usuário' : 'Novo Usuário'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome completo *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do responsável" />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@empresa.com" />
          </div>
          {!isEditing && (
            <div className="space-y-1.5">
              <Label>Senha temporária *</Label>
              <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
              <p className="text-[11px] text-txt-muted">O cliente pode alterar depois.</p>
            </div>
          )}

          {/* Company selection */}
          <div className="space-y-2">
            <Label>Empresas com acesso *</Label>
            <Input
              placeholder="Buscar empresa..."
              value={clienteSearch}
              onChange={(e) => setClienteSearch(e.target.value)}
              className="h-8 text-sm"
            />
            <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-2 space-y-1">
              {filteredClientes.map((c) => (
                <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
                  <Checkbox
                    checked={selectedClientes.includes(c.id)}
                    onCheckedChange={() => toggleCliente(c.id)}
                  />
                  <span className="text-sm text-txt truncate">{c.razao_social || c.nome_empresa}</span>
                </label>
              ))}
              {filteredClientes.length === 0 && (
                <p className="text-xs text-txt-muted text-center py-2">Nenhuma empresa encontrada</p>
              )}
            </div>
          </div>

          {selectedClientes.length > 1 && (
            <div className="space-y-1.5">
              <Label>Empresa padrão (abre ao fazer login)</Label>
              <Select value={empresaPadrao} onValueChange={setEmpresaPadrao}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {selectedClientes.map((cid) => {
                    const c = allClientes.find((x) => x.id === cid);
                    return <SelectItem key={cid} value={cid}>{c?.razao_social || c?.nome_empresa || cid}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading} className="gap-2">
            {loading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />}
            {isEditing ? 'Salvar' : 'Criar acesso'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Mensagem de Acesso Modal (post-creation) ─────────── */

function MensagemAcessoModal({
  open, onOpenChange, nome, email, senha,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  nome: string; email: string; senha: string | null;
}) {
  const [copied, setCopied] = useState(false);
  const urlBase = window.location.origin;

  const buildMessage = useCallback(() => {
    const senhaLine = senha
      ? `🔑 Senha: ${senha}\n\n⚠️ Recomendamos trocar a senha no primeiro acesso.`
      : '🔑 Senha: (definida na criação)';

    return `Olá, ${nome}! 👋

Seu portal de inteligência financeira está pronto. A partir de agora você pode acompanhar os números do seu negócio a qualquer momento. 📊

*Seu acesso:*
🔗 Link: ${urlBase}/cliente
📧 E-mail: ${email}
${senhaLine}

No portal você encontra:
- Faturamento e Geração de Caixa do mês
- Score de Saúde Financeira
- Alertas e próximas reuniões

Qualquer dúvida, é só chamar! 🚀

_GPI Inteligência Financeira_`;
  }, [nome, urlBase, email, senha]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(buildMessage());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            📲 Mensagem de Acesso
            <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-600 text-[10px]">WhatsApp</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-txt">
            {buildMessage()}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copiado!' : 'Copiar mensagem'}
            </Button>
          </div>
          {senha && (
            <p className="text-[11px] text-txt-muted">
              ⚠️ A senha temporária é exibida apenas agora. Após fechar este modal, não será possível recuperá-la.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
