import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';

interface Props {
  clienteId: string;
}

const fmtMes = (comp: string) => {
  const d = new Date(comp + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase().replace('.', '');
};

const fmtData = (iso: string) =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ApresentacaoListTab({ clienteId }: Props) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: preparacoes, isLoading } = useQuery({
    queryKey: ['apresentacao-list', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('apresentacao_preparacao')
        .select('id, competencia, gerado_em, editado_em, visivel_portal')
        .eq('cliente_id', clienteId)
        .order('competencia', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, visivel }: { id: string; visivel: boolean }) => {
      const { error } = await supabase
        .from('apresentacao_preparacao')
        .update({ visivel_portal: visivel } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['apresentacao-list', clienteId] });
      toast({ title: 'Visibilidade atualizada' });
    },
  });

  return (
    <div className="space-y-6">
      {/* Header + botão */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-txt">Apresentações</h3>
          <p className="text-sm text-txt-muted">Gerencie as apresentações mensais e controle o que o cliente vê no portal.</p>
        </div>
        <Button onClick={() => navigate(`/apresentacao/${clienteId}`)}>
          ▶ Preparar Apresentação
        </Button>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !preparacoes?.length ? (
        <div className="rounded-xl border border-border bg-surface p-12 text-center">
          <span className="text-4xl block mb-3">📊</span>
          <p className="text-sm text-txt-muted">Nenhuma apresentação preparada ainda.</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate(`/apresentacao/${clienteId}`)}>
            Preparar primeira apresentação
          </Button>
        </div>
      ) : (
        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-txt-muted">Competência</th>
                <th className="text-left px-4 py-3 font-medium text-txt-muted">Status</th>
                <th className="text-left px-4 py-3 font-medium text-txt-muted">Última edição</th>
                <th className="text-center px-4 py-3 font-medium text-txt-muted">Visível no portal</th>
                <th className="text-right px-4 py-3 font-medium text-txt-muted">Ação</th>
              </tr>
            </thead>
            <tbody>
              {preparacoes.map((p: any) => (
                <tr key={p.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium text-txt">{fmtMes(p.competencia)}</td>
                  <td className="px-4 py-3">
                    {p.gerado_em ? (
                      <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100">✓ Preparada</Badge>
                    ) : (
                      <Badge variant="secondary">Rascunho</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 text-txt-muted">
                    {p.editado_em ? fmtData(p.editado_em) : p.gerado_em ? fmtData(p.gerado_em) : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Checkbox
                      checked={!!p.visivel_portal}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ id: p.id, visivel: !!checked })
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/apresentacao/${clienteId}`)}>
                      Editar
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
