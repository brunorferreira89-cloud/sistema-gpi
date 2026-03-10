import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Bell, Eye, Send } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { GerarAlertaDialog } from '@/components/alertas/GerarAlertaDialog';
import { AlertaCard } from '@/components/alertas/AlertaCard';

export default function AlertasPage() {
  const [clienteId, setClienteId] = useState<string>('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: clientes } = useQuery({
    queryKey: ['clientes-ativos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('id, nome_empresa, razao_social, segmento').eq('status', 'ativo').order('nome_empresa');
      if (error) throw error;
      return data;
    },
  });

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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt">Alertas Semanais</h1>
          <p className="text-sm text-txt-muted">Informativo semanal de indicadores por cliente</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={clienteId} onValueChange={setClienteId}>
            <SelectTrigger className="w-56"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
            <SelectContent>
              {clientes?.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => setDialogOpen(true)} disabled={!clienteId} className="gap-1.5">
            <Bell className="h-4 w-4" /> Gerar alerta da semana
          </Button>
        </div>
      </div>

      {!clienteId && (
        <div className="flex flex-col items-center justify-center py-20 text-txt-muted">
          <Bell className="mb-3 h-12 w-12 opacity-30" />
          <p>Selecione um cliente para ver os alertas</p>
        </div>
      )}

      {clienteId && isLoading && (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {clienteId && !isLoading && alertas?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-txt-muted">
          <Bell className="mb-3 h-12 w-12 opacity-30" />
          <p>Nenhum alerta gerado para este cliente</p>
          <Button variant="outline" className="mt-3" onClick={() => setDialogOpen(true)}>
            Gerar primeiro alerta
          </Button>
        </div>
      )}

      {clienteId && alertas && alertas.length > 0 && (
        <div className="space-y-4">
          {alertas.map((alerta) => (
            <AlertaCard
              key={alerta.id}
              alerta={alerta}
              clienteId={clienteId}
              profileName={profileName}
              onMarcarEnviado={() => marcarEnviado.mutate(alerta.id)}
              onEdit={() => {/* TODO: edit existing */}}
            />
          ))}
        </div>
      )}

      {clienteId && (
        <GerarAlertaDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          clienteId={clienteId}
          clienteNome={clientes?.find((c) => c.id === clienteId)?.nome_empresa || ''}
        />
      )}
    </div>
  );
}
