import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, Pencil, Trash2 } from 'lucide-react';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { ImportNiboDialog } from '@/components/importacao/ImportNiboDialog';
import { ImportActionDialog } from '@/components/importacao/ImportActionDialog';

const competencias = getCompetenciaOptions();

export default function ImportacaoNiboPage() {
  const [clienteId, setClienteId] = useState('');
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [importOpen, setImportOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState<{ type: 'edit' | 'delete'; importId: string; currentCompetencia: string; clienteId: string } | null>(null);
  const queryClient = useQueryClient();

  const { data: clientes } = useQuery({
    queryKey: ['clientes-ativos'],
    queryFn: async () => {
      const { data } = await supabase.from('clientes').select('id, nome_empresa, segmento').eq('status', 'ativo').order('nome_empresa');
      return data || [];
    },
  });

  const { data: contas } = useQuery({
    queryKey: ['plano-contas-simple', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('id, nome').eq('cliente_id', clienteId).order('ordem');
      return data || [];
    },
  });

  const { data: historico } = useQuery({
    queryKey: ['importacoes-nibo', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('importacoes_nibo').select('*').eq('cliente_id', clienteId).order('created_at', { ascending: false });
      return (data || []);
    },
  });

  const clienteSel = clientes?.find((c) => c.id === clienteId);
  const compLabel = competencias.find((c) => c.value === competencia)?.label || '';

  const statusBadge = (s: string) => {
    if (s === 'processado') return <Badge className="bg-green/10 text-green border-0">Processado</Badge>;
    if (s === 'parcial') return <Badge className="bg-amber/10 text-amber border-0">Parcial</Badge>;
    return <Badge className="bg-red/10 text-red border-0">Erro</Badge>;
  };

  const handleActionComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['importacoes-nibo'] });
    queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
    setActionDialog(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt">Importação Nibo</h1>
        <p className="text-sm text-txt-sec">Importe a planilha de DRE exportada do Nibo para registrar os valores realizados do mês</p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Cliente</label>
          <Select value={clienteId} onValueChange={setClienteId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Selecionar cliente..." /></SelectTrigger>
            <SelectContent>
              {clientes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Competência</label>
          <Select value={competencia} onValueChange={setCompetencia}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {competencias.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button disabled={!clienteId} onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />Importar planilha
        </Button>
      </div>

      {clienteId && historico && historico.length > 0 && (
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-hi text-left text-xs text-txt-muted">
                <th className="p-3">Competência</th>
                <th className="p-3">Arquivo</th>
                <th className="p-3">Status</th>
                <th className="p-3">Importadas</th>
                <th className="p-3">Não mapeadas</th>
                <th className="p-3">Data</th>
                <th className="p-3 w-24">Ações</th>
              </tr>
            </thead>
            <tbody>
              {historico.map((h: any) => (
                <tr key={h.id} className="border-b border-border/50 hover:bg-surface-hi/50">
                  <td className="p-3 text-txt">{(() => { const [y, m] = h.competencia.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); })()}</td>
                  <td className="p-3 text-txt truncate max-w-[200px]">{h.arquivo_nome || '—'}</td>
                  <td className="p-3">{statusBadge(h.status)}</td>
                  <td className="p-3 text-txt">{h.total_contas_importadas}</td>
                  <td className="p-3 text-txt">{h.total_contas_nao_mapeadas}</td>
                  <td className="p-3 text-txt-muted text-xs">{new Date(h.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-txt-muted hover:text-primary"
                        onClick={() => setActionDialog({ type: 'edit', importId: h.id, currentCompetencia: h.competencia })}
                        title="Alterar competência"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-txt-muted hover:text-destructive"
                        onClick={() => setActionDialog({ type: 'delete', importId: h.id, currentCompetencia: h.competencia })}
                        title="Excluir importação"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {clienteId && (!historico || historico.length === 0) && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <FileSpreadsheet className="h-16 w-16 text-txt-muted/40" />
          <p className="text-txt-sec">Nenhuma importação registrada para este cliente</p>
        </div>
      )}

      {clienteId && (
        <ImportNiboDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          clienteId={clienteId}
          clienteNome={clienteSel?.nome_empresa || ''}
          competencia={competencia}
          competenciaLabel={compLabel}
          contas={contas || []}
        />
      )}

      {actionDialog && (
        <ImportActionDialog
          type={actionDialog.type}
          importId={actionDialog.importId}
          currentCompetencia={actionDialog.currentCompetencia}
          competenciaOptions={competencias}
          onComplete={handleActionComplete}
          onCancel={() => setActionDialog(null)}
        />
      )}
    </div>
  );
}
