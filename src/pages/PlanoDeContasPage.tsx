import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';

const segmentColors: Record<string, { bg: string; text: string }> = {
  alimentacao: { bg: 'bg-[#FFF7ED]', text: 'text-amber' },
  saude: { bg: 'bg-[#F0FDF4]', text: 'text-green' },
  estetica: { bg: 'bg-[#FDF4FF]', text: 'text-[#9333EA]' },
  varejo: { bg: 'bg-surface-hi', text: 'text-primary' },
  servicos: { bg: 'bg-surface-hi', text: 'text-cyan' },
  outro: { bg: 'bg-surface-hi', text: 'text-txt-sec' },
};

const segmentLabels: Record<string, string> = {
  alimentacao: 'Alimentação',
  saude: 'Saúde',
  estetica: 'Estética',
  varejo: 'Varejo',
  servicos: 'Serviços',
  outro: 'Outro',
};

export default function PlanoDeContasPage() {
  const navigate = useNavigate();

  const { data: clientes, isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('*').eq('status', 'ativo');
      if (error) throw error;
      return data;
    },
  });

  const { data: contasCount } = useQuery({
    queryKey: ['plano-contas-count'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plano_de_contas')
        .select('cliente_id, id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach((c) => {
        counts[c.cliente_id] = (counts[c.cliente_id] || 0) + 1;
      });
      return counts;
    },
  });

  const { data: metasPendentes } = useQuery({
    queryKey: ['metas-pendentes'],
    queryFn: async () => {
      const { data: contas, error } = await supabase
        .from('plano_de_contas')
        .select('id, cliente_id');
      if (error) throw error;

      const competencia = new Date();
      competencia.setDate(1);
      const comp = competencia.toISOString().split('T')[0];

      const { data: valores } = await supabase
        .from('valores_mensais')
        .select('conta_id, valor_meta')
        .eq('competencia', comp);

      const metasMap = new Map(valores?.map((v) => [v.conta_id, v.valor_meta]));
      const pendentes: Record<string, number> = {};

      contas?.forEach((c) => {
        if (metasMap.get(c.id) === null || metasMap.get(c.id) === undefined) {
          pendentes[c.cliente_id] = (pendentes[c.cliente_id] || 0) + 1;
        }
      });
      return pendentes;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-txt">Plano de Contas</h2>
        <p className="text-sm text-txt-muted">Estrutura DRE por cliente</p>
      </div>

      {!clientes?.length ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <BookOpen className="h-16 w-16 text-txt-muted opacity-40" />
          <p className="text-txt-sec">Nenhum cliente cadastrado</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clientes.map((cliente) => {
            const count = contasCount?.[cliente.id] || 0;
            const pending = metasPendentes?.[cliente.id] || 0;
            const seg = segmentColors[cliente.segmento] || segmentColors.outro;

            let statusBadge;
            if (count === 0) {
              statusBadge = (
                <span className="rounded-full bg-red/10 px-2 py-0.5 text-xs font-medium text-red">
                  Não configurado
                </span>
              );
            } else if (pending > 0) {
              statusBadge = (
                <span className="rounded-full bg-amber/10 px-2 py-0.5 text-xs font-medium text-amber">
                  Parcial — {pending} metas pendentes
                </span>
              );
            } else {
              statusBadge = (
                <span className="rounded-full bg-green/10 px-2 py-0.5 text-xs font-medium text-green">
                  Configurado
                </span>
              );
            }

            return (
              <div
                key={cliente.id}
                className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-txt">{cliente.nome_empresa}</h3>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${seg.bg} ${seg.text}`}>
                      {segmentLabels[cliente.segmento] || cliente.segmento}
                    </span>
                  </div>
                </div>
                <p className="text-sm font-mono text-txt-sec">{count} contas</p>
                <div className="flex items-center justify-between">
                  {statusBadge}
                  <button
                    onClick={() => navigate(`/plano-de-contas/${cliente.id}`)}
                    className="rounded-lg bg-primary-lo px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-md"
                  >
                    Abrir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
