import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { toast } from '@/hooks/use-toast';
import { UserPlus, Key, Pencil, Trash2, Globe, Calendar, ChevronDown, Copy, Check, MessageCircle, Link as LinkIcon, ExternalLink } from 'lucide-react';

interface Props {
  clienteId: string;
  cliente?: any;
}

export function PortalTab({ clienteId, cliente }: Props) {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingEmail, setEditingEmail] = useState(false);
  const [emailDraft, setEmailDraft] = useState('');
  const [togglingPortal, setTogglingPortal] = useState(false);
  const [deactivateConfirmOpen, setDeactivateConfirmOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [resetPasswordOpen, setResetPasswordOpen] = useState(false);
  const [newPasswordMode, setNewPasswordMode] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);

  // Temporary credentials state (after creation)
  const [createdEmail, setCreatedEmail] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);
  const [createdWithInvite, setCreatedWithInvite] = useState(false);
  const [justCreated, setJustCreated] = useState(false);

  // Auto-clear password after 10 minutes
  useEffect(() => {
    if (!createdPassword) return;
    const timer = setTimeout(() => setCreatedPassword(null), 10 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [createdPassword]);

  // Fetch portal user profile
  const { data: portalUser, isLoading } = useQuery({
    queryKey: ['portal-user', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nome, role, portal_ativo, created_at, email')
        .eq('cliente_id', clienteId)
        .eq('role', 'cliente')
        .maybeSingle();
      if (error) throw error;
      return data as any | null;
    },
  });

  const handleTogglePortal = async (activate: boolean) => {
    if (!portalUser) return;
    setTogglingPortal(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ portal_ativo: activate })
        .eq('id', portalUser.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['portal-user', clienteId] });
      toast({ title: activate ? `Acesso ao portal ativado para ${portalUser.nome}.` : `Acesso ao portal desativado para ${portalUser.nome}.` });
    } catch (err: any) {
      toast({ title: 'Erro ao alterar portal', description: err.message, variant: 'destructive' });
    } finally {
      setTogglingPortal(false);
      setDeactivateConfirmOpen(false);
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

  const handleSaveEmail = async () => {
    if (!portalUser || !emailDraft.trim()) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ email: emailDraft.trim() })
        .eq('id', portalUser.id);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['portal-user', clienteId] });
      setEditingEmail(false);
      toast({ title: 'E-mail atualizado' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleSendResetEmail = async () => {
    if (!portalUser?.email) {
      toast({ title: 'E-mail não cadastrado', variant: 'destructive' });
      return;
    }
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(portalUser.email, {
        redirectTo: `${window.location.origin}/cliente`,
      });
      if (error) throw error;
      toast({ title: 'Link de redefinição enviado', description: `Enviado para ${portalUser.email}` });
      setResetPasswordOpen(false);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleSetNewPassword = async () => {
    if (!portalUser || newPassword.length < 6) {
      toast({ title: 'A senha deve ter pelo menos 6 caracteres', variant: 'destructive' });
      return;
    }
    setSettingPassword(true);
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: { action: 'update_password', user_id: portalUser.id, nova_senha: newPassword },
      });
      if (res.error || !res.data?.success) {
        throw new Error(res.data?.error || res.error?.message || 'Erro ao atualizar senha');
      }
      toast({ title: 'Senha atualizada com sucesso' });
      setResetPasswordOpen(false);
      setNewPasswordMode(false);
      setNewPassword('');
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setSettingPassword(false);
    }
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
      setCreatedEmail(null);
      setCreatedPassword(null);
      setJustCreated(false);
      toast({ title: 'Acesso removido com sucesso' });
    } catch (err: any) {
      toast({ title: 'Erro ao remover acesso', description: err.message, variant: 'destructive' });
    }
  };

  const handleUserCreated = (email: string, password: string | null, wasInvite: boolean) => {
    setCreatedEmail(email);
    setCreatedPassword(password);
    setCreatedWithInvite(wasInvite);
    setJustCreated(true);
    localStorage.setItem(`portal-msg-expandida-${clienteId}`, 'true');
    queryClient.invalidateQueries({ queryKey: ['portal-user', clienteId] });
  };

  const portalLink = `${window.location.origin}/cliente`;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* SEÇÃO 1: USUÁRIO DO PORTAL */}
      <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-txt">Usuário do Portal</h3>
        </div>

        {!portalUser ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-dashed border-border p-6 text-center space-y-2">
              <p className="text-sm text-txt-muted">
                Nenhum usuário cadastrado para este cliente. Crie um acesso para que o cliente possa acessar o portal.
              </p>
            </div>
            <Button onClick={() => setCreateOpen(true)} className="gap-2">
              <UserPlus className="h-4 w-4" />
              Criar Acesso ao Portal
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Portal link highlight at top */}
            <div className="rounded-lg border border-primary/20 bg-primary/[0.06] p-3 space-y-1">
              <p className="text-[11px] font-medium uppercase text-txt-muted tracking-wide flex items-center gap-1">
                <LinkIcon className="h-3 w-3" /> Link de acesso ao portal
              </p>
              <div className="flex items-center gap-2">
                <code className="text-sm text-primary font-medium">{portalLink}</code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 gap-1 text-xs"
                  onClick={async () => {
                    await navigator.clipboard.writeText(portalLink);
                    setLinkCopied(true);
                    setTimeout(() => setLinkCopied(false), 2000);
                  }}
                >
                  {linkCopied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  {linkCopied ? 'Copiado!' : 'Copiar'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 gap-1 text-xs"
                  onClick={() => window.open(portalLink, '_blank')}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Abrir
                </Button>
              </div>
            </div>

            {/* User info */}
            <div className="grid gap-3 sm:grid-cols-2">
              {/* Nome */}
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

              {/* E-mail */}
              <div className="rounded-lg border border-border p-3 space-y-1">
                <p className="text-[11px] font-medium uppercase text-txt-muted tracking-wide">E-mail</p>
                {editingEmail ? (
                  <div className="flex items-center gap-2">
                    <Input
                      autoFocus
                      type="email"
                      value={emailDraft}
                      onChange={(e) => setEmailDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveEmail();
                        if (e.key === 'Escape') setEditingEmail(false);
                      }}
                      className="h-7 text-sm"
                    />
                    <Button size="sm" variant="ghost" onClick={handleSaveEmail} className="h-7 px-2 text-xs">
                      Salvar
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-txt">{portalUser.email || '—'}</p>
                    <button
                      onClick={() => { setEmailDraft(portalUser.email || ''); setEditingEmail(true); }}
                      className="rounded p-0.5 text-txt-muted hover:text-primary transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Created at */}
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

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => { setResetPasswordOpen(true); setNewPasswordMode(false); setNewPassword(''); }}
              >
                <Key className="h-3.5 w-3.5" />
                Redefinir senha
              </Button>
              {portalUser.portal_ativo ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/10"
                  onClick={() => setDeactivateConfirmOpen(true)}
                  disabled={togglingPortal}
                >
                  ● Portal ativo
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-txt-muted"
                  onClick={() => handleTogglePortal(true)}
                  disabled={togglingPortal}
                >
                  ○ Portal inativo
                </Button>
              )}
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

      {/* SEÇÃO 2: MENSAGEM DE ACESSO */}
      {portalUser && (
        <MensagemAcessoCard
          clienteId={clienteId}
          cliente={cliente}
          portalUser={portalUser}
          email={createdEmail || portalUser.email}
          senha={createdPassword}
          wasInvite={createdWithInvite}
          justCreated={justCreated}
          onClearPassword={() => setCreatedPassword(null)}
        />
      )}

      {/* Modal: Criar Acesso */}
      <CriarAcessoDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        clienteId={clienteId}
        onSuccess={handleUserCreated}
      />

      {/* Modal: Redefinir Senha */}
      <Dialog open={resetPasswordOpen} onOpenChange={(o) => { setResetPasswordOpen(o); if (!o) { setNewPasswordMode(false); setNewPassword(''); } }}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
          </DialogHeader>
          {!newPasswordMode ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-txt-muted">Escolha como redefinir a senha de {portalUser?.nome}:</p>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2" onClick={handleSendResetEmail}>
                  ✉️ Enviar link por e-mail
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2" onClick={() => setNewPasswordMode(true)}>
                  🔑 Definir nova senha agora
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label>Nova senha (mínimo 6 caracteres)</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Digite a nova senha"
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSetNewPassword(); }}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setNewPasswordMode(false)}>Voltar</Button>
                <Button onClick={handleSetNewPassword} disabled={settingPassword || newPassword.length < 6}>
                  {settingPassword && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent mr-2" />}
                  Salvar senha
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {/* Confirm Deactivate */}
      <AlertDialog open={deactivateConfirmOpen} onOpenChange={setDeactivateConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Desativar acesso ao portal?</AlertDialogTitle>
            <AlertDialogDescription>
              Desativar o acesso de "{portalUser?.nome}" ao portal? O usuário não conseguirá mais acessar enquanto estiver inativo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleTogglePortal(false)}>
              Desativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── Mensagem de Acesso Card ─────────────────────────── */

function MensagemAcessoCard({
  clienteId,
  cliente,
  portalUser,
  email,
  senha,
  wasInvite,
  justCreated,
  onClearPassword,
}: {
  clienteId: string;
  cliente?: any;
  portalUser: any;
  email: string | null;
  senha: string | null;
  wasInvite: boolean;
  justCreated: boolean;
  onClearPassword: () => void;
}) {
  const storageKey = `portal-msg-expandida-${clienteId}`;
  const [open, setOpen] = useState(() => {
    if (justCreated) return true;
    return localStorage.getItem(storageKey) === 'true';
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!justCreated) {
      localStorage.removeItem(storageKey);
    }
  }, [justCreated, storageKey]);

  useEffect(() => {
    if (justCreated) setOpen(true);
  }, [justCreated]);

  const nomeUsuario = portalUser?.nome || 'Cliente';
  const responsavelWhatsapp = cliente?.responsavel_whatsapp;
  const urlBase = window.location.origin;

  const buildMessage = useCallback(() => {
    const senhaLine = wasInvite
      ? '🔗 Você receberá um e-mail para definir sua senha.'
      : senha
        ? `🔑 Senha: ${senha}\n\n⚠️ Recomendamos trocar a senha no primeiro acesso.`
        : '🔑 Senha: (definida na criação)';

    return `Olá, ${nomeUsuario}! 👋

Seu portal de inteligência financeira está pronto. A partir de agora você pode acompanhar os números do seu negócio a qualquer momento. 📊

*Seu acesso:*
🔗 Link: ${urlBase}/cliente
📧 E-mail: ${email || '(e-mail cadastrado)'}
${senhaLine}

No portal você encontra:
- Faturamento e Geração de Caixa do mês
- Score de Saúde Financeira
- Alertas e próximas reuniões

Qualquer dúvida, é só chamar! 🚀

_GPI Inteligência Financeira_`;
  }, [nomeUsuario, urlBase, email, senha, wasInvite]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildMessage());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: 'Erro ao copiar', variant: 'destructive' });
    }
  };

  const handleWhatsApp = () => {
    if (!responsavelWhatsapp) {
      toast({
        title: 'Nenhum WhatsApp cadastrado',
        description: 'Adicione o WhatsApp do responsável na aba Contato.',
        variant: 'destructive',
      });
      return;
    }
    const phone = responsavelWhatsapp.replace(/\D/g, '');
    const phoneWithCountry = phone.startsWith('55') ? phone : `55${phone}`;
    const encoded = encodeURIComponent(buildMessage());
    window.open(`https://wa.me/${phoneWithCountry}?text=${encoded}`, '_blank');
  };

  // TODO: integração n8n/WhatsApp Business API para envio automático

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-2 text-left group">
              <span className="text-lg">📲</span>
              <h3 className="text-sm font-semibold text-txt">Mensagem de Acesso</h3>
              <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-600 text-[10px] font-semibold">
                WhatsApp
              </Badge>
              <ChevronDown className={`h-4 w-4 text-txt-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copiado!' : 'Copiar mensagem'}
          </Button>
        </div>

        <CollapsibleContent className="space-y-4">
          <div className="rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-txt">
            {buildMessage()}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-700"
              onClick={handleWhatsApp}
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Enviar pelo WhatsApp
            </Button>
          </div>

          {senha && (
            <p className="text-[11px] text-txt-muted">
              ⚠️ A senha temporária é exibida apenas agora. Após fechar este card, não será possível recuperá-la.
            </p>
          )}
          {wasInvite && !senha && (
            <p className="text-[11px] text-txt-muted">
              ✉️ Convite enviado por e-mail. O cliente definirá sua própria senha.
            </p>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/* ─── Criar Acesso Dialog ─────────────────────────────── */

function CriarAcessoDialog({
  open, onOpenChange, clienteId, onSuccess,
}: {
  open: boolean; onOpenChange: (o: boolean) => void; clienteId: string;
  onSuccess: (email: string, password: string | null, wasInvite: boolean) => void;
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
      const createdEmail = email.trim();
      const createdPassword = usarConvite ? null : senha;
      const wasInvite = usarConvite;
      reset();
      onOpenChange(false);
      onSuccess(createdEmail, createdPassword, wasInvite);
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
