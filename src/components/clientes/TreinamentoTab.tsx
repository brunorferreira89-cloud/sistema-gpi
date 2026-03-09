import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';

interface Props {
  clienteId: string;
}

export function TreinamentoTab({ clienteId }: Props) {
  const queryClient = useQueryClient();
  const [openObs, setOpenObs] = useState<Record<string, boolean>>({});

  const { data: modulos = [] } = useQuery({
    queryKey: ['treinamento', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('treinamento_progresso' as any)
        .select('*')
        .eq('cliente_id', clienteId)
        .order('ordem');
      if (error) throw error;
      return data as any[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, concluido }: { id: string; concluido: boolean }) => {
      const { error } = await supabase
        .from('treinamento_progresso' as any)
        .update({
          concluido,
          concluido_em: concluido ? new Date().toISOString() : null,
        } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treinamento', clienteId] }),
  });

  const obsMutation = useMutation({
    mutationFn: async ({ id, observacao }: { id: string; observacao: string }) => {
      const { error } = await supabase
        .from('treinamento_progresso' as any)
        .update({ observacao } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['treinamento', clienteId] }),
  });

  const done = modulos.filter((m: any) => m.concluido).length;
  const total = modulos.length;
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 rounded-xl border border-border bg-surface p-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-txt">{done} de {total} módulos concluídos</p>
        </div>
        <div className="w-40">
          <Progress value={pct} className="h-2" />
        </div>
        <span className="text-xs font-medium text-txt-muted">{pct}%</span>
      </div>

      <div className="space-y-2">
        {modulos.map((mod: any) => (
          <div key={mod.id} className="rounded-xl border border-border bg-surface">
            <div className="flex items-center gap-3 p-4">
              <Checkbox
                checked={mod.concluido}
                onCheckedChange={(checked) => toggleMutation.mutate({ id: mod.id, concluido: !!checked })}
              />
              <div className="flex-1">
                <span className={`text-sm font-medium ${mod.concluido ? 'text-txt-muted line-through' : 'text-txt'}`}>
                  {mod.modulo} — {mod.titulo}
                </span>
              </div>
              {mod.concluido && mod.concluido_em && (
                <span className="rounded-full bg-green/10 px-2 py-0.5 text-[10px] font-medium text-green">
                  Concluído em {new Date(mod.concluido_em).toLocaleDateString('pt-BR')}
                </span>
              )}
              <button
                onClick={() => setOpenObs((s) => ({ ...s, [mod.id]: !s[mod.id] }))}
                className="rounded-md p-1.5 text-txt-muted transition-colors hover:bg-surface-hi hover:text-txt-sec"
                title="Observação"
              >
                {openObs[mod.id] ? <ChevronDown className="h-4 w-4" /> : <MessageSquare className="h-4 w-4" />}
              </button>
            </div>
            {openObs[mod.id] && (
              <div className="border-t border-border px-4 py-3">
                <Textarea
                  placeholder="Adicionar observação..."
                  defaultValue={mod.observacao || ''}
                  onBlur={(e) => {
                    if (e.target.value !== (mod.observacao || '')) {
                      obsMutation.mutate({ id: mod.id, observacao: e.target.value });
                    }
                  }}
                  className="min-h-[60px] text-sm"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
