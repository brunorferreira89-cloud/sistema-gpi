import { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload, FileSpreadsheet, Pencil, Trash2, AlertTriangle,
} from 'lucide-react';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { parseValoresNibo, buildCompetencia, mesAbrevParaNomeCompleto, type ResultadoParseValores } from '@/lib/nibo-dre-parser';
import { ImportActionDialog } from '@/components/importacao/ImportActionDialog';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { toast } from 'sonner';

const competencias = getCompetenciaOptions();

export default function ImportacaoNiboPage() {
  const [clienteId, setClienteId] = useState('');
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [actionDialog, setActionDialog] = useState<{ type: 'edit' | 'delete'; importId: string; currentCompetencia: string; clienteId: string } | null>(null);
  const queryClient = useQueryClient();

  // Import flow state
  const [parseResult, setParseResult] = useState<ResultadoParseValores | null>(null);
  const [fileName, setFileName] = useState('');
  const [selectedMes, setSelectedMes] = useState('');
  const [mappingStep, setMappingStep] = useState<0 | 1 | 2 | 3>(0); // 0=idle, 1=parsed, 2=mapping, 3=done
  const [isSaving, setIsSaving] = useState(false);
  const [unmapped, setUnmapped] = useState<{ idx: number; nomeLimpo: string; valor: number; mappedContaId: string | null }[]>([]);

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
      const { data } = await supabase.from('plano_de_contas').select('id, nome, nivel').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as { id: string; nome: string; nivel: number }[];
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

  const hasPlano = contas && contas.some((c) => c.nivel === 2);
  const contasN2 = contas?.filter((c) => c.nivel === 2) || [];
  const clienteSel = clientes?.find((c) => c.id === clienteId);

  // Auto-mapping logic
  const autoMap = useCallback((valores: ResultadoParseValores['valores'], mes: string) => {
    // Load cache
    const cacheKey = `gpi_mapeamento_${clienteId}`;
    let cache: Record<string, string> = {};
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) cache = JSON.parse(raw);
    } catch { /* empty */ }

    const mapped: { idx: number; nomeLimpo: string; valor: number; mappedContaId: string | null }[] = [];

    valores.forEach((v, idx) => {
      const val = v.valores[mes] ?? 0;
      const nomeLower = v.nomeLimpo.toLowerCase().trim();
      let contaId: string | null = null;

      // Strategy 0: cache
      if (cache[v.nomeLimpo]) {
        const cached = contasN2.find((c) => c.id === cache[v.nomeLimpo]);
        if (cached) contaId = cached.id;
      }

      // Strategy 1: exact match
      if (!contaId) {
        const exact = contasN2.find((c) => c.nome.toLowerCase().trim() === nomeLower);
        if (exact) contaId = exact.id;
      }

      // Strategy 2: partial (≥5 chars)
      if (!contaId && nomeLower.length >= 5) {
        const partial = contasN2.find((c) => {
          const cLower = c.nome.toLowerCase().trim();
          return cLower.includes(nomeLower) || nomeLower.includes(cLower);
        });
        if (partial) contaId = partial.id;
      }

      mapped.push({ idx, nomeLimpo: v.nomeLimpo, valor: val, mappedContaId: contaId });
    });

    return mapped;
  }, [clienteId, contasN2]);

  const handleFile = useCallback(async (file: File) => {
    try {
      const result = await parseValoresNibo(file, contasN2.map(c => c.nome));
      if (!result.valido) {
        toast.error(result.erro || 'Erro ao processar arquivo');
        return;
      }
      setParseResult(result);
      setFileName(file.name);
      if (result.mesesDisponiveis.length > 0) {
        const defaultMes = result.mesesDisponiveis[0];
        setSelectedMes(defaultMes);
        const mapped = autoMap(result.valores, defaultMes);
        const um = mapped.filter((m) => !m.mappedContaId);
        setUnmapped(um);
      }
      setMappingStep(1);
    } catch {
      toast.error('Erro ao processar o arquivo');
    }
  }, [autoMap]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.xlsx')) handleFile(file);
    else toast.error('Apenas arquivos .xlsx são aceitos');
  }, [handleFile]);

  const handleMesChange = (mes: string) => {
    setSelectedMes(mes);
    if (parseResult) {
      const mapped = autoMap(parseResult.valores, mes);
      const um = mapped.filter((m) => !m.mappedContaId);
      setUnmapped(um);
    }
  };

  const updateUnmappedConta = (idx: number, contaId: string | null) => {
    setUnmapped((prev) => prev.map((u) => u.idx === idx ? { ...u, mappedContaId: contaId } : u));
  };

  const handleSave = async () => {
    if (!parseResult || !selectedMes) return;
    setIsSaving(true);
    try {
      const comp = buildCompetencia(selectedMes, parseResult.anoReferencia);
      const allMapped = autoMap(parseResult.valores, selectedMes);

      // Merge manual mappings
      for (const um of unmapped) {
        if (um.mappedContaId) {
          const entry = allMapped.find((m) => m.idx === um.idx);
          if (entry) entry.mappedContaId = um.mappedContaId;
        }
      }

      const active = allMapped.filter((m) => m.mappedContaId);

      // Aggregate
      const aggregated = new Map<string, number>();
      for (const m of active) {
        const val = parseResult.valores[m.idx].valores[selectedMes] ?? 0;
        const current = aggregated.get(m.mappedContaId!) || 0;
        aggregated.set(m.mappedContaId!, current + val);
      }

      const rows = Array.from(aggregated.entries()).map(([conta_id, valor_realizado]) => ({
        conta_id,
        competencia: comp,
        valor_realizado,
      }));

      if (rows.length > 0) {
        const { error } = await supabase.from('valores_mensais').upsert(rows, { onConflict: 'conta_id,competencia' });
        if (error) throw error;
      }

      // Save cache
      const cacheKey = `gpi_mapeamento_${clienteId}`;
      const cache: Record<string, string> = {};
      for (const m of active) {
        cache[m.nomeLimpo] = m.mappedContaId!;
      }
      localStorage.setItem(cacheKey, JSON.stringify(cache));

      // Record import
      const { data: userData } = await supabase.auth.getUser();
      const unmappedCount = allMapped.filter((m) => !m.mappedContaId).length;
      await supabase.from('importacoes_nibo').insert({
        cliente_id: clienteId,
        competencia: comp,
        arquivo_nome: fileName,
        status: unmappedCount > 0 ? 'parcial' : 'processado',
        total_contas_importadas: active.length,
        total_contas_nao_mapeadas: unmappedCount,
        importado_por: userData.user?.id || null,
      });

      const label = mesAbrevParaNomeCompleto(selectedMes, parseResult.anoReferencia);
      queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
      queryClient.invalidateQueries({ queryKey: ['importacoes-nibo'] });
      toast.success(`Importação concluída. ${active.length} valores registrados para ${label}.`);
      resetImport();
    } catch (err) {
      console.error(err);
      toast.error('Erro ao salvar importação');
    } finally {
      setIsSaving(false);
    }
  };

  const resetImport = () => {
    setMappingStep(0);
    setParseResult(null);
    setSelectedMes('');
    setFileName('');
    setUnmapped([]);
  };

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

  const allMappedForMes = parseResult && selectedMes
    ? autoMap(parseResult.valores, selectedMes)
    : [];
  const mappedCount = allMappedForMes.filter((m) => m.mappedContaId).length + unmapped.filter((u) => u.mappedContaId).length;
  const unmappedCount = unmapped.filter((u) => !u.mappedContaId).length;
  const totalActive = mappedCount;

  // Check if existing import for selected competencia
  const compFromMes = parseResult && selectedMes ? buildCompetencia(selectedMes, parseResult.anoReferencia) : '';
  const existingImport = historico?.find((h: any) => h.competencia === compFromMes);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt">Importação Nibo</h1>
        <p className="text-sm text-txt-sec">Importe a DRE exportada do Nibo para registrar os valores realizados do mês</p>
      </div>

      {/* Client selector */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Cliente</label>
          <Select value={clienteId} onValueChange={(v) => { setClienteId(v); resetImport(); }}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Selecionar cliente..." /></SelectTrigger>
            <SelectContent>
              {clientes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* No plan configured */}
      {clienteId && !hasPlano && (
        <div className="flex items-start gap-3 rounded-xl border border-amber/30 bg-amber/5 p-4">
          <AlertTriangle className="h-5 w-5 text-amber mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-txt">Configure o plano de contas antes de importar valores.</p>
            <p className="text-sm text-txt-sec mt-1">Acesse a aba Financeiro → Plano de Contas, ou use a página Plano de Contas para importar as categorias do Nibo.</p>
          </div>
        </div>
      )}

      {/* Import section */}
      {clienteId && hasPlano && mappingStep === 0 && (
        <div className="space-y-4">
          <div className="text-center">
            <p className="text-xs text-txt-muted mb-2">No Nibo: <strong>Relatórios → DRE → Exportar Excel</strong></p>
          </div>
          <div
            className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border p-12 transition-colors hover:border-primary"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <Upload className="h-12 w-12 text-txt-muted" />
            <p className="text-sm text-txt-sec text-center">Arraste o arquivo de DRE exportado do Nibo</p>
            <p className="text-xs text-txt-muted">Cliente: <strong>{clienteSel?.nome_empresa}</strong></p>
            <label className="cursor-pointer">
              <Button variant="outline" size="sm" asChild>
                <span><FileSpreadsheet className="mr-2 h-4 w-4" />Selecionar arquivo</span>
              </Button>
              <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            </label>
          </div>
        </div>
      )}

      {/* Step 1: Parsed — select month */}
      {clienteId && hasPlano && mappingStep === 1 && parseResult && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <h3 className="text-sm font-bold text-txt">Arquivo processado: {fileName}</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-txt-sec">• <strong className="text-txt">{parseResult.valores.length}</strong> contas detectadas</span>
              <span className="text-txt-sec">• Meses: <strong className="text-txt">{parseResult.mesesDisponiveis.join(', ')}</strong></span>
            </div>
            <div className="space-y-1 pt-2">
              <label className="text-xs text-txt-muted">Qual mês importar?</label>
              <Select value={selectedMes} onValueChange={handleMesChange}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {parseResult.mesesDisponiveis.map((m) => (
                    <SelectItem key={m} value={m}>{mesAbrevParaNomeCompleto(m, parseResult.anoReferencia)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {existingImport && (
              <div className="flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/5 p-3 text-sm text-amber">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                ⚠ Substituirá importação anterior deste mês
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm">
            <span className="text-primary font-medium">{mappedCount} mapeadas automaticamente</span>
            {unmappedCount > 0 && <span className="text-amber font-medium">{unmappedCount} precisam de atenção</span>}
          </div>

          {/* Unmapped lines */}
          {unmappedCount > 0 && (
            <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-border bg-surface">
              <p className="text-xs text-txt-muted p-3 pb-1 font-medium">Contas não mapeadas — resolução manual:</p>
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left text-xs text-txt-muted">
                    <th className="p-2 pl-3">Nome na planilha</th>
                    <th className="p-2 w-28">Valor</th>
                    <th className="p-2">→ Mapear para</th>
                  </tr>
                </thead>
                <tbody>
                  {unmapped.filter((u) => !u.mappedContaId).map((u) => (
                    <tr key={u.idx} className="border-b border-border/50">
                      <td className="p-2 pl-3 text-txt">{u.nomeLimpo}</td>
                      <td className="p-2 font-mono text-txt">{formatCurrency(u.valor)}</td>
                      <td className="p-2">
                        <Select value="" onValueChange={(v) => updateUnmappedConta(u.idx, v)}>
                          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                          <SelectContent>
                            {contasN2.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={resetImport}>← Voltar</Button>
            <Button onClick={handleSave} disabled={isSaving || totalActive === 0}>
              {isSaving ? 'Importando...' : `Importar valores (${totalActive} contas) →`}
            </Button>
          </div>
        </div>
      )}

      {/* History */}
      {clienteId && (
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
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-txt-muted hover:text-primary" onClick={() => setActionDialog({ type: 'edit', importId: h.id, currentCompetencia: h.competencia, clienteId })} title="Alterar competência">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-txt-muted hover:text-destructive" onClick={() => setActionDialog({ type: 'delete', importId: h.id, currentCompetencia: h.competencia, clienteId })} title="Excluir importação">
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
      )}

      {actionDialog && (
        <ImportActionDialog
          type={actionDialog.type}
          importId={actionDialog.importId}
          clienteId={actionDialog.clienteId}
          currentCompetencia={actionDialog.currentCompetencia}
          competenciaOptions={competencias}
          onComplete={handleActionComplete}
          onCancel={() => setActionDialog(null)}
        />
      )}
    </div>
  );
}
