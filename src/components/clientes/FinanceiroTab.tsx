import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DreAnualTab } from '@/components/clientes/DreAnualTab';
import { TorreControleTab } from '@/components/clientes/TorreControleTab';
import { KPIsTab } from '@/components/clientes/KPIsTab';
import { AlertasFinanceirosTab } from '@/components/clientes/AlertasFinanceirosTab';
import { BenchmarkConfigTab, DEFAULT_BENCHMARKS, type BenchmarkThresholds } from '@/components/clientes/BenchmarkConfigTab';
import { useMemo } from 'react';

interface Props {
  clienteId: string;
  clienteNome: string;
  clienteSegmento: string;
  clienteFaixa: string;
}

export function FinanceiroTab({ clienteId, clienteNome, clienteSegmento, clienteFaixa }: Props) {
  const { data: benchmarkConfigs } = useQuery({
    queryKey: ['benchmark-config', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('benchmark_config')
        .select('*')
        .eq('cliente_id', clienteId);
      return data || [];
    },
  });

  const benchmarks: BenchmarkThresholds = useMemo(() => {
    const merged = { ...DEFAULT_BENCHMARKS };
    if (!benchmarkConfigs) return merged;
    for (const c of benchmarkConfigs) {
      if (c.tipo === 'cmv') {
        merged.cmv_verde = Number(c.limite_verde);
        merged.cmv_amarelo = Number(c.limite_amarelo);
      }
      if (c.tipo === 'cmo') {
        merged.cmo_verde = Number(c.limite_verde);
        merged.cmo_amarelo = Number(c.limite_amarelo);
      }
    }
    return merged;
  }, [benchmarkConfigs]);

  return (
    <div className="space-y-4">
      <Tabs defaultValue="dre">
        <TabsList className="flex-wrap">
          <TabsTrigger value="dre">DRE Financeira</TabsTrigger>
          <TabsTrigger value="torre">Torre de Controle</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="alertas">Alertas</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="dre">
          <DreAnualTab clienteId={clienteId} benchmarks={benchmarks} />
        </TabsContent>

        <TabsContent value="torre">
          <TorreControleTab clienteId={clienteId} />
        </TabsContent>

        <TabsContent value="kpis">
          <KPIsTab clienteId={clienteId} />
        </TabsContent>

        <TabsContent value="alertas">
          <AlertasFinanceirosTab clienteId={clienteId} />
        </TabsContent>

        <TabsContent value="config">
          <BenchmarkConfigTab clienteId={clienteId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
