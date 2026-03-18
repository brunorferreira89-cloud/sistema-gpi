import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export function useRealtimeSync() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('gpi-realtime-sync')

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'torre_metas',
      }, (payload) => {
        const clienteId = (payload.new as any)?.cliente_id
          ?? (payload.old as any)?.cliente_id;
        queryClient.invalidateQueries({ queryKey: ['torre-metas'] });
        if (clienteId) {
          queryClient.invalidateQueries({ queryKey: ['torre-metas', clienteId] });
        }
      })

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'valores_mensais',
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
        queryClient.invalidateQueries({ queryKey: ['dre-valores'] });
        queryClient.invalidateQueries({ queryKey: ['valores-drill'] });
      })

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'analises_ia',
      }, (payload) => {
        const clienteId = (payload.new as any)?.cliente_id
          ?? (payload.old as any)?.cliente_id;
        queryClient.invalidateQueries({ queryKey: ['analises-ia'] });
        if (clienteId) {
          queryClient.invalidateQueries({ queryKey: ['analises-ia', clienteId] });
        }
      })

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'competencias_liberadas',
      }, (payload) => {
        const clienteId = (payload.new as any)?.cliente_id
          ?? (payload.old as any)?.cliente_id;
        queryClient.invalidateQueries({ queryKey: ['competencias-liberadas'] });
        if (clienteId) {
          queryClient.invalidateQueries({ queryKey: ['competencias-liberadas', clienteId] });
        }
      })

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'painel_widgets',
      }, (payload) => {
        const clienteId = (payload.new as any)?.cliente_id
          ?? (payload.old as any)?.cliente_id;
        queryClient.invalidateQueries({ queryKey: ['painel-widgets'] });
        if (clienteId) {
          queryClient.invalidateQueries({ queryKey: ['painel-widgets', clienteId] });
        }
      })

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'sugestoes_metas_ia',
      }, (payload) => {
        const clienteId = (payload.new as any)?.cliente_id
          ?? (payload.old as any)?.cliente_id;
        queryClient.invalidateQueries({ queryKey: ['sugestoes-metas'] });
        if (clienteId) {
          queryClient.invalidateQueries({ queryKey: ['sugestoes-metas', clienteId] });
        }
      })

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'kpi_indicadores',
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['kpi-indicadores'] });
      })

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'alertas_semanais',
      }, (payload) => {
        const clienteId = (payload.new as any)?.cliente_id
          ?? (payload.old as any)?.cliente_id;
        queryClient.invalidateQueries({ queryKey: ['alertas'] });
        if (clienteId) {
          queryClient.invalidateQueries({ queryKey: ['alertas', clienteId] });
        }
      })

      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'clientes',
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['clientes'] });
      })

      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
