import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { DreAnualTab } from '@/components/clientes/DreAnualTab';
import { TorreControleTab } from '@/components/clientes/TorreControleTab';
import { KPIsTab } from '@/components/clientes/KPIsTab';
import { AlertasFinanceirosTab } from '@/components/clientes/AlertasFinanceirosTab';

interface Props {
  clienteId: string;
  clienteNome: string;
  clienteSegmento: string;
  clienteFaixa: string;
}

export function FinanceiroTab({ clienteId, clienteNome, clienteSegmento, clienteFaixa }: Props) {
  return (
    <div className="space-y-4">
      <Tabs defaultValue="dre">
        <TabsList className="flex-wrap">
          <TabsTrigger value="dre">DRE Financeira</TabsTrigger>
          <TabsTrigger value="torre">Torre de Controle</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="alertas">Alertas</TabsTrigger>
        </TabsList>

        <TabsContent value="dre">
          <DreAnualTab clienteId={clienteId} />
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
      </Tabs>
    </div>
  );
}
