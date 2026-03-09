import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { toDateString } from '@/lib/kanban-utils';

interface Tarefa {
  id?: string;
  cliente_id: string;
  tipo: string;
  titulo: string;
  descricao?: string;
  prioridade: string;
  responsavel_id?: string;
  data_tarefa: string;
  observacao?: string;
  status?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tarefa?: Tarefa | null;
  clientes: { id: string; nome_empresa: string }[];
  analistas: { id: string; nome: string | null }[];
  defaultDate: Date;
  onSaved: () => void;
}

export function TarefaDialog({ open, onOpenChange, tarefa, clientes, analistas, defaultDate, onSaved }: Props) {
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<Tarefa>({
    cliente_id: '',
    tipo: 'auditoria_diaria',
    titulo: '',
    descricao: '',
    prioridade: 'normal',
    responsavel_id: '',
    data_tarefa: toDateString(defaultDate),
    observacao: '',
  });

  useEffect(() => {
    if (tarefa) {
      setForm({
        cliente_id: tarefa.cliente_id,
        tipo: tarefa.tipo,
        titulo: tarefa.titulo,
        descricao: tarefa.descricao || '',
        prioridade: tarefa.prioridade,
        responsavel_id: tarefa.responsavel_id || '',
        data_tarefa: tarefa.data_tarefa,
        observacao: tarefa.observacao || '',
      });
    } else {
      setForm({
        cliente_id: '',
        tipo: 'auditoria_diaria',
        titulo: '',
        descricao: '',
        prioridade: 'normal',
        responsavel_id: '',
        data_tarefa: toDateString(defaultDate),
        observacao: '',
      });
    }
  }, [tarefa, defaultDate, open]);

  const set = (key: string, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (!form.cliente_id || !form.tipo || !form.titulo || !form.data_tarefa) {
      toast({ title: 'Preencha os campos obrigatórios', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const payload: any = {
        cliente_id: form.cliente_id,
        tipo: form.tipo,
        titulo: form.titulo,
        descricao: form.descricao || null,
        prioridade: form.prioridade,
        responsavel_id: form.responsavel_id || null,
        data_tarefa: form.data_tarefa,
        observacao: form.observacao || null,
      };
      if (tarefa?.id) {
        const { error } = await supabase.from('tarefas_operacionais' as any).update(payload).eq('id', tarefa.id);
        if (error) throw error;
        toast({ title: 'Tarefa atualizada' });
      } else {
        payload.status = 'pendente';
        const { error } = await supabase.from('tarefas_operacionais' as any).insert(payload);
        if (error) throw error;
        toast({ title: 'Tarefa criada' });
      }
      onSaved();
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Erro', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tarefa?.id ? 'Editar Tarefa' : 'Nova Tarefa'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Cliente *</Label>
            <Select value={form.cliente_id} onValueChange={(v) => set('cliente_id', v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {clientes.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Tipo *</Label>
              <Select value={form.tipo} onValueChange={(v) => set('tipo', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auditoria_diaria">Auditoria Diária</SelectItem>
                  <SelectItem value="alerta_semanal">Alerta Semanal</SelectItem>
                  <SelectItem value="suporte">Suporte</SelectItem>
                  <SelectItem value="reuniao">Reunião</SelectItem>
                  <SelectItem value="outro">Outro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Prioridade</Label>
              <Select value={form.prioridade} onValueChange={(v) => set('prioridade', v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="alta">Alta</SelectItem>
                  <SelectItem value="critica">Crítica</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Título *</Label>
            <Input value={form.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Título da tarefa" />
          </div>
          <div className="space-y-1.5">
            <Label>Descrição</Label>
            <Textarea value={form.descricao} onChange={(e) => set('descricao', e.target.value)} placeholder="Detalhes..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Responsável</Label>
              <Select value={form.responsavel_id} onValueChange={(v) => set('responsavel_id', v)}>
                <SelectTrigger><SelectValue placeholder="Não atribuído" /></SelectTrigger>
                <SelectContent>
                  {analistas.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.nome || 'Sem nome'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Data *</Label>
              <Input type="date" value={form.data_tarefa} onChange={(e) => set('data_tarefa', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Observação</Label>
            <Textarea value={form.observacao} onChange={(e) => set('observacao', e.target.value)} placeholder="Notas..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={loading}>{loading ? 'Salvando...' : 'Salvar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
