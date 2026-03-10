import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, Pencil, Trash2, Copy, BookOpen } from 'lucide-react';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { ImportNiboDialog } from '@/components/importacao/ImportNiboDialog';
import { ImportActionDialog } from '@/components/importacao/ImportActionDialog';
import { ImportXlsxDialog } from '@/components/plano-contas/ImportXlsxDialog';
import { CopyFromClienteDialog } from '@/components/plano-contas/CopyFromClienteDialog';
import { ContasTree } from '@/components/plano-contas/ContasTree';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';
import { getCompetenciaAtual } from '@/lib/plano-contas-utils';

const competencias = getCompetenciaOptions();

interface Props {
  clienteId: string;
  clienteNome: string;
  clienteSegmento: string;
  clienteFaixa: string;
}

export function ImportacaoTab({ clienteId, clienteNome, clienteSegmento, clienteFaixa }: Props) {
  const [importNiboOpen, setImportNiboOpen] = useState(false);
  const [importXlsxOpen, setImportXlsxOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [actionDialog, setActionDialog] = useState<{ type: 'edit' | 'delete'; importId: string; currentCompetencia: string } | null>(null);
  const [planoOpen, setPlanoOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: contas, refetch: refetchContas } = useQuery({
    queryKey: ['plano-contas-import', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const { data: historico } = useQuery({
    queryKey: ['importacoes-nibo', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('importacoes_nibo').select('*').eq('cliente_id', clienteId).order('created_at', { ascending: false });
      return data || [];
    },
  });

  const { data: valoresMetas, refetch: refetchMetas } = useQuery({
    queryKey: ['valores-mensais-metas', clienteId],
    queryFn: async () => {
      if (!contas?.length) return {};
      const comp = getCompetenciaAtual();
      const contaIds = contas.map((c) => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, valor_meta').in('conta_id', contaIds).eq('competencia', comp);
      const map: Record<string, number | null> = {};
      data?.forEach((v) => { map[v.conta_id] = v.valor_meta; });
      return map;
    },
    enabled: !!contas?.length,
  });

  const hasContas = contas && contas.length > 0;
  const compLabel = competencias.find((c) => c.value === competencia)?.label || '';

  const statusBadge = (s: string) => {
    if (s === 'processado') return <Badge className="bg-green/10 text-green border-0">Processado</Badge>;
    if (s === 'parcial') return <Badge className="bg-amber/10 text-amber border-0">Parcial</Badge>;
    return <Badge className="bg-red/10 text-red border-0">Erro</Badge>;
  };

  const handleActionComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['importacoes-nibo'] });
    queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
    queryClient.invalidateQueries({ queryKey: ['valores-mensais-torre'] });
    queryClient.invalidateQueries({ queryKey: ['valores-mensais-dre'] });
    setActionDialog(null);
  };

  const handleRefreshPlano = () => {
    refetchContas();
    refetchMetas();
  };

  return (
    <div className="space-y-6">
      {/* Importar nova planilha */}
      <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-txt">Importar planilha Nibo</h3>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs text-txt-muted">Competência</label>
            <Select value={competencia} onValueChange={setCompetencia}>
              <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
              <SelectContent>
                {competencias.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={() => setImportNiboOpen(true)} className="gap-1.5" disabled={!hasContas}>
            <Upload className="h-4 w-4" />Importar planilha
          </Button>
        </div>
        {!hasContas && (
          <p className="text-xs text-amber">Configure o Plano de Contas antes de importar.</p>
        )}
      </div>

      {/* Histórico de importações */}
      <div className="rounded-xl border border-border bg-surface overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-txt">Histórico de importações</h3>
        </div>
        {historico && historico.length > 0 ? (
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
                  <td className="p-3 text-txt capitalize">
                    {(() => { const [y, m] = h.competencia.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }); })()}
                  </td>
                  <td className="p-3 text-txt truncate max-w-[200px]">{h.arquivo_nome || '—'}</td>
                  <td className="p-3">{statusBadge(h.status)}</td>
                  <td className="p-3 text-txt">{h.total_contas_importadas}</td>
                  <td className="p-3 text-txt">{h.total_contas_nao_mapeadas}</td>
                  <td className="p-3 text-txt-muted text-xs">{new Date(h.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-txt-muted hover:text-primary" onClick={() => setActionDialog({ type: 'edit', importId: h.id, currentCompetencia: h.competencia })} title="Alterar competência">
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-txt-muted hover:text-destructive" onClick={() => setActionDialog({ type: 'delete', importId: h.id, currentCompetencia: h.competencia })} title="Excluir importação">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <FileSpreadsheet className="h-10 w-10 text-txt-muted/40" />
            <p className="text-sm text-txt-sec">Nenhuma importação registrada</p>
          </div>
        )}
      </div>

      {/* Plano de Contas */}
      <Collapsible open={planoOpen} onOpenChange={setPlanoOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left hover:bg-surface-hi">
          <span className="text-sm font-semibold text-txt">Plano de Contas</span>
          <ChevronDown className={`h-4 w-4 text-txt-muted transition-transform ${planoOpen ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportXlsxOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />Importar .xlsx do Nibo
            </Button>
            <Button variant="outline" onClick={() => setCopyOpen(true)} className="gap-2">
              <Copy className="h-4 w-4" />Copiar de outro cliente
            </Button>
          </div>

          {hasContas ? (
            <ContasTree
              contas={contas}
              valoresMetas={valoresMetas || {}}
              clienteId={clienteId}
              onRefresh={handleRefreshPlano}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 rounded-xl border border-dashed border-border bg-surface text-center">
              <BookOpen className="h-12 w-12 text-txt-muted opacity-30" />
              <p className="text-sm font-semibold text-txt">Nenhuma conta cadastrada</p>
              <p className="text-xs text-txt-muted">Importe a DRE do Nibo ou copie de outro cliente</p>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Dialogs */}
      <ImportNiboDialog
        open={importNiboOpen}
        onOpenChange={setImportNiboOpen}
        clienteId={clienteId}
        clienteNome={clienteNome}
        competencia={competencia}
        competenciaLabel={compLabel}
        contas={contas?.map((c) => ({ id: c.id, nome: c.nome })) || []}
      />

      <ImportXlsxDialog
        open={importXlsxOpen}
        onOpenChange={setImportXlsxOpen}
        clienteId={clienteId}
        clienteFaixa={clienteFaixa}
      />

      <CopyFromClienteDialog
        open={copyOpen}
        onOpenChange={setCopyOpen}
        clienteId={clienteId}
        clienteSegmento={clienteSegmento}
        clienteFaixa={clienteFaixa}
      />

      {actionDialog && (
        <ImportActionDialog
          type={actionDialog.type}
          importId={actionDialog.importId}
          clienteId={clienteId}
          currentCompetencia={actionDialog.currentCompetencia}
          competenciaOptions={competencias}
          onComplete={handleActionComplete}
          onCancel={() => setActionDialog(null)}
        />
      )}
    </div>
  );
}
