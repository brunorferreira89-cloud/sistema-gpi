import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface Props {
  type: 'edit' | 'delete';
  importId: string;
  clienteId: string;
  currentCompetencia: string;
  competenciaOptions: { value: string; label: string }[];
  onComplete: () => void;
  onCancel: () => void;
}

export function ImportActionDialog({ type, importId, clienteId, currentCompetencia, competenciaOptions, onComplete, onCancel }: Props) {
  const [newCompetencia, setNewCompetencia] = useState(currentCompetencia);
  const [loading, setLoading] = useState(false);

  const formatCompetenciaLabel = (comp: string) => {
    const opt = competenciaOptions.find((c) => c.value === comp);
    if (opt) return opt.label;
    const [y, m] = comp.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  const currentLabel = formatCompetenciaLabel(currentCompetencia);

  const handleEditConfirm = async () => {
    if (newCompetencia === currentCompetencia) {
      toast.info('A competência selecionada é a mesma atual.');
      return;
    }
    setLoading(true);
    try {
      // 1. Get all contas for this client
      const { data: contas } = await supabase
        .from('plano_de_contas')
        .select('id')
        .eq('cliente_id', clienteId);

      if (contas && contas.length > 0) {
        const contaIds = contas.map((c) => c.id);

        // 2. Get valores_mensais for old competencia
        const { data: oldValores } = await supabase
          .from('valores_mensais')
          .select('conta_id, valor_realizado')
          .in('conta_id', contaIds)
          .eq('competencia', currentCompetencia);

        if (oldValores && oldValores.length > 0) {
          // 3. Upsert into new competencia
          const newRows = oldValores
            .filter((v) => v.valor_realizado !== null)
            .map((v) => ({
              conta_id: v.conta_id,
              competencia: newCompetencia,
              valor_realizado: v.valor_realizado,
            }));

          if (newRows.length > 0) {
            const { error: upsertError } = await supabase
              .from('valores_mensais')
              .upsert(newRows, { onConflict: 'conta_id,competencia' });
            if (upsertError) throw upsertError;
          }

          // 4. Clear old competencia valores (set realizado to null)
          for (const v of oldValores) {
            await supabase
              .from('valores_mensais')
              .update({ valor_realizado: null })
              .eq('conta_id', v.conta_id)
              .eq('competencia', currentCompetencia);
          }
        }
      }

      // 5. Update import record
      const { error } = await supabase
        .from('importacoes_nibo')
        .update({ competencia: newCompetencia })
        .eq('id', importId);
      if (error) throw error;

      toast.success('Competência da importação alterada com sucesso.');
      onComplete();
    } catch (err) {
      console.error('Erro ao alterar competência:', err);
      toast.error('Erro ao alterar competência da importação.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    setLoading(true);
    try {
      // 1. Get all contas for this client
      const { data: contas } = await supabase
        .from('plano_de_contas')
        .select('id')
        .eq('cliente_id', clienteId);

      // 2. Clear valor_realizado for this competencia
      if (contas && contas.length > 0) {
        const contaIds = contas.map((c) => c.id);
        // Permanently delete valores_mensais for this competencia
        const { error: deleteError } = await supabase
          .from('valores_mensais')
          .delete()
          .in('conta_id', contaIds)
          .eq('competencia', currentCompetencia);
        if (deleteError) throw deleteError;
      }

      // 3. Delete import record
      const { error } = await supabase
        .from('importacoes_nibo')
        .delete()
        .eq('id', importId);
      if (error) throw error;

      toast.success('Importação excluída permanentemente. Dados da competência foram removidos.');
      onComplete();
    } catch (err) {
      console.error('Erro ao excluir importação:', err);
      toast.error('Erro ao excluir importação.');
    } finally {
      setLoading(false);
    }
  };

  if (type === 'delete') {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <ShieldAlert className="h-5 w-5 text-destructive" />
              </div>
              <AlertDialogTitle>Excluir importação</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="space-y-2">
              <p>
                Você está prestes a excluir permanentemente a importação da competência <strong>{currentLabel}</strong>.
              </p>
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                 <strong>Atenção:</strong> Esta ação é irreversível. O registro da importação e todos os valores financeiros da competência serão removidos permanentemente do banco de dados.
                </span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={loading}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {loading ? 'Excluindo...' : 'Sim, excluir importação'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber/10">
              <ShieldAlert className="h-5 w-5 text-amber" />
            </div>
            <AlertDialogTitle>Alterar competência</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="space-y-3">
            <p>
              Competência atual: <strong>{currentLabel}</strong>
            </p>
            <div className="space-y-1">
              <label className="text-xs text-txt-muted">Nova competência</label>
              <Select value={newCompetencia} onValueChange={setNewCompetencia}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {competenciaOptions.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/5 p-3 text-sm text-amber-700 dark:text-amber">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <strong>Atenção:</strong> Os valores realizados serão movidos da competência atual para a nova competência selecionada. A competência original ficará zerada.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={handleEditConfirm} disabled={loading}>
            {loading ? 'Salvando...' : 'Confirmar alteração'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
