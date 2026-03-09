import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reuniao: any;
}

const PLACEHOLDER = `## Pontos discutidos\n\n## Decisões tomadas\n\n## Próximos passos\n\n## Prazo`;

export function AtaSheet({ open, onOpenChange, reuniao }: Props) {
  const [ata, setAta] = useState(reuniao?.ata || '');
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('reunioes' as any)
        .update({ ata, status: 'realizada' } as any)
        .eq('id', reuniao.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reunioes'] });
      toast({ title: 'Ata registrada. Reunião marcada como realizada.' });
      onOpenChange(false);
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Registrar Ata</SheetTitle>
          <p className="text-sm text-txt-muted">{reuniao?.titulo}</p>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <Textarea
            value={ata}
            onChange={(e) => setAta(e.target.value)}
            placeholder={PLACEHOLDER}
            className="min-h-[300px] font-mono text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!ata.trim()}>
              Salvar ata
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
