import { useState, useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reuniao: any;
}

const placeholder = `## Tema apresentado\n\n## Principais discussões\n\n## Dúvidas e respostas\n\n## Próximos passos coletivos`;

export function AtaColetivaSheet({ open, onOpenChange, reuniao }: Props) {
  const [ata, setAta] = useState('');
  const [participantes, setParticipantes] = useState(0);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (reuniao) {
      setAta(reuniao.ata || '');
      setParticipantes(reuniao.participantes_confirmados || 0);
    }
  }, [reuniao]);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('reunioes_coletivas' as any)
        .update({
          ata,
          participantes_confirmados: participantes,
          status: 'realizada',
          realizada_por: user?.id || null,
        } as any)
        .eq('id', reuniao.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reuniao-coletiva', reuniao.id] });
      queryClient.invalidateQueries({ queryKey: ['reunioes-coletivas'] });
      toast({ title: 'Reunião Coletiva registrada com sucesso.' });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[480px] sm:max-w-[480px]">
        <SheetHeader>
          <SheetTitle>Registrar ata</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4 flex-1">
          <div>
            <label className="text-xs text-txt-muted">Participantes confirmados</label>
            <Input type="number" value={participantes} onChange={e => setParticipantes(Number(e.target.value))} className="w-32" />
          </div>
          <div>
            <label className="text-xs text-txt-muted">Ata da reunião</label>
            <Textarea rows={16} value={ata} onChange={e => setAta(e.target.value)} placeholder={placeholder} />
          </div>
        </div>
        <SheetFooter>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Salvando...' : 'Salvar ata e marcar como realizada'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
