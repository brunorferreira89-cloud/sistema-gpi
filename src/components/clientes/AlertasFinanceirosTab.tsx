import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { fetchKpiData, type KpiData } from '@/lib/kpi-utils';
import { getCompetenciaAtual, formatCurrency } from '@/lib/plano-contas-utils';
import { AlertTriangle, TrendingDown, TrendingUp, CheckCircle2, Info } from 'lucide-react';

interface Props {
  clienteId: string;
}

interface Alerta {
  tipo: 'critico' | 'atencao' | 'positivo';
  titulo: string;
  descricao: string;
  valor?: string;
}

function gerarAlertas(kpi: KpiData): Alerta[] {
  const alertas: Alerta[] = [];

  if (!kpi.hasData) return alertas;

  // Margem de contribuição
  if (kpi.mc_pct < 30) {
    alertas.push({
      tipo: 'critico',
      titulo: 'Margem de contribuição muito baixa',
      descricao: `A margem de contribuição está em ${kpi.mc_pct.toFixed(1)}%, abaixo do benchmark de 30%. Custos variáveis estão consumindo grande parte da receita.`,
      valor: `${kpi.mc_pct.toFixed(1)}%`,
    });
  } else if (kpi.mc_pct < 40) {
    alertas.push({
      tipo: 'atencao',
      titulo: 'Margem de contribuição abaixo do ideal',
      descricao: `Margem de contribuição em ${kpi.mc_pct.toFixed(1)}%. O ideal é acima de 40%.`,
      valor: `${kpi.mc_pct.toFixed(1)}%`,
    });
  } else {
    alertas.push({
      tipo: 'positivo',
      titulo: 'Margem de contribuição saudável',
      descricao: `Margem de contribuição em ${kpi.mc_pct.toFixed(1)}%, dentro da faixa ideal.`,
      valor: `${kpi.mc_pct.toFixed(1)}%`,
    });
  }

  // CMV
  if (kpi.cmv_pct > 40) {
    alertas.push({
      tipo: 'critico',
      titulo: 'CMV acima do limite',
      descricao: `Custo de mercadoria vendida está em ${kpi.cmv_pct.toFixed(1)}% da receita. O benchmark é até 35%.`,
      valor: `${kpi.cmv_pct.toFixed(1)}%`,
    });
  }

  // CMO
  if (kpi.cmo_pct > 30) {
    alertas.push({
      tipo: 'critico',
      titulo: 'Custo com pessoal elevado',
      descricao: `CMO em ${kpi.cmo_pct.toFixed(1)}% da receita. O ideal é até 25%.`,
      valor: `${kpi.cmo_pct.toFixed(1)}%`,
    });
  } else if (kpi.cmo_pct > 25) {
    alertas.push({
      tipo: 'atencao',
      titulo: 'Custo com pessoal merece atenção',
      descricao: `CMO em ${kpi.cmo_pct.toFixed(1)}%. Benchmark: até 25%.`,
      valor: `${kpi.cmo_pct.toFixed(1)}%`,
    });
  }

  // Geração de caixa
  if (kpi.gc_pct < 0) {
    alertas.push({
      tipo: 'critico',
      titulo: 'Empresa não está gerando caixa',
      descricao: `A geração de caixa está negativa em ${kpi.gc_pct.toFixed(1)}%. A empresa está consumindo mais do que gera.`,
      valor: `${kpi.gc_pct.toFixed(1)}%`,
    });
  } else if (kpi.gc_pct < 5) {
    alertas.push({
      tipo: 'atencao',
      titulo: 'Geração de caixa fraca',
      descricao: `Geração de caixa em ${kpi.gc_pct.toFixed(1)}%. Ideal: acima de 10%.`,
      valor: `${kpi.gc_pct.toFixed(1)}%`,
    });
  }

  // Margem de segurança (ponto de equilíbrio)
  if (kpi.margem_seguranca < 0) {
    alertas.push({
      tipo: 'critico',
      titulo: 'Faturamento abaixo do ponto de equilíbrio',
      descricao: `A empresa está operando abaixo do ponto de equilíbrio. É necessário aumentar o faturamento ou reduzir custos fixos.`,
      valor: `${(kpi.margem_seguranca * 100).toFixed(1)}%`,
    });
  }

  return alertas;
}

export function AlertasFinanceirosTab({ clienteId }: Props) {
  const comp = getCompetenciaAtual();

  const { data: kpi, isLoading } = useQuery({
    queryKey: ['kpi-alertas', clienteId, comp],
    queryFn: () => fetchKpiData(clienteId, comp),
    enabled: !!clienteId,
  });

  const alertas = useMemo(() => (kpi ? gerarAlertas(kpi) : []), [kpi]);
  const criticos = alertas.filter((a) => a.tipo === 'critico');
  const atencao = alertas.filter((a) => a.tipo === 'atencao');
  const positivos = alertas.filter((a) => a.tipo === 'positivo');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!kpi?.hasData) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <Info className="h-12 w-12 text-txt-muted/40" />
        <p className="text-sm text-txt-sec">Sem dados financeiros para gerar alertas. Importe planilhas na aba Importação.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-xs text-txt-muted">
        Alertas gerados automaticamente com base nos KPIs da competência atual.
      </p>

      {criticos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-destructive uppercase tracking-wide">Críticos</h3>
          {criticos.map((a, i) => (
            <AlertaCard key={i} alerta={a} />
          ))}
        </div>
      )}

      {atencao.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-amber uppercase tracking-wide">Atenção</h3>
          {atencao.map((a, i) => (
            <AlertaCard key={i} alerta={a} />
          ))}
        </div>
      )}

      {positivos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-green uppercase tracking-wide">Positivos</h3>
          {positivos.map((a, i) => (
            <AlertaCard key={i} alerta={a} />
          ))}
        </div>
      )}

      {alertas.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-green/40" />
          <p className="text-sm text-txt-sec">Todos os indicadores estão dentro do esperado.</p>
        </div>
      )}
    </div>
  );
}

function AlertaCard({ alerta }: { alerta: Alerta }) {
  const styles = {
    critico: {
      border: 'border-destructive/30',
      bg: 'bg-destructive/5',
      icon: <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />,
    },
    atencao: {
      border: 'border-amber/30',
      bg: 'bg-amber/5',
      icon: <TrendingDown className="h-5 w-5 text-amber shrink-0 mt-0.5" />,
    },
    positivo: {
      border: 'border-green/30',
      bg: 'bg-green/5',
      icon: <TrendingUp className="h-5 w-5 text-green shrink-0 mt-0.5" />,
    },
  };

  const s = styles[alerta.tipo];

  return (
    <div className={`flex items-start gap-3 rounded-xl border ${s.border} ${s.bg} p-4`}>
      {s.icon}
      <div className="flex-1 space-y-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-txt">{alerta.titulo}</p>
          {alerta.valor && (
            <span className="text-sm font-mono font-bold text-txt">{alerta.valor}</span>
          )}
        </div>
        <p className="text-xs text-txt-sec">{alerta.descricao}</p>
      </div>
    </div>
  );
}
