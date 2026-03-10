import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Bell } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { GerarAlertaDialog } from '@/components/alertas/GerarAlertaDialog';
import { AlertaCard } from '@/components/alertas/AlertaCard';

interface Props {
  clienteId: string;
  clienteNome: string;
}

export function AlertasTab({ clienteId, clienteNome }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: alertas, isLoading } = useQuery({
    queryKey: ['alertas', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('alertas_semanais' as any)
        .select('*')
        .eq('cliente_id', clienteId)
        .order('semana_inicio', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!clienteId,
  });

  const { data: profiles } = useQuery({
    queryKey: ['profiles-names'],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('id, nome');
      return data as any[];
    },
  });

  const marcarEnviado = useMutation({
    mutationFn: async (alertaId: string) => {
      const { error } = await supabase
        .from('alertas_semanais' as any)
        .update({ status: 'enviado', enviado_em: new Date().toISOString(), enviado_por: user?.id } as any)
        .eq('id', alertaId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alertas', clienteId] });
      toast({ title: 'Alerta marcado como enviado.' });
    },
  });

  const profileName = (id: string) => profiles?.find((p) => p.id === id)?.nome || '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-txt-muted">Informativo semanal de indicadores</p>
        <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
          <Bell className="h-4 w-4" /> Gerar alerta da semana
        </Button>
      </div>

      {isLoading && (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {!isLoading && alertas?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-txt-muted">
          <Bell className="mb-3 h-12 w-12 opacity-30" />
          <p>Nenhum alerta gerado para este cliente</p>
          <Button variant="outline" className="mt-3" onClick={() => setDialogOpen(true)}>
            Gerar primeiro alerta
          </Button>
        </div>
      )}

      {alertas && alertas.length > 0 && (
        <div className="space-y-4">
          {alertas.map((alerta) => (
            <AlertaCard
              key={alerta.id}
              alerta={alerta}
              clienteId={clienteId}
              profileName={profileName}
              onMarcarEnviado={() => marcarEnviado.mutate(alerta.id)}
              onEdit={() => {}}
            />
          ))}
        </div>
      )}

      <GerarAlertaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        clienteId={clienteId}
        clienteNome={clienteNome}
      />
    </div>
  );
}
