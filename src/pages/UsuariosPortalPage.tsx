import { useState, useCallback, useEffect } from 'react';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Search, Plus, Pencil, Trash2, Copy, Check, MessageCircle, KeyRound, Send, Lock } from 'lucide-react';

interface PortalUser {
  id: string;
  nome: string | null;
  email: string | null;
  created_at: string;
  role: string;
  empresas: { cliente_id: string; nome_empresa: string; razao_social: string | null; ativo: boolean; empresa_padrao: boolean; responsavel_whatsapp: string | null }[];
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
  const [messageUser, setMessageUser] = useState<PortalUser | null>(null);

  // Session password state (never persisted)
  const [senhaSessao, setSenhaSessao] = useState<{ usuarioId: string; senha: string; criadoEm: Date } | null>(null);

  // Auto-expire senha after 30 minutes
  useEffect(() => {
    if (!senhaSessao) return;
    const elapsed = Date.now() - senhaSessao.criadoEm.getTime();
    const remaining = Math.max(0, 30 * 60 * 1000 - elapsed);
    const timer = setTimeout(() => setSenhaSessao(null), remaining);
    return () => clearTimeout(timer);
  }, [senhaSessao]);

  // Cleanup on unmount
  useEffect(() => () => setSenhaSessao(null), []);

  // Post-creation state
  const [createdInfo, setCreatedInfo] = useState<{ nome: string; email: string; senha: string | null } | null>(null);

