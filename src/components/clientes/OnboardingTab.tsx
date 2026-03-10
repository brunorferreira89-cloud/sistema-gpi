import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, ChevronRight, Award, ExternalLink } from 'lucide-react';
import { SEMANA_TITULOS } from '@/lib/onboarding-defaults';
import { toast } from '@/hooks/use-toast';

interface Props {
  clienteId: string;
}

export function OnboardingTab({ clienteId }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [openSemanas, setOpenSemanas] = useState<Record<number, boolean>>({ 1: true, 2: true, 3: true, 4: true });

  const { data: items = [] } = useQuery({
    queryKey: ['onboarding-items', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('onboarding_checklist' as any)
        .select('*')
        .eq('cliente_id', clienteId)
        .order('semana')
        .order('ordem');
      if (error) throw error;
      return data as any[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, concluido }: { id: string; concluido: boolean; semana: number; ordem: number }) => {
      const { error } = await supabase
        .from('onboarding_checklist' as any)
        .update({
          concluido,
          concluido_em: concluido ? new Date().toISOString() : null,
          concluido_por: concluido ? user?.id : null,
        } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding-items', clienteId] });
      queryClient.invalidateQueries({ queryKey: ['onboarding', clienteId] });
      // Check if it's the critical item (semana 4, ordem 2)
      if (vars.concluido && vars.semana === 4 && vars.ordem === 3) {
        toast({ title: '🎉 Onboarding concluído! Cliente pronto para operação regular.' });
      }
    },
  });

  const semanas = [1, 2, 3, 4];

  return (
    <div className="space-y-4">
      {semanas.map((semana) => {
        const semanaItems = items.filter((i: any) => i.semana === semana);
        const done = semanaItems.filter((i: any) => {
          if (semana === 4) {
            // Critical item (ordem 2) must be done for 100%
            return i.concluido;
          }
          return i.concluido;
        }).length;
        const total = semanaItems.length;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const isOpen = openSemanas[semana] ?? true;

        return (
          <Collapsible key={semana} open={isOpen} onOpenChange={(o) => setOpenSemanas((s) => ({ ...s, [semana]: o }))}>
            <div className="rounded-xl border border-border bg-surface">
              <CollapsibleTrigger className="flex w-full items-center gap-3 p-4">
                {isOpen ? <ChevronDown className="h-4 w-4 text-txt-muted" /> : <ChevronRight className="h-4 w-4 text-txt-muted" />}
                <div className="flex-1 text-left">
                  <span className="text-sm font-semibold text-txt">Semana {semana} — {SEMANA_TITULOS[semana]}</span>
                  <span className="ml-2 text-xs text-txt-muted">{done}/{total} concluídos</span>
                </div>
                <div className="w-32">
                  <Progress value={pct} className="h-2" />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t border-border px-4 pb-4">
                  {semanaItems.map((item: any) => {
                    const isCritical = semana === 4 && item.ordem === 2;
                    return (
                      <label
                        key={item.id}
                        className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-surface-hi cursor-pointer"
                      >
                        <Checkbox
                          checked={item.concluido}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ id: item.id, concluido: !!checked, semana: item.semana, ordem: item.ordem })
                          }
                        />
                        <span className={`flex-1 text-sm ${item.concluido ? 'text-txt-muted line-through' : 'text-txt'}`}>
                          {item.item}
                        </span>
                        {isCritical && (
                          <span className="flex items-center gap-1 rounded-full bg-primary-lo px-2 py-0.5 text-[10px] font-semibold text-primary">
                            <Award className="h-3 w-3" /> Critério obrigatório
                          </span>
                        )}
                        {item.concluido && item.concluido_em && (
                          <span className="text-[10px] text-txt-muted">
                            {new Date(item.concluido_em).toLocaleDateString('pt-BR')}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        );
      })}
    </div>
  );
}
