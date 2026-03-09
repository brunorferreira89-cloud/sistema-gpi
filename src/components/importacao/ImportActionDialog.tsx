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
  currentCompetencia: string;
  competenciaOptions: { value: string; label: string }[];
  onComplete: () => void;
  onCancel: () => void;
}

export function ImportActionDialog({ type, importId, currentCompetencia, competenciaOptions, onComplete, onCancel }: Props) {
  const [newCompetencia, setNewCompetencia] = useState(currentCompetencia);
  const [loading, setLoading] = useState(false);

  const currentLabel = competenciaOptions.find((c) => c.value === currentCompetencia)?.label || currentCompetencia;

  const handleEditConfirm = async () => {
    if (newCompetencia === currentCompetencia) {
      toast.info('A competência selecionada é a mesma atual.');
      return;
    }
    setLoading(true);
    try {
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
      const { error } = await supabase
        .from('importacoes_nibo')
        .delete()
        .eq('id', importId);
      if (error) throw error;
      toast.success('Importação excluída com sucesso.');
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
                  <strong>Atenção:</strong> Esta ação é irreversível. O registro da importação será removido permanentemente. Os valores já registrados nas contas não serão alterados.
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
                <strong>Atenção:</strong> Alterar a competência afeta apenas o registro desta importação. Os valores já inseridos nas contas permanecem na competência original.
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
