import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Pencil, Trash2, Plus, Mail, Phone } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { segmentLabels, faixaLabels, statusLabels } from '@/lib/clientes-utils';

interface ContatoTabProps {
  clienteId: string;
  cliente: any;
}

/* ─── helpers ─── */
const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <p className="text-[11px] uppercase tracking-[0.05em] text-[hsl(var(--txt-muted))] mb-3 font-semibold">{children}</p>
);

const FieldDisplay = ({ label, value }: { label: string; value?: string | null }) => (
  <div className="space-y-0.5">
    <p className="text-[11px] text-[hsl(var(--txt-muted))]">{label}</p>
    <p className="text-sm font-medium text-txt">{value || '—'}</p>
  </div>
);

/* ─── main component ─── */
export function ContatoTab({ clienteId, cliente }: ContatoTabProps) {
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [socioDialogOpen, setSocioDialogOpen] = useState(false);
  const [editingSocio, setEditingSocio] = useState<any | null>(null);
  const [deletingSocioId, setDeletingSocioId] = useState<string | null>(null);

  /* ── sócios query ── */
  const { data: socios = [] } = useQuery({
    queryKey: ['socios', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('socios' as any)
        .select('*')
        .eq('cliente_id', clienteId)
        .order('ordem', { ascending: true });
      if (error) throw error;
      return data as any[];
    },
  });

  /* ── mutations ── */
  const updateCliente = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase.from('clientes').update(updates as any).eq('id', clienteId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', clienteId] });
      toast({ title: 'Dados atualizados' });
    },
  });

  const upsertSocio = useMutation({
    mutationFn: async (socio: any) => {
      if (socio.id) {
        const { error } = await supabase.from('socios' as any).update(socio).eq('id', socio.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('socios' as any).insert({ ...socio, cliente_id: clienteId });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socios', clienteId] });
      toast({ title: editingSocio?.id ? 'Sócio atualizado' : 'Sócio adicionado' });
      setSocioDialogOpen(false);
      setEditingSocio(null);
    },
  });

  const deleteSocio = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('socios' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['socios', clienteId] });
      toast({ title: 'Sócio removido' });
      setDeletingSocioId(null);
    },
  });

  const totalPct = socios.reduce((s: number, sc: any) => s + (Number(sc.participacao_percentual) || 0), 0);

  return (
    <div className="space-y-4">
      {/* ── DADOS CADASTRAIS ── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Dados Cadastrais</SectionTitle>
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={() => { setEditOpen(true); }}>
            <Pencil className="h-3.5 w-3.5" /> Editar
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <FieldDisplay label="Razão Social" value={cliente.razao_social} />
          <FieldDisplay label="CNPJ" value={cliente.cnpj} />
          <FieldDisplay label="Nome Empresa" value={cliente.nome_empresa} />
          <FieldDisplay label="Segmento" value={segmentLabels[cliente.segmento] || cliente.segmento} />
          <FieldDisplay label="Faixa de Faturamento" value={faixaLabels[cliente.faturamento_faixa] || cliente.faturamento_faixa} />
          <FieldDisplay label="Status" value={statusLabels[cliente.status] || cliente.status} />
          <FieldDisplay label="Endereço" value={cliente.endereco_completo} />
          <FieldDisplay label="CEP" value={cliente.cep} />
        </div>
      </div>

      {/* ── RESPONSÁVEL FINANCEIRO ── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <SectionTitle>Responsável Financeiro</SectionTitle>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <FieldDisplay label="Nome" value={cliente.responsavel_nome} />
          <FieldDisplay label="E-mail" value={cliente.responsavel_email} />
          <FieldDisplay label="WhatsApp" value={cliente.responsavel_whatsapp} />
          <FieldDisplay label="Administrador" value={cliente.administrador_nome} />
          <FieldDisplay label="CPF Administrador" value={cliente.administrador_cpf} />
        </div>
      </div>

      {/* ── QUADRO SOCIETÁRIO ── */}
      <div className="rounded-xl border border-border bg-surface p-5">
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Quadro Societário</SectionTitle>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => { setEditingSocio(null); setSocioDialogOpen(true); }}
          >
            <Plus className="h-3.5 w-3.5" /> Sócio
          </Button>
        </div>

        {socios.length === 0 ? (
          <p className="text-sm text-txt-muted">Nenhum sócio cadastrado.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {socios.map((s: any) => (
              <div key={s.id} className="rounded-lg border border-border bg-background p-4 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-txt">{s.nome}</span>
                  {s.participacao_percentual != null && (
                    <span className="rounded-md bg-primary/5 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {Number(s.participacao_percentual).toLocaleString('pt-BR')}%
                    </span>
                  )}
                </div>
                {s.cargo && <p className="text-xs text-txt-sec">{s.cargo}</p>}
                {s.cpf && <p className="text-xs text-txt-muted">{s.cpf}</p>}
                <div className="flex items-center gap-3 text-xs text-txt-sec">
                  {s.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{s.email}</span>}
                  {s.whatsapp && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{s.whatsapp}</span>}
                </div>
                <div className="flex justify-end gap-1 pt-1">
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={() => { setEditingSocio(s); setSocioDialogOpen(true); }}>
                    <Pencil className="h-3 w-3" /> Editar
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive" onClick={() => setDeletingSocioId(s.id)}>
                    <Trash2 className="h-3 w-3" /> Remover
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {socios.length > 0 && (
          <p className={`mt-3 text-xs font-medium ${
            totalPct === 100 ? 'text-green' : totalPct > 100 ? 'text-red' : 'text-amber'
          }`}>
            Total: {totalPct.toLocaleString('pt-BR')}%
            {totalPct === 100 ? ' ✓' : totalPct < 100 ? ` (⚠ faltam ${(100 - totalPct).toLocaleString('pt-BR')}%)` : ' (⚠ excede 100%)'}
          </p>
        )}
      </div>

      {/* ── Observações ── */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-2">
        <SectionTitle>Observações Internas</SectionTitle>
        <Textarea
          defaultValue={cliente.observacoes || ''}
          placeholder="Notas sobre este cliente..."
          onBlur={(e) => {
            if (e.target.value !== (cliente.observacoes || '')) {
              updateCliente.mutate({ observacoes: e.target.value });
            }
          }}
          className="min-h-[80px]"
        />
      </div>

      <div className="rounded-xl border border-border bg-surface p-5 text-xs text-txt-muted">
        Cadastrado em: {new Date(cliente.created_at).toLocaleDateString('pt-BR')}
      </div>

      {/* ── MODAL EDITAR DADOS ── */}
      <EditClienteDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        cliente={cliente}
        onSave={(data) => {
          updateCliente.mutate(data, { onSuccess: () => setEditOpen(false) });
        }}
        saving={updateCliente.isPending}
      />

      {/* ── MODAL SÓCIO ── */}
      <SocioDialog
        open={socioDialogOpen}
        onOpenChange={(v) => { setSocioDialogOpen(v); if (!v) setEditingSocio(null); }}
        socio={editingSocio}
        onSave={(data) => upsertSocio.mutate(data)}
        saving={upsertSocio.isPending}
      />

      {/* ── CONFIRM DELETE ── */}
      <AlertDialog open={!!deletingSocioId} onOpenChange={() => setDeletingSocioId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover sócio</AlertDialogTitle>
            <AlertDialogDescription>Tem certeza que deseja remover este sócio? Esta ação não pode ser desfeita.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => deletingSocioId && deleteSocio.mutate(deletingSocioId)}>Remover</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ═══════════════════════════════════════════
   EDIT CLIENTE DIALOG
   ═══════════════════════════════════════════ */
function EditClienteDialog({ open, onOpenChange, cliente, onSave, saving }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cliente: any;
  onSave: (data: Record<string, any>) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Record<string, string>>({});

  // Always sync form with cliente data when dialog opens
  useEffect(() => {
    if (open) {
      setForm({
        razao_social: cliente.razao_social || '',
        cnpj: cliente.cnpj || '',
        nome_empresa: cliente.nome_empresa || '',
        segmento: cliente.segmento || '',
        faturamento_faixa: cliente.faturamento_faixa || '',
        endereco_completo: cliente.endereco_completo || '',
        cep: cliente.cep || '',
        status: cliente.status || 'ativo',
        responsavel_nome: cliente.responsavel_nome || '',
        responsavel_email: cliente.responsavel_email || '',
        responsavel_whatsapp: cliente.responsavel_whatsapp || '',
        administrador_nome: cliente.administrador_nome || '',
        administrador_cpf: cliente.administrador_cpf || '',
        observacoes: cliente.observacoes || '',
      });
    }
  }, [open, cliente]);

  const set = (key: string, val: string) => setForm((p) => ({ ...p, [key]: val }));

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-[560px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar dados do cliente</DialogTitle>
          <DialogDescription>Atualize as informações cadastrais, do responsável e do administrador.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div><Label className="text-xs">Razão Social</Label><Input value={form.razao_social || ''} onChange={(e) => set('razao_social', e.target.value)} /></div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">CNPJ</Label><Input value={form.cnpj || ''} onChange={(e) => set('cnpj', e.target.value)} /></div>
            <div><Label className="text-xs">Nome Empresa</Label><Input value={form.nome_empresa || ''} onChange={(e) => set('nome_empresa', e.target.value)} /></div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Segmento</Label>
              <Select value={form.segmento} onValueChange={(v) => set('segmento', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(segmentLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Faixa de Faturamento</Label>
              <Select value={form.faturamento_faixa} onValueChange={(v) => set('faturamento_faixa', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(faixaLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div><Label className="text-xs">Endereço Completo</Label><Input value={form.endereco_completo || ''} onChange={(e) => set('endereco_completo', e.target.value)} /></div>

          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">CEP</Label><Input value={form.cep || ''} onChange={(e) => set('cep', e.target.value)} /></div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(statusLabels).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-[11px] uppercase tracking-[0.05em] text-txt-muted font-semibold mb-2">Responsável Financeiro</p>
          </div>
          <div><Label className="text-xs">Nome</Label><Input value={form.responsavel_nome || ''} onChange={(e) => set('responsavel_nome', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">E-mail</Label><Input value={form.responsavel_email || ''} onChange={(e) => set('responsavel_email', e.target.value)} /></div>
            <div><Label className="text-xs">WhatsApp</Label><Input value={form.responsavel_whatsapp || ''} onChange={(e) => set('responsavel_whatsapp', e.target.value)} /></div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-[11px] uppercase tracking-[0.05em] text-txt-muted font-semibold mb-2">Administrador</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">Nome</Label><Input value={form.administrador_nome || ''} onChange={(e) => set('administrador_nome', e.target.value)} /></div>
            <div><Label className="text-xs">CPF</Label><Input value={form.administrador_cpf || ''} onChange={(e) => set('administrador_cpf', e.target.value)} /></div>
          </div>

          <div><Label className="text-xs">Observações</Label><Textarea value={form.observacoes || ''} onChange={(e) => set('observacoes', e.target.value)} className="min-h-[80px]" /></div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => onSave(form)} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alterações'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ═══════════════════════════════════════════
   SOCIO DIALOG
   ═══════════════════════════════════════════ */
function SocioDialog({ open, onOpenChange, socio, onSave, saving }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  socio: any | null;
  onSave: (data: any) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<Record<string, string>>({});
  const isEdit = !!socio?.id;

  const handleOpen = (v: boolean) => {
    if (v) {
      setForm({
        nome: socio?.nome || '',
        cpf: socio?.cpf || '',
        participacao_percentual: socio?.participacao_percentual?.toString() || '',
        cargo: socio?.cargo || '',
        email: socio?.email || '',
        whatsapp: socio?.whatsapp || '',
      });
    }
    onOpenChange(v);
  };

  const set = (key: string, val: string) => setForm((p) => ({ ...p, [key]: val }));

  const handleSave = () => {
    if (!form.nome?.trim()) {
      toast({ title: 'Nome é obrigatório', variant: 'destructive' });
      return;
    }
    const payload: any = {
      nome: form.nome.trim(),
      cpf: form.cpf || null,
      participacao_percentual: form.participacao_percentual ? Number(form.participacao_percentual) : null,
      cargo: form.cargo || null,
      email: form.email || null,
      whatsapp: form.whatsapp || null,
    };
    if (isEdit) payload.id = socio.id;
    onSave(payload);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar sócio' : 'Adicionar sócio'}</DialogTitle>
          <DialogDescription>{isEdit ? 'Atualize os dados do sócio.' : 'Preencha os dados do novo sócio.'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div><Label className="text-xs">Nome *</Label><Input value={form.nome || ''} onChange={(e) => set('nome', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">CPF</Label><Input value={form.cpf || ''} onChange={(e) => set('cpf', e.target.value)} /></div>
            <div><Label className="text-xs">% Participação</Label><Input type="number" step="0.01" value={form.participacao_percentual || ''} onChange={(e) => set('participacao_percentual', e.target.value)} /></div>
          </div>
          <div><Label className="text-xs">Cargo</Label><Input value={form.cargo || ''} onChange={(e) => set('cargo', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label className="text-xs">E-mail</Label><Input value={form.email || ''} onChange={(e) => set('email', e.target.value)} /></div>
            <div><Label className="text-xs">WhatsApp</Label><Input value={form.whatsapp || ''} onChange={(e) => set('whatsapp', e.target.value)} /></div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Salvando...' : isEdit ? 'Salvar' : 'Adicionar sócio'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
