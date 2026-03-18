import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from '@/hooks/use-toast';
import { Plus, Pencil, Trash2, KeyRound, Eye, EyeOff, Copy, MessageCircle, Search } from 'lucide-react';

/* ─── Permissions Matrix ─── */
const PERMISSOES: Record<string, string[]> = {
  admin: [
    'Ver todos os clientes',
    'Criar e editar clientes',
    'Importar dados Nibo',
    'DRE + Torre + KPIs',
    'Liberar competências',
    'Gerenciar portal do cliente',
    'Preparar apresentações',
    'Criar usuários internos',
    'Desativar usuários',
    'Excluir clientes',
    'Configurar KPIs padrão',
  ],
  consultor: [
    'Ver todos os clientes',
    'Criar e editar clientes',
    'Importar dados Nibo',
    'DRE + Torre + KPIs',
    'Liberar competências',
    'Gerenciar portal do cliente',
    'Preparar apresentações',
  ],
};

const ALL_PERMISSOES = PERMISSOES.admin;

/* ─── Types ─── */
interface InternalUser {
  id: string;
  nome: string | null;
  email: string | null;
  role: string;
  portal_ativo: boolean | null;
  created_at: string;
}

/* ─── Helpers ─── */
function getInitials(name: string | null) {
  if (!name) return 'U';
  return name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  let pwd = '';
  for (let i = 0; i < 12; i++) pwd += chars[Math.floor(Math.random() * chars.length)];
  return pwd;
}

