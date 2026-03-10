import { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { BookOpen, FileSpreadsheet, Upload, TrendingUp, TrendingDown, ChevronDown, Copy, Pencil, Trash2 } from 'lucide-react';
import { formatCurrency, type ContaTipo, tipoBadgeColors, tipoLabels, type ContaRow, getCompetenciaAtual } from '@/lib/plano-contas-utils';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { ImportNiboDialog } from '@/components/importacao/ImportNiboDialog';
import { ImportActionDialog } from '@/components/importacao/ImportActionDialog';
import { ContasTree } from '@/components/plano-contas/ContasTree';
import { ImportXlsxDialog } from '@/components/plano-contas/ImportXlsxDialog';
import { CopyFromClienteDialog } from '@/components/plano-contas/CopyFromClienteDialog';

const competencias = getCompetenciaOptions();

const tipoBorderColors: Record<string, string> = {
  receita: 'border-l-primary',
  custo_variavel: 'border-l-red',
  despesa_fixa: 'border-l-amber',
  investimento: 'border-l-[#9333EA]',
  financeiro: 'border-l-txt-muted',
};

function DeltaBadge({ realizado, meta }: { realizado: number | null; meta: number | null }) {
  if (realizado == null || meta == null || meta === 0) return null;
  const delta = ((realizado - meta) / Math.abs(meta)) * 100;
  const positive = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${positive ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

interface Props {
  clienteId: string;
  clienteNome: string;
  clienteSegmento: string;
  clienteFaixa: string;
}

export function FinanceiroTab({ clienteId, clienteNome, clienteSegmento, clienteFaixa }: Props) {
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [importNiboOpen, setImportNiboOpen] = useState(false);
  const [importXlsxOpen, setImportXlsxOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState<{ type: 'edit' | 'delete'; importId: string; currentCompetencia: string } | null>(null);
  const [dreOpen, setDreOpen] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [planoOpen, setPlanoOpen] = useState(false);
  const queryClient = useQueryClient();

  // Shared data
  const { data: contas, refetch: refetchContas } = useQuery({
    queryKey: ['plano-contas-torre', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const { data: valores } = useQuery({
    queryKey: ['valores-mensais-torre', clienteId, competencia, contas?.length ?? 0],
    enabled: !!clienteId && !!competencia && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map((c) => c.id);
      const { data } = await supabase.from('valores_mensais').select('*').in('conta_id', contaIds).eq('competencia', competencia);
      return data || [];
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
    queryKey: ['valores-mensais', clienteId],
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

  const valoresMap = useMemo(() => {
    const map: Record<string, { valor_realizado: number | null; valor_meta: number | null }> = {};
    valores?.forEach((v) => { map[v.conta_id] = { valor_realizado: v.valor_realizado, valor_meta: v.valor_meta }; });
    return map;
  }, [valores]);

  const faturamento = useMemo(() => {
    if (!contas) return { real: 0, meta: 0 };
    const receitaContas = contas.filter((c) => c.tipo === 'receita');
    let real = 0, meta = 0;
    receitaContas.forEach((c) => {
      const v = valoresMap[c.id];
      if (v?.valor_realizado) real += v.valor_realizado;
      if (v?.valor_meta) meta += v.valor_meta;
    });
    return { real, meta };
  }, [contas, valoresMap]);

  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some((v) => v.valor_realizado != null);
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

  const handleRefreshPlano = () => {
    refetchContas();
    refetchMetas();
  };

  return (
    <div className="space-y-4">
      {/* ── Torre de Controle / DRE ── */}
      <Collapsible open={dreOpen} onOpenChange={setDreOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left hover:bg-surface-hi">
          <span className="text-sm font-semibold text-txt">Torre de Controle / DRE</span>
          <ChevronDown className={`h-4 w-4 text-txt-muted transition-transform ${dreOpen ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-4">
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
            <Button variant="outline" onClick={() => setImportNiboOpen(true)} className="gap-1.5">
              <Upload className="h-4 w-4" />Importar Nibo
            </Button>
          </div>

          {!hasContas && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <BookOpen className="h-12 w-12 text-txt-muted/40" />
              <p className="text-sm text-txt-sec">Plano de contas não configurado. Abra a seção "Plano de Contas" abaixo.</p>
            </div>
          )}

          {hasContas && !hasValores && (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <FileSpreadsheet className="h-12 w-12 text-txt-muted/40" />
              <p className="text-sm text-txt-sec">Nenhum valor importado para {compLabel}</p>
              <Button onClick={() => setImportNiboOpen(true)} size="sm"><Upload className="mr-2 h-4 w-4" />Importar planilha</Button>
            </div>
          )}

          {hasContas && hasValores && (
            <div className="rounded-xl border border-border bg-surface overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-hi text-left text-xs text-txt-muted">
                    <th className="p-3">Conta DRE</th>
                    <th className="p-3 text-right">Realizado</th>
                    <th className="p-3 text-right">A.V.%</th>
                    <th className="p-3 text-right">Meta</th>
                    <th className="p-3 text-right">Δ vs Meta</th>
                  </tr>
                </thead>
                <tbody>
                  {contas?.map((conta) => {
                    const v = valoresMap[conta.id];
                    const real = v?.valor_realizado;
                    const meta = v?.valor_meta;
                    const av = real != null && faturamento.real ? ((real / faturamento.real) * 100).toFixed(1) : null;
                    const isHighlight = conta.is_total || conta.nivel === 1;
                    const borderColor = tipoBorderColors[conta.tipo] || 'border-l-transparent';

                    return (
                      <tr key={conta.id} className={`border-b border-border/50 border-l-[3px] ${borderColor} ${isHighlight ? 'bg-[hsl(220,60%,97%)] font-semibold' : ''}`}>
                        <td className="p-3 text-txt" style={{ paddingLeft: `${12 + conta.nivel * 20}px` }}>{conta.nome}</td>
                        <td className="p-3 text-right font-mono-data text-txt">{real != null ? formatCurrency(real) : '—'}</td>
                        <td className="p-3 text-right text-xs text-txt-sec">{av ? `${av}%` : '—'}</td>
                        <td className="p-3 text-right font-mono-data text-txt-sec">{meta != null ? formatCurrency(meta) : '—'}</td>
                        <td className="p-3 text-right"><DeltaBadge realizado={real} meta={meta} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* ── Importação Nibo ── */}
      <Collapsible open={importOpen} onOpenChange={setImportOpen}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-4 py-3 text-left hover:bg-surface-hi">
          <span className="text-sm font-semibold text-txt">Importação Nibo</span>
          <ChevronDown className={`h-4 w-4 text-txt-muted transition-transform ${importOpen ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-4">
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
            <Button onClick={() => setImportNiboOpen(true)} className="gap-1.5">
              <Upload className="h-4 w-4" />Importar planilha
            </Button>
          </div>

          {historico && historico.length > 0 ? (
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
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <FileSpreadsheet className="h-10 w-10 text-txt-muted/40" />
              <p className="text-sm text-txt-sec">Nenhuma importação registrada</p>
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* ── Plano de Contas ── */}
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
