import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reuniao?: any;
  preselectedClienteId?: string;
}

export function ReuniaoDialog({ open, onOpenChange, reuniao, preselectedClienteId }: Props) {
  const queryClient = useQueryClient();
  const [tipo, setTipo] = useState<'individual' | 'coletiva'>('individual');
  const [clienteId, setClienteId] = useState('');
  const [titulo, setTitulo] = useState('');
  const [dataReuniao, setDataReuniao] = useState('');
  const [horario, setHorario] = useState('');
  const [formato, setFormato] = useState<'presencial' | 'video'>('video');
  const [pauta, setPauta] = useState('');

  const { data: clientes } = useQuery({
    queryKey: ['clientes-ativos'],
    queryFn: async () => {
      const { data } = await supabase.from('clientes').select('id, nome_empresa').eq('status', 'ativo').order('nome_empresa');
      return data || [];
    },
  });

  useEffect(() => {
    if (reuniao) {
      setTipo(reuniao.tipo);
      setClienteId(reuniao.cliente_id || '');
      setTitulo(reuniao.titulo);
      setDataReuniao(reuniao.data_reuniao);
      setHorario(reuniao.horario || '');
      setFormato(reuniao.formato || 'video');
      setPauta(reuniao.pauta || '');
    } else {
      setTipo('individual');
      setClienteId(preselectedClienteId || '');
      setTitulo('');
      setDataReuniao(new Date().toISOString().split('T')[0]);
      setHorario('');
      setFormato('video');
      setPauta('');
    }
  }, [reuniao, preselectedClienteId, open]);

  // Auto-fill title
  useEffect(() => {
    if (reuniao) return;
    if (tipo === 'coletiva') {
      const now = new Date();
      setTitulo(`Reunião Coletiva Mensal — ${now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}`);
    } else if (clienteId && clientes) {
      const c = clientes.find((c) => c.id === clienteId);
      if (c) setTitulo(`Reunião Individual — ${c.razao_social || c.nome_empresa}`);
    }
  }, [tipo, clienteId, clientes, reuniao]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        tipo,
        titulo,
        data_reuniao: dataReuniao,
        horario: horario || null,
        formato,
        pauta: pauta || null,
        cliente_id: tipo === 'individual' ? clienteId : null,
      };
      if (reuniao) {
        const { error } = await supabase.from('reunioes' as any).update(payload as any).eq('id', reuniao.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('reunioes' as any).insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reunioes'] });
      queryClient.invalidateQueries({ queryKey: ['proxima-reuniao'] });
      toast({ title: reuniao ? 'Reunião atualizada.' : 'Reunião agendada com sucesso.' });
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{reuniao ? 'Editar Reunião' : 'Agendar Reunião'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label className="text-xs mb-1.5">Tipo</Label>
            <RadioGroup value={tipo} onValueChange={(v) => setTipo(v as any)} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="individual" id="tipo-ind" />
                <Label htmlFor="tipo-ind" className="text-sm">Individual</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="coletiva" id="tipo-col" />
                <Label htmlFor="tipo-col" className="text-sm">Coletiva</Label>
              </div>
            </RadioGroup>
          </div>

          {tipo === 'individual' && (
            <div>
              <Label className="text-xs mb-1.5">Cliente *</Label>
              <Select value={clienteId} onValueChange={setClienteId}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {clientes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.razao_social || c.nome_empresa}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs mb-1.5">Título *</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5">Data *</Label>
              <Input type="date" value={dataReuniao} onChange={(e) => setDataReuniao(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs mb-1.5">Horário</Label>
              <Input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1.5">Formato</Label>
            <RadioGroup value={formato} onValueChange={(v) => setFormato(v as any)} className="flex gap-4">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="presencial" id="fmt-p" />
                <Label htmlFor="fmt-p" className="text-sm">Presencial</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="video" id="fmt-v" />
                <Label htmlFor="fmt-v" className="text-sm">Vídeo</Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label className="text-xs mb-1.5">Pauta</Label>
            <Textarea value={pauta} onChange={(e) => setPauta(e.target.value)} placeholder="Pontos a discutir..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={!titulo || !dataReuniao || (tipo === 'individual' && !clienteId)}
          >
            {reuniao ? 'Salvar' : 'Agendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
