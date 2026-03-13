import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import { Key, Pencil, Trash2, Globe, Calendar, ChevronDown, Copy, Check, MessageCircle, Link as LinkIcon, ExternalLink, UserPlus, ExternalLink as Manage } from 'lucide-react';

interface Props {
  clienteId: string;
  cliente?: any;
}

export function PortalTab({ clienteId, cliente }: Props) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [linkCopied, setLinkCopied] = useState(false);

  // Fetch users linked to this client via portal_usuario_clientes
  const { data: linkedUsers = [], isLoading } = useQuery({
    queryKey: ['portal-users-for-client', clienteId],
    queryFn: async () => {
      const { data: links, error } = await supabase
        .from('portal_usuario_clientes' as any)
        .select('usuario_id, ativo, empresa_padrao')
        .eq('cliente_id', clienteId);
      if (error) throw error;
      if (!links?.length) return [];

      const userIds = (links as any[]).map((l: any) => l.usuario_id);
      const { data: profiles, error: pErr } = await supabase
        .from('profiles')
        .select('id, nome, email, created_at')
        .in('id', userIds);
      if (pErr) throw pErr;

      return (profiles || []).map((p) => {
        const link = (links as any[]).find((l: any) => l.usuario_id === p.id);
        return { ...p, ativo: link?.ativo ?? false, empresa_padrao: link?.empresa_padrao ?? false };
      });
    },
  });

  // Vincular usuario existente
  const [vinculateOpen, setVinculateOpen] = useState(false);
  const [vinculateSearch, setVinculateSearch] = useState('');
  const [selectedVinculate, setSelectedVinculate] = useState('');

  const { data: allPortalUsers = [] } = useQuery({
    queryKey: ['all-portal-users-for-vinculate'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nome, email')
        .eq('role', 'cliente')
        .order('nome');
      if (error) throw error;
      return data || [];
    },
    enabled: vinculateOpen,
  });

  const handleVinculate = async () => {
    if (!selectedVinculate) return;
    try {
      const { error } = await supabase.from('portal_usuario_clientes' as any).insert({
        usuario_id: selectedVinculate,
        cliente_id: clienteId,
        ativo: true,
        empresa_padrao: false,
      });
      if (error) {
        if (error.message?.includes('duplicate') || error.message?.includes('unique')) {
          toast({ title: 'Usuário já vinculado a esta empresa', variant: 'destructive' });
        } else throw error;
        return;
      }
      queryClient.invalidateQueries({ queryKey: ['portal-users-for-client', clienteId] });
      setVinculateOpen(false);
      setSelectedVinculate('');
      toast({ title: 'Usuário vinculado com sucesso.' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const handleToggleAtivoForClient = async (usuarioId: string, currentAtivo: boolean) => {
    const newAtivo = !currentAtivo;
    try {
      const { error } = await supabase
        .from('portal_usuario_clientes' as any)
        .update({ ativo: newAtivo })
        .eq('usuario_id', usuarioId)
        .eq('cliente_id', clienteId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['portal-users-for-client', clienteId] });
      toast({ title: newAtivo ? 'Acesso ativado para esta empresa.' : 'Acesso desativado para esta empresa.' });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    }
  };

  const portalLink = 'https://sistema-gpi.lovable.app/cliente';

  // Mensagem de acesso card state
  const storageKey = `portal-msg-expandida-${clienteId}`;
  const [msgOpen, setMsgOpen] = useState(() => localStorage.getItem(storageKey) === 'true');
  const [msgCopied, setMsgCopied] = useState(false);

  const firstUser = linkedUsers[0];

  const buildMessage = useCallback(() => {
    const nomeUsuario = firstUser?.nome || cliente?.responsavel_nome || 'Cliente';
    const emailUsuario = firstUser?.email || '';
    return `Olá, ${nomeUsuario}! 👋

Seu portal de inteligência financeira está pronto. A partir de agora você pode acompanhar os números do seu negócio a qualquer momento. 📊

*Seu acesso:*
🔗 Link: https://sistema-gpi.lovable.app/cliente
📧 E-mail: ${emailUsuario}

No portal você encontra:
- Faturamento e Geração de Caixa do mês
- Score de Saúde Financeira
- Alertas e próximas reuniões

Qualquer dúvida, é só chamar! 🚀

_GPI Inteligência Financeira_`;
  }, [firstUser, cliente]);

  const handleMsgCopy = async () => {
    await navigator.clipboard.writeText(buildMessage());
    setMsgCopied(true);
    setTimeout(() => setMsgCopied(false), 2000);
  };

  const handleWhatsApp = () => {
    const whatsapp = cliente?.responsavel_whatsapp;
    if (!whatsapp) {
      toast({ title: 'Nenhum WhatsApp cadastrado', description: 'Adicione o WhatsApp do responsável na aba Contato.', variant: 'destructive' });
      return;
    }
    const phone = whatsapp.replace(/\D/g, '');
    const phoneWithCountry = phone.startsWith('55') ? phone : `55${phone}`;
    window.open(`https://wa.me/${phoneWithCountry}?text=${encodeURIComponent(buildMessage())}`, '_blank');
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const availableForVinculate = allPortalUsers.filter(
    (u) => !linkedUsers.some((lu) => lu.id === u.id)
  ).filter((u) => {
    if (!vinculateSearch) return true;
    const q = vinculateSearch.toLowerCase();
    return u.nome?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6">
      {/* Link de acesso */}
      <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center gap-3">
          <Globe className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold text-txt">Portal do Cliente</h3>
        </div>

        <div className="rounded-lg border border-primary/20 bg-primary/[0.06] p-3 space-y-1">
          <p className="text-[11px] font-medium uppercase text-txt-muted tracking-wide flex items-center gap-1">
            <LinkIcon className="h-3 w-3" /> Link de acesso ao portal
          </p>
          <div className="flex items-center gap-2">
            <code className="text-sm text-primary font-medium">{portalLink}</code>
            <Button
              variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(portalLink);
                setLinkCopied(true);
                setTimeout(() => setLinkCopied(false), 2000);
              }}
            >
              {linkCopied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
              {linkCopied ? 'Copiado!' : 'Copiar'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" onClick={() => window.open(portalLink, '_blank')}>
              <ExternalLink className="h-3.5 w-3.5" /> Abrir
            </Button>
          </div>
        </div>
      </div>

      {/* Usuários com acesso a esta empresa */}
      <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-txt">Usuários com acesso a esta empresa</h3>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={() => setVinculateOpen(true)}>
              <UserPlus className="h-3.5 w-3.5" /> Vincular existente
            </Button>
            <Button
              variant="outline" size="sm" className="gap-1.5 text-xs"
              onClick={() => navigate(`/usuarios-portal?cliente=${clienteId}`)}
            >
              <UserPlus className="h-3.5 w-3.5" /> Criar novo usuário
            </Button>
          </div>
        </div>

        {linkedUsers.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-txt-muted">Nenhum usuário vinculado a esta empresa.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {linkedUsers.map((u: any) => (
              <div key={u.id} className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-txt flex items-center gap-2">
                    👤 {u.nome || '—'}
                  </p>
                  <p className="text-xs text-txt-muted">{u.email || '—'}</p>
                </div>
                <div className="flex items-center gap-2">
                  {u.ativo ? (
                    <Button
                      variant="outline" size="sm"
                      className="gap-1.5 text-xs border-green-500/30 text-green-600 hover:bg-green-500/10"
                      onClick={() => handleToggleAtivoForClient(u.id, true)}
                    >
                      ● Ativo
                    </Button>
                  ) : (
                    <Button
                      variant="outline" size="sm"
                      className="gap-1.5 text-xs text-txt-muted"
                      onClick={() => handleToggleAtivoForClient(u.id, false)}
                    >
                      ○ Inativo
                    </Button>
                  )}
                  <Button
                    variant="outline" size="sm"
                    className="gap-1.5 text-xs"
                    onClick={() => navigate(`/usuarios-portal?usuario=${u.id}`)}
                  >
                    ↗ Gerenciar
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mensagem de acesso (read-only) */}
      {linkedUsers.length > 0 && (
        <Collapsible open={msgOpen} onOpenChange={setMsgOpen}>
          <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
            <div className="flex items-center justify-between">
              <CollapsibleTrigger asChild>
                <button className="flex items-center gap-2 text-left group">
                  <span className="text-lg">📲</span>
                  <h3 className="text-sm font-semibold text-txt">Mensagem de Acesso</h3>
                  <Badge variant="outline" className="border-green-500/30 bg-green-500/10 text-green-600 text-[10px] font-semibold">
                    WhatsApp
                  </Badge>
                  <ChevronDown className={`h-4 w-4 text-txt-muted transition-transform duration-200 ${msgOpen ? 'rotate-180' : ''}`} />
                </button>
              </CollapsibleTrigger>
              <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={handleMsgCopy}>
                {msgCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {msgCopied ? 'Copiado!' : 'Copiar mensagem'}
              </Button>
            </div>
            <CollapsibleContent className="space-y-4">
              <div className="rounded-lg bg-muted p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-txt">
                {buildMessage()}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline" size="sm"
                  className="gap-1.5 border-green-500/30 text-green-600 hover:bg-green-500/10 hover:text-green-700"
                  onClick={handleWhatsApp}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Enviar pelo WhatsApp
                </Button>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      )}

      {/* Modal: Vincular usuário existente */}
      <Dialog open={vinculateOpen} onOpenChange={setVinculateOpen}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Vincular usuário existente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="Buscar por nome ou e-mail..."
              value={vinculateSearch}
              onChange={(e) => setVinculateSearch(e.target.value)}
            />
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border p-2 space-y-1">
              {availableForVinculate.map((u) => (
                <label
                  key={u.id}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${selectedVinculate === u.id ? 'bg-primary/10' : 'hover:bg-muted'}`}
                  onClick={() => setSelectedVinculate(u.id)}
                >
                  <div>
                    <p className="text-sm text-txt">{u.nome || '—'}</p>
                    <p className="text-[11px] text-txt-muted">{u.email}</p>
                  </div>
                </label>
              ))}
              {availableForVinculate.length === 0 && (
                <p className="text-xs text-txt-muted text-center py-2">Nenhum usuário disponível</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVinculateOpen(false)}>Cancelar</Button>
            <Button onClick={handleVinculate} disabled={!selectedVinculate}>Vincular</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
