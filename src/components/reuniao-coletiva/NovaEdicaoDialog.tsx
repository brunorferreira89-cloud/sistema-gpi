import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NovaEdicaoDialog({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();

  const now = new Date();
  const mesAno = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const defaultTitulo = `Reunião Coletiva GPI — ${mesAno.charAt(0).toUpperCase() + mesAno.slice(1)}`;

  // Default date: 15th of current month or next month
  const defaultDay = now.getDate() > 20 ? 15 : 15;
  const defaultMonth = now.getDate() > 20 ? now.getMonth() + 1 : now.getMonth();
  const defaultDate = new Date(now.getFullYear(), defaultMonth, defaultDay);
  const defaultDateStr = defaultDate.toISOString().split('T')[0];

  const [titulo, setTitulo] = useState(defaultTitulo);
  const [dataReuniao, setDataReuniao] = useState(defaultDateStr);
  const [horario, setHorario] = useState('14:00');

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('reunioes_coletivas' as any).insert({
        titulo,
        data_reuniao: dataReuniao,
        horario: horario || null,
        formato: 'hibrido',
        status: 'planejando',
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reunioes-coletivas'] });
      toast({ title: 'Nova edição criada com sucesso.' });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Planejar nova edição</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <label className="text-xs text-txt-muted">Título</label>
            <Input value={titulo} onChange={e => setTitulo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-txt-muted">Data</label>
              <Input type="date" value={dataReuniao} onChange={e => setDataReuniao(e.target.value)} />
            </div>
            <div>
              <label className="text-xs text-txt-muted">Horário</label>
              <Input type="time" value={horario} onChange={e => setHorario(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={!titulo || !dataReuniao || mutation.isPending}>
            {mutation.isPending ? 'Criando...' : 'Criar edição'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
