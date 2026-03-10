import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Progress } from '@/components/ui/progress';
import { segmentColors, segmentLabels } from '@/lib/clientes-utils';

interface Props {
  clienteId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ClienteSheet({ clienteId, open, onOpenChange }: Props) {
  const navigate = useNavigate();

  const { data: cliente } = useQuery({
    queryKey: ['cliente-sheet', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('*').eq('id', clienteId!).single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!clienteId && open,
  });

  const { data: onboardingStats } = useQuery({
    queryKey: ['onboarding-sheet', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from('onboarding_checklist' as any).select('concluido').eq('cliente_id', clienteId!);
      if (error) throw error;
      const items = data as any[];
      return { done: items.filter((i) => i.concluido).length, total: items.length };
    },
    enabled: !!clienteId && open,
  });

  const { data: tarefasSemana = [] } = useQuery({
    queryKey: ['tarefas-semana-sheet', clienteId],
    queryFn: async () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const friday = new Date(monday);
      friday.setDate(monday.getDate() + 4);
      const { data, error } = await supabase
        .from('tarefas_operacionais' as any)
        .select('*')
        .eq('cliente_id', clienteId!)
        .gte('data_tarefa', monday.toISOString().split('T')[0])
        .lte('data_tarefa', friday.toISOString().split('T')[0])
        .order('data_tarefa');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!clienteId && open,
  });

  if (!cliente) return null;

  const seg = segmentColors[cliente.segmento] || segmentColors.outro;
  const obPct = onboardingStats?.total ? Math.round((onboardingStats.done / onboardingStats.total) * 100) : 0;

  const statusIcon: Record<string, string> = {
    pendente: '○',
    em_andamento: '◐',
    concluido: '●',
    bloqueado: '✕',
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-96 overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {cliente.razao_social || cliente.nome_empresa}
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${seg.bg} ${seg.text}`}>
              {segmentLabels[cliente.segmento] || cliente.segmento}
            </span>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Onboarding */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-txt-sec">Onboarding</p>
            <div className="flex items-center gap-2">
              <Progress value={obPct} className="h-2 flex-1" />
              <span className="text-xs text-txt-muted">{obPct}%</span>
            </div>
          </div>

          {/* Tarefas da semana */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-txt-sec">Tarefas da semana</p>
            {tarefasSemana.length === 0 ? (
              <p className="text-xs text-txt-muted">Nenhuma tarefa esta semana</p>
            ) : (
              <div className="space-y-1">
                {tarefasSemana.map((t: any) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-surface-hi">
                    <span className="text-txt-muted">{statusIcon[t.status] || '○'}</span>
                    <span className="flex-1 text-txt">{t.titulo}</span>
                    <span className="text-txt-muted">
                      {new Date(t.data_tarefa + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short' })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => { onOpenChange(false); navigate(`/clientes/${clienteId}`); }}
            className="text-xs font-semibold text-primary hover:underline"
          >
            → Abrir ficha completa
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