  // Fetch all portal users with their linked companies
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['portal-users-all'],
    queryFn: async () => {
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, nome, email, created_at, role')
        .eq('role', 'cliente')
        .order('created_at', { ascending: false });
      if (pErr) throw pErr;
      if (!profiles?.length) return [] as PortalUser[];

      const userIds = profiles.map((p) => p.id);

      const { data: links, error: lErr } = await supabase
        .from('portal_usuario_clientes')
        .select('usuario_id, cliente_id, ativo, empresa_padrao')
        .in('usuario_id', userIds);
      if (lErr) throw lErr;

      const clienteIds = [...new Set((links || []).map((l) => l.cliente_id))];
      let clientesMap: Record<string, { nome_empresa: string; razao_social: string | null; responsavel_whatsapp: string | null }> = {};
      if (clienteIds.length) {
        const { data: clientes } = await supabase
          .from('clientes')
          .select('id, nome_empresa, razao_social, responsavel_whatsapp')
          .in('id', clienteIds);
        (clientes || []).forEach((c) => {
          clientesMap[c.id] = { nome_empresa: c.nome_empresa, razao_social: c.razao_social, responsavel_whatsapp: c.responsavel_whatsapp };
        });
      }

      return profiles.map((p): PortalUser => {
        const userLinks = (links || []).filter((l) => l.usuario_id === p.id);
        const empresas = userLinks.map((l) => ({
          cliente_id: l.cliente_id,
          nome_empresa: clientesMap[l.cliente_id]?.nome_empresa || '?',
          razao_social: clientesMap[l.cliente_id]?.razao_social || null,
          ativo: l.ativo,
          empresa_padrao: l.empresa_padrao,
          responsavel_whatsapp: clientesMap[l.cliente_id]?.responsavel_whatsapp || null,
        }));
        return { ...p, empresas, anyActive: empresas.some((e) => e.ativo) };
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
        <Input placeholder="Buscar por nome ou e-mail..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
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
                        <Badge variant="outline" className="text-[10px] text-txt-muted">+{u.empresas.length - 2}</Badge>
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
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Mensagem de acesso" onClick={() => setMessageUser(u)}>
                        <MessageCircle className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Editar" onClick={() => { setEditingUser(u); setCreatedInfo(null); setModalOpen(true); }}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" title="Remover" onClick={() => setDeleteUser(u)}>
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

      {/* Create Modal (only for new users) */}
      {!editingUser && (
        <CriarUsuarioModal
          open={modalOpen && !editingUser}
          onOpenChange={(o) => { if (!o) setModalOpen(false); }}
          preselectedClienteId={preselectedCliente}
          onCreated={(info) => {
            setCreatedInfo(info);
            queryClient.invalidateQueries({ queryKey: ['portal-users-all'] });
          }}
        />
      )}

      {/* Edit Modal (only for existing users) */}
      {editingUser && (
        <EditarUsuarioModal
          open={modalOpen && !!editingUser}
          onOpenChange={(o) => { if (!o) { setModalOpen(false); setEditingUser(null); } }}
          user={editingUser}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['portal-users-all'] });
            setModalOpen(false);
            setEditingUser(null);
          }}
        />
      )}

      {/* Post-creation message */}
      {createdInfo && (
        <MensagemAcessoModal
          open={!!createdInfo}
          onOpenChange={(o) => { if (!o) setCreatedInfo(null); }}
          nome={createdInfo.nome}
          email={createdInfo.email}
          senha={createdInfo.senha}
          empresas={[]}
        />
      )}

      {/* Per-user message modal */}
      {messageUser && (
        <MensagemAcessoModal
          open={!!messageUser}
          onOpenChange={(o) => { if (!o) setMessageUser(null); }}
          nome={messageUser.nome || ''}
          email={messageUser.email || ''}
          senha={null}
          empresas={messageUser.empresas}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={(o) => { if (!o) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {deleteUser?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>Esta ação remove o acesso ao portal de todas as empresas.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── Create User Modal ─────────────────────── */

function CriarUsuarioModal({
  open, onOpenChange, preselectedClienteId, onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  preselectedClienteId: string | null;
  onCreated: (info: { nome: string; email: string; senha: string | null }) => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [selectedClientes, setSelectedClientes] = useState<string[]>(preselectedClienteId ? [preselectedClienteId] : []);
  const [empresaPadrao, setEmpresaPadrao] = useState<string>(preselectedClienteId || '');
  const [clienteSearch, setClienteSearch] = useState('');
  const [loading, setLoading] = useState(false);

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

  const resetForm = useCallback(() => {
    setNome('');
    setEmail('');
    setSenha('');
    setSelectedClientes(preselectedClienteId ? [preselectedClienteId] : []);
    setEmpresaPadrao(preselectedClienteId || '');
    setClienteSearch('');
    setLoading(false);
  }, [preselectedClienteId]);

  const handleOpenChange = (o: boolean) => {
    if (o) resetForm();
    onOpenChange(o);
  };

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
    if (senha.length < 6) {
      toast({ title: 'A senha deve ter pelo menos 6 caracteres', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: { action: 'create', email: email.trim(), password: senha, nome: nome.trim(), cliente_id: selectedClientes[0] },
      });
      if (res.error || !res.data?.success) {
        if (res.data?.error === 'email_exists') {
          toast({ title: 'E-mail já cadastrado', variant: 'destructive' });
          return;
        }
        throw new Error(res.data?.error || res.error?.message || 'Erro');
      }
      const newUserId = res.data.profile.id;

      const inserts = selectedClientes.map((cid) => ({
        usuario_id: newUserId,
        cliente_id: cid,
        ativo: true,
        empresa_padrao: cid === empresaPadrao,
      }));
      await supabase.from('portal_usuario_clientes').insert(inserts);
      await supabase.from('profiles').update({ email: email.trim() }).eq('id', newUserId);

      toast({ title: 'Acesso criado!' });
      onOpenChange(false);
      onCreated({ nome: nome.trim(), email: email.trim(), senha });
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
          <DialogTitle>Novo Usuário</DialogTitle>
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
          <div className="space-y-1.5">
            <Label>Senha temporária *</Label>
            <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
            <p className="text-[11px] text-txt-muted">O cliente pode alterar depois.</p>
          </div>

          <EmpresasCheckboxList
            allClientes={allClientes}
            filteredClientes={filteredClientes}
            selectedClientes={selectedClientes}
            clienteSearch={clienteSearch}
            setClienteSearch={setClienteSearch}
            toggleCliente={toggleCliente}
          />

          {selectedClientes.length > 1 && (
            <EmpresaPadraoSelect
              allClientes={allClientes}
              selectedClientes={selectedClientes}
              empresaPadrao={empresaPadrao}
              setEmpresaPadrao={setEmpresaPadrao}
            />
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading} className="gap-2">
            {loading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />}
            Criar acesso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Edit User Modal ─────────────────────── */

function EditarUsuarioModal({
  open, onOpenChange, user, onUpdated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  user: PortalUser;
  onUpdated: () => void;
}) {
  const [nome, setNome] = useState(user.nome || '');
  const [email, setEmail] = useState(user.email || '');
  const [selectedClientes, setSelectedClientes] = useState<string[]>(user.empresas.map((e) => e.cliente_id));
  const [empresaPadrao, setEmpresaPadrao] = useState<string>(user.empresas.find((e) => e.empresa_padrao)?.cliente_id || user.empresas[0]?.cliente_id || '');
  const [clienteSearch, setClienteSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [senhaModalOpen, setSenhaModalOpen] = useState(false);

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

    setLoading(true);
    try {
      await supabase.from('profiles').update({ nome: nome.trim(), email: email.trim() }).eq('id', user.id);

      const existing = user.empresas.map((e) => e.cliente_id);
      const toRemove = existing.filter((id) => !selectedClientes.includes(id));
      const toAdd = selectedClientes.filter((id) => !existing.includes(id));

      if (toRemove.length) {
        await supabase.from('portal_usuario_clientes').delete().eq('usuario_id', user.id).in('cliente_id', toRemove);
      }
      if (toAdd.length) {
        await supabase.from('portal_usuario_clientes').insert(
          toAdd.map((cid) => ({ usuario_id: user.id, cliente_id: cid, ativo: true, empresa_padrao: cid === empresaPadrao }))
        );
      }
      await supabase.from('portal_usuario_clientes').update({ empresa_padrao: false }).eq('usuario_id', user.id);
      if (empresaPadrao) {
        await supabase.from('portal_usuario_clientes').update({ empresa_padrao: true }).eq('usuario_id', user.id).eq('cliente_id', empresaPadrao);
      }

      toast({ title: 'Usuário atualizado.' });
      onUpdated();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[540px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar Usuário</DialogTitle>
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

            {/* Password reset button instead of password field */}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setSenhaModalOpen(true)}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Redefinir senha
            </Button>

            <EmpresasCheckboxList
              allClientes={allClientes}
              filteredClientes={filteredClientes}
              selectedClientes={selectedClientes}
              clienteSearch={clienteSearch}
              setClienteSearch={setClienteSearch}
              toggleCliente={toggleCliente}
            />

            {selectedClientes.length > 1 && (
              <EmpresaPadraoSelect
                allClientes={allClientes}
                selectedClientes={selectedClientes}
                empresaPadrao={empresaPadrao}
                setEmpresaPadrao={setEmpresaPadrao}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={loading} className="gap-2">
              {loading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password reset sub-modal */}
      <RedefinirSenhaModal
        open={senhaModalOpen}
        onOpenChange={setSenhaModalOpen}
        userId={user.id}
        userEmail={email}
      />
    </>
  );
}

/* ─── Password Reset Modal ─────────────────────── */

function RedefinirSenhaModal({
  open, onOpenChange, userId, userEmail,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  userId: string;
  userEmail: string;
}) {
  const [mode, setMode] = useState<'choose' | 'manual'>('choose');
  const [novaSenha, setNovaSenha] = useState('');
  const [loading, setLoading] = useState(false);

  const handleOpenChange = (o: boolean) => {
    if (!o) { setMode('choose'); setNovaSenha(''); }
    onOpenChange(o);
  };

  const handleSendLink = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(userEmail);
      if (error) throw error;
      toast({ title: `Link enviado para ${userEmail}.` });
      handleOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleManualReset = async () => {
    if (novaSenha.length < 6) {
      toast({ title: 'A senha deve ter pelo menos 6 caracteres', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: { action: 'update_password', user_id: userId, nova_senha: novaSenha },
      });
      if (res.error || !res.data?.success) throw new Error(res.data?.error || 'Erro');
      toast({ title: 'Senha atualizada.' });
      handleOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>🔑 Redefinir Senha</DialogTitle>
        </DialogHeader>
        {mode === 'choose' ? (
          <div className="space-y-3 py-2">
            <Button variant="outline" className="w-full justify-start gap-2" onClick={handleSendLink} disabled={loading}>
              <Send className="h-4 w-4" />
              Enviar link por e-mail
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setMode('manual')}>
              <Lock className="h-4 w-4" />
              Definir nova senha agora
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Nova senha *</Label>
              <Input type="password" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMode('choose')}>Voltar</Button>
              <Button onClick={handleManualReset} disabled={loading} className="gap-2">
                {loading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />}
                Salvar senha
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ─── Shared: Empresas Checkbox List ─────────────────── */

function EmpresasCheckboxList({
  allClientes, filteredClientes, selectedClientes, clienteSearch, setClienteSearch, toggleCliente,
}: {
  allClientes: { id: string; nome_empresa: string; razao_social: string | null }[];
  filteredClientes: { id: string; nome_empresa: string; razao_social: string | null }[];
  selectedClientes: string[];
  clienteSearch: string;
  setClienteSearch: (s: string) => void;
  toggleCliente: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>Empresas com acesso *</Label>
      <Input placeholder="Buscar empresa..." value={clienteSearch} onChange={(e) => setClienteSearch(e.target.value)} className="h-8 text-sm" />
      <div className="max-h-44 overflow-y-auto rounded-lg border border-border p-2 space-y-1">
        {filteredClientes.map((c) => (
          <label key={c.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-pointer">
            <Checkbox checked={selectedClientes.includes(c.id)} onCheckedChange={() => toggleCliente(c.id)} />
            <span className="text-sm text-txt truncate">{c.razao_social || c.nome_empresa}</span>
          </label>
        ))}
        {filteredClientes.length === 0 && (
          <p className="text-xs text-txt-muted text-center py-2">Nenhuma empresa encontrada</p>
        )}
      </div>
    </div>
  );
}

/* ─── Shared: Empresa Padrão Select ─────────────────── */

function EmpresaPadraoSelect({
  allClientes, selectedClientes, empresaPadrao, setEmpresaPadrao,
}: {
  allClientes: { id: string; nome_empresa: string; razao_social: string | null }[];
  selectedClientes: string[];
  empresaPadrao: string;
  setEmpresaPadrao: (v: string) => void;
}) {
  return (
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
  );
}

/* ─── Mensagem de Acesso Modal ─────────────────────── */

function MensagemAcessoModal({
  open, onOpenChange, nome, email, senha, empresas,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  nome: string;
  email: string;
  senha: string | null;
  empresas: { cliente_id: string; nome_empresa: string; razao_social: string | null; responsavel_whatsapp: string | null }[];
}) {
  const [copied, setCopied] = useState(false);
  const [whatsappEmpresa, setWhatsappEmpresa] = useState('');
  const urlBase = window.location.origin;

  const senhaLine = senha
    ? `🔑 Senha: ${senha}\n\n⚠️ Recomendamos trocar a senha no primeiro acesso.`
    : `🔑 Senha: (a senha definida na criação)\n\n⚠️ Recomendamos trocar a senha no primeiro acesso.`;

  const message = `Olá, ${nome}! 👋

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

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const empresasComWhatsapp = empresas.filter((e) => e.responsavel_whatsapp);

  const handleWhatsapp = (whatsapp: string) => {
    const phone = whatsapp.replace(/\D/g, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const onSendWhatsapp = () => {
    if (empresasComWhatsapp.length === 0) {
      toast({ title: 'Nenhuma empresa vinculada possui WhatsApp cadastrado.', variant: 'destructive' });
      return;
    }
    if (empresasComWhatsapp.length === 1) {
      handleWhatsapp(empresasComWhatsapp[0].responsavel_whatsapp!);
      return;
    }
    // Multiple: use selected
    if (whatsappEmpresa) {
      const emp = empresasComWhatsapp.find((e) => e.cliente_id === whatsappEmpresa);
      if (emp?.responsavel_whatsapp) handleWhatsapp(emp.responsavel_whatsapp);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            📲 Mensagem de Acesso — {nome}
            <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-600 text-[10px]">WhatsApp</Badge>
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-txt">
            {message}
          </div>

          {!senha && (
            <p className="text-[11px] text-txt-muted">
              ⚠️ Por segurança, a senha não é armazenada. Edite manualmente antes de enviar se necessário.
            </p>
          )}
          {senha && (
            <p className="text-[11px] text-txt-muted">
              ⚠️ A senha temporária é exibida apenas agora. Após fechar este modal, não será possível recuperá-la.
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={handleCopy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copiado!' : 'Copiar mensagem'}
            </Button>

            {empresas.length > 0 && (
              <>
                {empresasComWhatsapp.length > 1 ? (
                  <div className="flex items-center gap-2">
                    <Select value={whatsappEmpresa} onValueChange={setWhatsappEmpresa}>
                      <SelectTrigger className="h-8 text-xs w-48">
                        <SelectValue placeholder="Enviar para qual empresa?" />
                      </SelectTrigger>
                      <SelectContent>
                        {empresasComWhatsapp.map((e) => (
                          <SelectItem key={e.cliente_id} value={e.cliente_id}>
                            {e.razao_social || e.nome_empresa}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="gap-1.5" onClick={onSendWhatsapp} disabled={!whatsappEmpresa}>
                      <MessageCircle className="h-3.5 w-3.5" />
                      Enviar
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={onSendWhatsapp}>
                    <MessageCircle className="h-3.5 w-3.5" />
                    Enviar pelo WhatsApp
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
