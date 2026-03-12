import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { toast } from '@/hooks/use-toast';
import { UserPlus, Key, Pencil, Trash2, Globe, Mail, Calendar } from 'lucide-react';

interface Props {
  clienteId: string;
}

export function PortalTab({ clienteId }: Props) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [togglingPortal, setTogglingPortal] = useState(false);

  // Fetch portal user profile
  const { data: portalUser, isLoading } = useQuery({
    queryKey: ['portal-user', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nome, role, portal_ativo, created_at')
        .eq('cliente_id', clienteId)
        .eq('role', 'cliente')
        .maybeSingle();
      if (error) throw error;
      return data as any | null;
    },
  });

  // Get email from auth (we need the edge function for this, but we can use the profile id)
  // We'll show what we have from profiles

  const handleTogglePortal = async (checked: boolean) => {
    if (!portalUser) return;
    setTogglingPortal(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ portal_ativo: checked })
        .eq('id', portalUser.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['portal-user', clienteId] });
      toast({ title: checked ? 'Portal ativado' : 'Portal desativado' });
    } catch (err: any) {
      toast({ title: 'Erro ao alterar portal', description: err.message, variant: 'destructive' });
    } finally {
      setTogglingPortal(false);
    }
  };

  const handleSaveName = async () => {
    if (!portalUser || !nameDraft.trim()) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ nome: nameDraft.trim() })
        .eq('id', portalUser.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['portal-user', clienteId] });
      setEditingName(false);
      toast({ title: 'Nome atualizado' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleResetPassword = async () => {
    if (!portalUser) return;
    // We need the email - fetch from auth via edge function or use a workaround
    // For now, we'll try to get the user's email from auth metadata
    toast({ title: 'Funcionalidade requer e-mail do usuário', description: 'Use o e-mail cadastrado para redefinir a senha.' });
  };

  const handleDelete = async () => {
    if (!portalUser) return;
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: { action: 'delete', user_id: portalUser.id },
      });
      if (res.error || !res.data?.success) {
        throw new Error(res.data?.error || res.error?.message || 'Erro ao remover');
      }
      queryClient.invalidateQueries({ queryKey: ['portal-user', clienteId] });
      setDeleteConfirmOpen(false);
      toast({ title: 'Acesso removido com sucesso' });
    } catch (err: any) {
      toast({ title: 'Erro ao remover acesso', description: err.message, variant: 'destructive' });
    }
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
      {/* SEÇÃO 1: STATUS DO PORTAL */}
      <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-txt">Acesso ao Portal do Cliente</h3>
        </div>

        {portalUser ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-txt">Status do Portal</span>
                  {portalUser.portal_ativo ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green/10 px-2 py-0.5 text-xs font-semibold text-green">
                      ● ATIVO
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-txt-muted">
                      ● INATIVO
                    </span>
                  )}
                </div>
                <p className="text-xs text-txt-muted">
                  Quando ativo, o cliente acessa o portal em /cliente com o e-mail e senha cadastrados abaixo.
                </p>
              </div>
              <Switch
                checked={portalUser.portal_ativo ?? false}
                onCheckedChange={handleTogglePortal}
                disabled={togglingPortal}
              />
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-2">
            <p className="text-sm text-txt-muted">
              Nenhum acesso ao portal configurado. Crie um usuário para que o cliente possa acessar o portal.
            </p>
          </div>
        )}
      </div>

      {/* SEÇÃO 2: USUÁRIO DO PORTAL */}
      <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
        <h3 className="text-sm font-semibold text-txt">Usuário do Portal</h3>

        {!portalUser ? (
          <div className="space-y-4">
            <p className="text-sm text-txt-muted">Nenhum usuário cadastrado para este cliente.</p>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Criar Acesso ao Portal
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* User info */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase text-txt-muted tracking-wide">Nome</p>
                {editingName ? (
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveName();
                        if (e.key === 'Escape') setEditingName(false);
                      }}
                      className="h-7 text-sm"
                    />
                    <Button size="sm" variant="ghost" onClick={handleSaveName} className="h-7 px-2 text-xs">
                      Salvar
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-txt">{portalUser.nome || '—'}</p>
                    <button
                      onClick={() => { setNameDraft(portalUser.nome || ''); setEditingName(true); }}
                      className="rounded p-0.5 text-txt-muted hover:text-primary transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-border p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase text-txt-muted tracking-wide flex items-center gap-1">
                  <Calendar className="h-3 w-3" /> Criado em
                </p>
                <p className="text-sm text-txt">
                  {new Date(portalUser.created_at).toLocaleDateString('pt-BR', {
                    day: 'numeric', month: 'long', year: 'numeric',
                  })}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  toast({
                    title: 'Funcionalidade em desenvolvimento',
                    description: 'A redefinição de senha por e-mail será implementada em breve.',
                  });
                }}
              >
                <Key className="h-3.5 w-3.5" />
                Redefinir senha
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                Remover acesso
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Criar Acesso */}
      <CriarAcessoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        clienteId={clienteId}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['portal-user', clienteId] })}
      />

      {/* Confirm Delete */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover acesso ao portal?</AlertDialogTitle>
            <AlertDialogDescription>
              O usuário "{portalUser?.nome}" perderá acesso ao portal do cliente.
              Os dados financeiros do cliente não serão afetados.
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

function CriarAcessoDialog({
  open, onOpenChange, clienteId, onSuccess,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; clienteId: string; onSuccess: () => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [usarConvite, setUsarConvite] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => { setNome(''); setEmail(''); setSenha(''); setUsarConvite(false); };

  const handleCreate = async () => {
    if (!nome.trim() || !email.trim()) {
      toast({ title: 'Preencha nome e e-mail', variant: 'destructive' });
      return;
    }
    if (!usarConvite && senha.length < 8) {
      toast({ title: 'A senha deve ter pelo menos 8 caracteres', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: {
          action: 'create',
          email: email.trim(),
          password: usarConvite ? undefined : senha,
          nome: nome.trim(),
          cliente_id: clienteId,
          usar_convite: usarConvite,
        },
      });

      if (res.error || !res.data?.success) {
        const errMsg = res.data?.error;
        if (errMsg === 'email_exists') {
          toast({ title: 'E-mail já cadastrado', description: 'Este e-mail já está em uso por outro usuário.', variant: 'destructive' });
        } else {
          throw new Error(errMsg || res.error?.message || 'Erro ao criar acesso');
        }
        return;
      }

      toast({ title: 'Acesso criado!', description: 'Ative o portal quando o cliente estiver pronto.' });
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Erro ao criar acesso', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Criar Acesso ao Portal</DialogTitle>
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
          {!usarConvite && (
            <div className="space-y-1.5">
              <Label>Senha temporária *</Label>
              <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Mínimo 8 caracteres" />
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox
              id="usar-convite"
              checked={usarConvite}
              onCheckedChange={(c) => setUsarConvite(c === true)}
            />
            <label htmlFor="usar-convite" className="text-sm text-txt-muted cursor-pointer">
              Enviar convite por e-mail em vez de definir senha
            </label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={loading} className="gap-2">
            {loading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />}
            Criar acesso
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
