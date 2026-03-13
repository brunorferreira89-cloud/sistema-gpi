import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { fmtCompetencia } from '@/lib/torre-utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

interface Props {
  clienteId: string;
}

export function PublicacaoTab({ clienteId }: Props) {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [liberarComp, setLiberarComp] = useState<string | null>(null);
  const [revogarComp, setRevogarComp] = useState<string | null>(null);
  const [observacao, setObservacao] = useState('');

  // Fetch all competencias with data
  const { data: competencias, isLoading } = useQuery({
    queryKey: ['publicacao-competencias', clienteId],
    queryFn: async () => {
      // Get distinct competencias from valores_mensais for this client
      const { data: contas } = await supabase
        .from('plano_de_contas')
        .select('id')
        .eq('cliente_id', clienteId);

      if (!contas?.length) return [];

      const contaIds = contas.map((c) => c.id);
      const { data: valoresRaw } = await supabase
        .from('valores_mensais')
        .select('competencia')
        .in('conta_id', contaIds);

      const uniqueComps = [...new Set((valoresRaw || []).map((v) => v.competencia))].sort().reverse();

      if (!uniqueComps.length) return [];

      // Get liberadas for this client
      const { data: liberadas } = await supabase
        .from('competencias_liberadas' as any)
        .select('*, profiles_liberado:profiles!competencias_liberadas_liberado_por_fkey(nome)')
        .eq('cliente_id', clienteId);

      const liberadasMap = new Map<string, any>();
      (liberadas || []).forEach((l: any) => liberadasMap.set(l.competencia, l));

      return uniqueComps.map((comp) => {
        const lib = liberadasMap.get(comp);
        return {
          competencia: comp,
          status: lib?.status || 'rascunho',
          liberado_por_nome: lib?.profiles_liberado?.nome || null,
          liberado_em: lib?.liberado_em || null,
        };
      });
    },
    enabled: !!clienteId,
  });

  const liberarMutation = useMutation({
    mutationFn: async (comp: string) => {
      const userId = session?.user?.id;
      const { error } = await supabase.from('competencias_liberadas' as any).upsert(
        {
          cliente_id: clienteId,
          competencia: comp,
          status: 'liberado',
          liberado_por: userId,
          liberado_em: new Date().toISOString(),
          observacao: observacao || null,
          revogado_por: null,
          revogado_em: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'cliente_id,competencia' }
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['publicacao-competencias', clienteId] });
      toast({ title: `${fmtCompetencia(liberarComp!)} liberado com sucesso. O cliente já pode visualizar.` });
      setLiberarComp(null);
      setObservacao('');
    },
    onError: () => {
      toast({ title: 'Erro ao liberar competência', variant: 'destructive' });
    },
  });

  const revogarMutation = useMutation({
    mutationFn: async (comp: string) => {
      const userId = session?.user?.id;
      const { error } = await supabase
        .from('competencias_liberadas' as any)
        .update({
          status: 'rascunho',
          revogado_por: userId,
          revogado_em: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('cliente_id', clienteId)
        .eq('competencia', comp);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['publicacao-competencias', clienteId] });
      toast({ title: `Acesso a ${fmtCompetencia(revogarComp!)} revogado. O cliente não visualiza mais este mês.` });
      setRevogarComp(null);
    },
    onError: () => {
      toast({ title: 'Erro ao revogar acesso', variant: 'destructive' });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!competencias?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <span className="text-4xl">📅</span>
        <p className="text-sm text-txt-muted text-center max-w-sm">
          Nenhum dado importado ainda. Importe a DRE do Nibo para começar.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-bold text-txt">📅 Publicação de Dados</h3>
        <p className="text-sm text-txt-muted">Controle quais meses o cliente pode visualizar no portal</p>
      </div>

      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Competência</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Liberado por</TableHead>
              <TableHead>Liberado em</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {competencias.map((c) => (
              <TableRow key={c.competencia}>
                <TableCell className="font-semibold text-txt">{fmtCompetencia(c.competencia)}</TableCell>
                <TableCell>
                  {c.status === 'liberado' ? (
                    <Badge className="bg-green/10 text-green border-green/20">✅ Liberado</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-txt-muted">🔧 Em preparação</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-txt-sec">{c.liberado_por_nome || '—'}</TableCell>
                <TableCell className="text-sm text-txt-sec">
                  {c.liberado_em
                    ? new Date(c.liberado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                    : '—'}
                </TableCell>
                <TableCell className="text-right">
                  {c.status === 'liberado' ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red border-red/30 hover:bg-red/5"
                      onClick={() => setRevogarComp(c.competencia)}
                    >
                      ↩ Revogar acesso
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => setLiberarComp(c.competencia)}>
                      ▶ Liberar para o cliente
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Modal Liberar */}
      <Dialog open={!!liberarComp} onOpenChange={(open) => { if (!open) { setLiberarComp(null); setObservacao(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Liberar {liberarComp ? fmtCompetencia(liberarComp) : ''} para o cliente?</DialogTitle>
            <DialogDescription>
              O cliente poderá visualizar no portal:
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm text-txt-sec space-y-1 pl-4 list-disc">
            <li>DRE e indicadores financeiros</li>
            <li>Score de saúde financeira</li>
            <li>Metas e análises da Torre de Controle</li>
            <li>Análises de IA geradas</li>
          </ul>
          <p className="text-xs text-txt-muted">Certifique-se de que os dados estão completos e revisados.</p>
          <div className="space-y-2">
            <label className="text-sm font-medium text-txt-sec">Observação interna (opcional)</label>
            <Input
              placeholder="ex: DRE validado, metas definidas"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLiberarComp(null); setObservacao(''); }}>Cancelar</Button>
            <Button onClick={() => liberarComp && liberarMutation.mutate(liberarComp)} disabled={liberarMutation.isPending}>
              ✅ Confirmar liberação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Revogar */}
      <Dialog open={!!revogarComp} onOpenChange={(open) => { if (!open) setRevogarComp(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revogar acesso a {revogarComp ? fmtCompetencia(revogarComp) : ''}?</DialogTitle>
            <DialogDescription>
              ⚠️ O cliente perderá imediatamente o acesso aos dados deste mês no portal.
              Esta ação pode ser desfeita a qualquer momento.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevogarComp(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => revogarComp && revogarMutation.mutate(revogarComp)}
              disabled={revogarMutation.isPending}
            >
              ↩ Confirmar revogação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
