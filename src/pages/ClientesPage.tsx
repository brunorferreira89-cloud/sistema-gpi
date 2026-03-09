import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { NovoClienteDialog } from '@/components/clientes/NovoClienteDialog';
import { segmentColors, segmentLabels, faixaLabels, statusColors, statusLabels } from '@/lib/clientes-utils';

export default function ClientesPage() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [filtroSegmento, setFiltroSegmento] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes-all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('*');
      if (error) throw error;
      return data;
    },
  });

  const { data: onboardingCounts } = useQuery({
    queryKey: ['onboarding-counts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('onboarding_checklist' as any).select('cliente_id, concluido');
      if (error) throw error;
      const counts: Record<string, { done: number; total: number }> = {};
      (data as any[])?.forEach((item) => {
        if (!counts[item.cliente_id]) counts[item.cliente_id] = { done: 0, total: 0 };
        counts[item.cliente_id].total++;
        if (item.concluido) counts[item.cliente_id].done++;
      });
      return counts;
    },
  });

  const { data: contasCount } = useQuery({
    queryKey: ['plano-contas-count'],
    queryFn: async () => {
      const { data, error } = await supabase.from('plano_de_contas').select('cliente_id, id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach((c) => { counts[c.cliente_id] = (counts[c.cliente_id] || 0) + 1; });
      return counts;
    },
  });

  const filtered = clientes.filter((c) => {
    if (filtroSegmento !== 'todos' && c.segmento !== filtroSegmento) return false;
    if (filtroStatus !== 'todos' && c.status !== filtroStatus) return false;
    return true;
  });

  const ativos = clientes.filter((c) => c.status === 'ativo').length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-txt">Clientes</h2>
          <p className="text-sm text-txt-muted">{ativos} clientes ativos</p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> Novo Cliente
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={filtroSegmento} onValueChange={setFiltroSegmento}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os segmentos</SelectItem>
            <SelectItem value="alimentacao">Alimentação</SelectItem>
            <SelectItem value="saude">Saúde</SelectItem>
            <SelectItem value="estetica">Beleza & Estética</SelectItem>
            <SelectItem value="varejo">Varejo</SelectItem>
            <SelectItem value="servicos">Serviços</SelectItem>
            <SelectItem value="outro">Outro</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos os status</SelectItem>
            <SelectItem value="ativo">Ativo</SelectItem>
            <SelectItem value="onboarding">Onboarding</SelectItem>
            <SelectItem value="inativo">Inativo</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid or empty */}
      {!filtered.length ? (
        <div className="flex flex-col items-center gap-3 py-20">
          <Users className="h-16 w-16 text-txt-muted opacity-40" />
          <p className="text-txt-sec">Nenhum cliente cadastrado</p>
          <Button variant="outline" onClick={() => setDialogOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Cadastrar primeiro cliente
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((cliente) => {
            const seg = segmentColors[cliente.segmento] || segmentColors.outro;
            const st = statusColors[cliente.status] || statusColors.ativo;
            const ob = onboardingCounts?.[cliente.id];
            const obPct = ob ? Math.round((ob.done / ob.total) * 100) : 0;
            const hasContas = (contasCount?.[cliente.id] || 0) > 0;

            return (
              <div
                key={cliente.id}
                className="group flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-txt">{cliente.nome_empresa}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${seg.bg} ${seg.text}`}>
                        {segmentLabels[cliente.segmento] || cliente.segmento}
                      </span>
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${st.bg} ${st.text}`}>
                        {statusLabels[cliente.status] || cliente.status}
                      </span>
                    </div>
                  </div>
                  <BookOpen className={`h-4 w-4 ${hasContas ? 'text-green' : 'text-amber'}`} />
                </div>

                <p className="text-xs text-txt-muted">{faixaLabels[cliente.faturamento_faixa] || cliente.faturamento_faixa}</p>

                {ob && ob.total > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-txt-sec">Onboarding</span>
                      <span className="text-txt-muted">{ob.done}/{ob.total}</span>
                    </div>
                    <Progress value={obPct} className="h-1.5" />
                  </div>
                )}

                <div className="mt-auto flex justify-end">
                  <button
                    onClick={() => navigate(`/clientes/${cliente.id}`)}
                    className="rounded-lg bg-primary-lo px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary-md"
                  >
                    Abrir ficha →
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NovoClienteDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
