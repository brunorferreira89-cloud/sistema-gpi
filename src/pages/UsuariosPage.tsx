import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import { UserPlus, Search, Shield, User, Eye } from 'lucide-react';

export default function UsuariosPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Fetch profiles
  const { data: usuarios, isLoading } = useQuery({
    queryKey: ['usuarios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nome, role, cliente_id, portal_ativo, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch clientes for linking
  const { data: clientes } = useQuery({
    queryKey: ['clientes-list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('clientes')
        .select('id, nome_empresa, razao_social')
        .order('nome_empresa');
      if (error) throw error;
      return data as any[];
    },
  });

  const filtered = (usuarios || []).filter((u) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (u.nome || '').toLowerCase().includes(s) || (u.role || '').toLowerCase().includes(s);
  });

  const roleLabel = (r: string) => {
    if (r === 'admin') return 'Admin';
    if (r === 'consultor') return 'Consultor';
    if (r === 'cliente') return 'Cliente';
    return r;
  };

  const roleColor = (r: string) => {
    if (r === 'admin') return 'bg-primary/10 text-primary';
    if (r === 'consultor') return 'bg-cyan/10 text-cyan';
    if (r === 'cliente') return 'bg-green/10 text-green';
    return 'bg-muted text-txt-muted';
  };

  const getClienteName = (clienteId: string | null) => {
    if (!clienteId || !clientes) return null;
    const c = clientes.find((cl: any) => cl.id === clienteId);
    return c ? (c.razao_social || c.nome_empresa) : null;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt">Usuários</h1>
          <p className="text-sm text-txt-muted">{usuarios?.length || 0} usuários cadastrados</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-2">
          <UserPlus className="h-4 w-4" />
          Novo Usuário
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-txt-muted" />
        <Input
          placeholder="Buscar por nome ou tipo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-hi/50">
              <th className="px-4 py-3 text-left font-semibold text-txt-muted">Nome</th>
              <th className="px-4 py-3 text-left font-semibold text-txt-muted">Tipo</th>
              <th className="px-4 py-3 text-left font-semibold text-txt-muted">Vinculado a</th>
              <th className="px-4 py-3 text-left font-semibold text-txt-muted">Portal</th>
              <th className="px-4 py-3 text-left font-semibold text-txt-muted">Criado em</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.id} className="border-b border-border/50 hover:bg-surface-hi/30 transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {(u.nome || 'U').charAt(0).toUpperCase()}
                    </div>
                    <span className="font-medium text-txt">{u.nome || '—'}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${roleColor(u.role)}`}>
                    {u.role === 'admin' ? <Shield className="h-3 w-3" /> : <User className="h-3 w-3" />}
                    {roleLabel(u.role)}
                  </span>
                </td>
                <td className="px-4 py-3 text-txt-muted">
                  {u.role === 'cliente' ? getClienteName(u.cliente_id) || '—' : '—'}
                </td>
                <td className="px-4 py-3">
                  {u.role === 'cliente' ? (
                    u.portal_ativo ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green font-medium">
                        <Eye className="h-3 w-3" /> Ativo
                      </span>
                    ) : (
                      <span className="text-xs text-txt-muted">Inativo</span>
                    )
                  ) : (
                    <span className="text-xs text-txt-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-xs text-txt-muted">
                  {new Date(u.created_at).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-sm text-txt-muted">
                  Nenhum usuário encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <NovoUsuarioDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clientes={clientes || []}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['usuarios'] })}
      />
    </div>
  );
}

function NovoUsuarioDialog({
  open,
  onOpenChange,
  clientes,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientes: any[];
  onSuccess: () => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [role, setRole] = useState<string>('consultor');
  const [clienteId, setClienteId] = useState<string>('');
  const [portalAtivo, setPortalAtivo] = useState(false);
  const [loading, setLoading] = useState(false);

  const reset = () => {
    setNome('');
    setEmail('');
    setSenha('');
    setRole('consultor');
    setClienteId('');
    setPortalAtivo(false);
  };

  const handleCreate = async () => {
    if (!nome || !email || !senha) {
      toast({ title: 'Preencha todos os campos obrigatórios', variant: 'destructive' });
      return;
    }
    if (senha.length < 6) {
      toast({ title: 'A senha deve ter pelo menos 6 caracteres', variant: 'destructive' });
      return;
    }
    if (role === 'cliente' && !clienteId) {
      toast({ title: 'Selecione o cliente vinculado', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('criar-usuario', {
        body: {
          email,
          senha,
          nome,
          role,
          cliente_id: role === 'cliente' ? clienteId : null,
          portal_ativo: role === 'cliente' ? portalAtivo : false,
        },
      });

      if (res.error || !res.data?.success) {
        throw new Error(res.data?.error || res.error?.message || 'Erro ao criar usuário');
      }

      toast({ title: 'Usuário criado com sucesso!' });
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast({ title: 'Erro ao criar usuário', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo Usuário</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Nome *</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail *</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@exemplo.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Senha *</Label>
            <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Mínimo 6 caracteres" />
          </div>
          <div className="space-y-1.5">
            <Label>Tipo de usuário *</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="consultor">Consultor</SelectItem>
                <SelectItem value="cliente">Cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {role === 'cliente' && (
            <>
              <div className="space-y-1.5">
                <Label>Vincular ao cliente *</Label>
                <Select value={clienteId} onValueChange={setClienteId}>
                  <SelectTrigger><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
                  <SelectContent>
                    {clientes.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.razao_social || c.nome_empresa}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-3">
                <div>
                  <p className="text-sm font-medium text-txt">Ativar Portal do Cliente</p>
                  <p className="text-xs text-txt-muted">Permite acesso ao portal /cliente</p>
                </div>
                <Switch checked={portalAtivo} onCheckedChange={setPortalAtivo} />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCreate} disabled={loading} className="gap-2">
            {loading && <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />}
            Criar Usuário
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