/* ─── Modal Overlay ─── */
const modalOverlayStyle: React.CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 50,
  background: 'rgba(13,27,53,0.45)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const modalBoxStyle: React.CSSProperties = {
  background: 'white', borderRadius: 16, maxWidth: 480, width: '95%',
  maxHeight: '90vh', overflowY: 'auto', padding: 24,
  animation: 'modalEnter 0.2s ease-out',
};

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  MAIN PAGE                              */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
export default function UsuariosInternosPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalCreate, setModalCreate] = useState(false);
  const [editUser, setEditUser] = useState<InternalUser | null>(null);
  const [passwordUser, setPasswordUser] = useState<InternalUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<InternalUser | null>(null);
  const [senhaSessao, setSenhaSessao] = useState<{ usuarioId: string; senha: string; criadoEm: Date } | null>(null);

  useEffect(() => {
    if (!senhaSessao) return;
    const remaining = Math.max(0, 30 * 60 * 1000 - (Date.now() - senhaSessao.criadoEm.getTime()));
    const t = setTimeout(() => setSenhaSessao(null), remaining);
    return () => clearTimeout(t);
  }, [senhaSessao]);
  useEffect(() => () => setSenhaSessao(null), []);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['internal-users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, nome, email, role, portal_ativo, created_at')
        .in('role', ['admin', 'consultor'])
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as InternalUser[];
    },
  });

  const filtered = users.filter(u => {
    if (!search) return true;
    const q = search.toLowerCase();
    return u.nome?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  const toggleAtivo = async (u: InternalUser) => {
    const newVal = !u.portal_ativo;
    await supabase.from('profiles').update({ portal_ativo: newVal }).eq('id', u.id);
    queryClient.invalidateQueries({ queryKey: ['internal-users'] });
    toast({ title: newVal ? 'Usuário ativado' : 'Usuário desativado' });
  };

  const handleDelete = async () => {
    if (!deleteUser) return;
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: { action: 'delete', user_id: deleteUser.id },
      });
      if (res.error || !res.data?.success) throw new Error(res.data?.error || 'Erro');
      queryClient.invalidateQueries({ queryKey: ['internal-users'] });
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
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0D1B35' }}>Equipe GPI</h1>
          <p style={{ fontSize: 12, color: '#8A9BBC' }}>Gerencie os analistas e administradores da plataforma.</p>
        </div>
        <Button className="gap-2" onClick={() => { setModalCreate(true); }}>
          <Plus className="h-4 w-4" /> Novo usuário
        </Button>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-txt-muted" />
        <Input placeholder="Buscar por nome ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
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
                <TableHead>Usuário</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Permissões</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(u => {
                const isSelf = u.id === user?.id;
                const perms = PERMISSOES[u.role] || [];
                const maxVisible = 3;
                return (
                  <TableRow key={u.id}>
                    {/* USUÁRIO */}
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            width: 36, height: 36, borderRadius: '50%',
                            background: 'rgba(26,60,255,0.1)', color: '#1A3CFF',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 700,
                          }}
                        >
                          {getInitials(u.nome)}
                        </div>
                        <div>
                          <p style={{ fontSize: 13, fontWeight: 700, color: '#0D1B35' }}>{u.nome || '—'}</p>
                          <p style={{ fontSize: 11, color: '#8A9BBC' }}>{u.email || '—'}</p>
                        </div>
                      </div>
                    </TableCell>

                    {/* PAPEL */}
                    <TableCell>
                      {u.role === 'admin' ? (
                        <Badge variant="outline" style={{
                          background: 'rgba(26,60,255,0.1)', borderColor: 'rgba(26,60,255,0.25)',
                          color: '#1A3CFF',
                        }}>⚡ Admin</Badge>
                      ) : (
                        <Badge variant="outline" style={{
                          background: 'rgba(0,153,230,0.08)', borderColor: 'rgba(0,153,230,0.25)',
                          color: '#0099E6',
                        }}>👤 Consultor</Badge>
                      )}
                    </TableCell>

                    {/* STATUS */}
                    <TableCell>
                      {u.portal_ativo ? (
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30 text-[10px]">● Ativo</Badge>
                      ) : (
                        <Badge variant="outline" className="text-txt-muted text-[10px]">● Inativo</Badge>
                      )}
                    </TableCell>

                    {/* PERMISSÕES */}
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {perms.slice(0, maxVisible).map(p => (
                          <span key={p} style={{
                            background: '#F0F4FA', border: '1px solid #DDE4F0', color: '#4A5E80',
                            fontSize: 9, borderRadius: 4, padding: '2px 6px',
                          }}>{p}</span>
                        ))}
                        {perms.length > maxVisible && (
                          <span style={{
                            background: '#F0F4FA', border: '1px solid #DDE4F0', color: '#4A5E80',
                            fontSize: 9, borderRadius: 4, padding: '2px 6px',
                          }}>+{perms.length - maxVisible} mais</span>
                        )}
                      </div>
                    </TableCell>

                    {/* CRIADO EM */}
                    <TableCell className="text-sm text-txt-muted">
                      {new Date(u.created_at).toLocaleDateString('pt-BR')}
                    </TableCell>

                    {/* AÇÕES */}
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1 items-center">
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Editar"
                          onClick={() => setEditUser(u)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Switch
                          checked={!!u.portal_ativo}
                          onCheckedChange={() => toggleAtivo(u)}
                          className="scale-75"
                        />
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0" title="Redefinir senha"
                          onClick={() => setPasswordUser(u)}>
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        {isSelf ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled
                                  style={{ opacity: 0.3, cursor: 'not-allowed' }}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Você não pode excluir seu próprio usuário</TooltipContent>
                          </Tooltip>
                        ) : (
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                            title="Excluir" onClick={() => setDeleteUser(u)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Senha Session Card */}
      {senhaSessao && (
        <SenhaCard senha={senhaSessao.senha} onClear={() => setSenhaSessao(null)} />
      )}

      {/* Create Modal */}
      {modalCreate && (
        <CriarInternoModal
          onClose={() => setModalCreate(false)}
          onCreated={(info) => {
            queryClient.invalidateQueries({ queryKey: ['internal-users'] });
            if (info.senha) {
              setSenhaSessao({ usuarioId: info.userId, senha: info.senha, criadoEm: new Date() });
            }
          }}
        />
      )}

      {/* Edit Modal */}
      {editUser && (
        <EditarInternoModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onUpdated={() => {
            queryClient.invalidateQueries({ queryKey: ['internal-users'] });
            setEditUser(null);
          }}
        />
      )}

      {/* Password Modal */}
      {passwordUser && (
        <RedefinirSenhaModal
          user={passwordUser}
          onClose={() => setPasswordUser(null)}
          onDone={(senha) => {
            setSenhaSessao({ usuarioId: passwordUser.id, senha, criadoEm: new Date() });
            setPasswordUser(null);
          }}
        />
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={o => { if (!o) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover {deleteUser?.nome}?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação é irreversível. O usuário perderá acesso à plataforma.
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

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  PERMISSION LIST                        */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function PermissoesList({ role }: { role: string }) {
  const active = PERMISSOES[role] || [];
  return (
    <div className="space-y-1 mt-2">
      <p style={{ fontSize: 11, fontWeight: 600, color: '#4A5E80' }}>Permissões do papel selecionado:</p>
      {ALL_PERMISSOES.map(p => {
        const has = active.includes(p);
        return (
          <div key={p} className="flex items-center gap-2" style={{ fontSize: 12 }}>
            <span style={{ color: has ? '#16a34a' : '#9ca3af' }}>{has ? '✓' : '✗'}</span>
            <span style={{ color: has ? '#0D1B35' : '#9ca3af' }}>{p}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  SENHA CARD                             */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function SenhaCard({ senha, onClear }: { senha: string; onClear: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(senha);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="rounded-xl border border-yellow-300 bg-yellow-50 p-4">
      <p className="text-sm font-medium text-yellow-800 mb-2">🔑 Senha gerada (expira da tela em 30 min)</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded bg-white px-3 py-2 font-mono text-sm border">{senha}</code>
        <Button variant="outline" size="sm" onClick={copy}>
          {copied ? <span className="text-green-600">Copiado!</span> : <><Copy className="h-3.5 w-3.5 mr-1" /> Copiar</>}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClear}>Limpar</Button>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  CREATE MODAL                           */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function CriarInternoModal({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (info: { userId: string; nome: string; email: string; senha: string }) => void;
}) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<string>('consultor');
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!nome.trim() || !email.trim()) {
      toast({ title: 'Preencha nome e e-mail', variant: 'destructive' });
      return;
    }
    if (senha.length < 6) {
      toast({ title: 'A senha deve ter pelo menos 6 caracteres', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: { action: 'create', email: email.trim(), password: senha, nome: nome.trim(), role, cliente_id: null },
      });
      if (res.error || !res.data?.success) {
        if (res.data?.error === 'email_exists') {
          toast({ title: 'E-mail já cadastrado', variant: 'destructive' });
          return;
        }
        throw new Error(res.data?.error || 'Erro ao criar usuário');
      }
      const newUserId = res.data.profile.id;
      toast({ title: `Usuário ${nome.trim()} criado com sucesso ✓` });
      onClose();
      onCreated({ userId: newUserId, nome: nome.trim(), email: email.trim(), senha });
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={modalOverlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalBoxStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0D1B35', marginBottom: 20 }}>Novo Usuário Interno</h2>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome completo *</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome completo" />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail *</Label>
            <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@gpi.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Papel *</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="consultor">Consultor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Senha inicial *</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-txt-muted"
                  onClick={() => setShowSenha(!showSenha)}>
                  {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button variant="outline" size="sm" onClick={() => setSenha(generatePassword())}>Gerar senha</Button>
            </div>
          </div>
          <PermissoesList role={role} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Criando...' : 'Criar usuário'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  EDIT MODAL                             */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function EditarInternoModal({ user, onClose, onUpdated }: {
  user: InternalUser; onClose: () => void; onUpdated: () => void;
}) {
  const [nome, setNome] = useState(user.nome || '');
  const [role, setRole] = useState(user.role);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!nome.trim()) {
      toast({ title: 'Nome é obrigatório', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from('profiles').update({ nome: nome.trim(), role }).eq('id', user.id);
      if (error) throw error;
      toast({ title: 'Alterações salvas ✓' });
      onUpdated();
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={modalOverlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalBoxStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0D1B35', marginBottom: 20 }}>Editar Usuário</h2>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Nome completo *</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>E-mail</Label>
            <Input value={user.email || ''} disabled className="bg-muted" />
          </div>
          <div className="space-y-1.5">
            <Label>Papel *</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="admin">Admin</SelectItem>
                <SelectItem value="consultor">Consultor</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <PermissoesList role={role} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
/*  PASSWORD MODAL                         */
/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */
function RedefinirSenhaModal({ user, onClose, onDone }: {
  user: InternalUser; onClose: () => void; onDone: (senha: string) => void;
}) {
  const [mode, setMode] = useState<'choose' | 'manual'>('choose');
  const [senha, setSenha] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);

  const doReset = async (pwd: string) => {
    setLoading(true);
    try {
      const res = await supabase.functions.invoke('criar-usuario', {
        body: { action: 'update_password', user_id: user.id, nova_senha: pwd },
      });
      if (res.error || !res.data?.success) throw new Error(res.data?.error || 'Erro');
      toast({ title: 'Senha redefinida ✓' });
      onDone(pwd);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={modalOverlayStyle} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={modalBoxStyle}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0D1B35', marginBottom: 8 }}>Redefinir Senha</h2>
        <p style={{ fontSize: 13, color: '#8A9BBC', marginBottom: 20 }}>{user.nome} ({user.email})</p>

        {mode === 'choose' ? (
          <div className="space-y-3">
            <Button className="w-full justify-start gap-2" variant="outline"
              onClick={() => doReset(generatePassword())} disabled={loading}>
              <KeyRound className="h-4 w-4" /> Gerar senha aleatória
            </Button>
            <Button className="w-full justify-start gap-2" variant="outline"
              onClick={() => setMode('manual')}>
              <Pencil className="h-4 w-4" /> Definir senha manualmente
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Nova senha *</Label>
              <div className="relative">
                <Input
                  type={showSenha ? 'text' : 'password'}
                  value={senha}
                  onChange={e => setSenha(e.target.value)}
                  placeholder="Mínimo 6 caracteres"
                />
                <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-txt-muted"
                  onClick={() => setShowSenha(!showSenha)}>
                  {showSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMode('choose')}>Voltar</Button>
              <Button onClick={() => doReset(senha)} disabled={loading || senha.length < 6}>
                {loading ? 'Salvando...' : 'Redefinir senha'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end mt-4">
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
}
