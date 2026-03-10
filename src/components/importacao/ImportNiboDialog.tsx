import { useState, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, Check, AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseNiboXlsx, buildCompetencia, mesAbrevParaNomeCompleto, type ResultadoParseNibo, type ContaParseada } from '@/lib/nibo-parser';
import { formatCurrency } from '@/lib/plano-contas-utils';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ContaOption {
  id: string;
  nome: string;
}

interface MappedLine {
  contaNibo: ContaParseada;
  mesAbrev: string;
  valor: number;
  mappedContaId: string | null;
  mappedContaNome: string | null;
  ignored: boolean;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteNome: string;
  competencia: string;
  competenciaLabel: string;
  contas: ContaOption[];
}

// Mapping strategies
function autoMapLines(niboContas: ContaParseada[], planoContas: ContaOption[], clienteId: string, selectedMes: string): MappedLine[] {
  // Strategy 0: localStorage cache
  const cacheKey = `gpi_mapeamento_nibo_${clienteId}`;
  let cache: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(cacheKey);
    if (raw) cache = JSON.parse(raw);
  } catch { /* empty */ }

  const categorias = niboContas.filter((c) => c.nivel === 2);

  return categorias.map((conta) => {
    const val = conta.valores[selectedMes] ?? 0;
    const line: MappedLine = {
      contaNibo: conta,
      mesAbrev: selectedMes,
      valor: val,
      mappedContaId: null,
      mappedContaNome: null,
      ignored: false,
    };

    // Strategy 0: cache
    if (cache[conta.nome]) {
      const cached = planoContas.find((c) => c.id === cache[conta.nome]);
      if (cached) {
        line.mappedContaId = cached.id;
        line.mappedContaNome = cached.nome;
        return line;
      }
    }

    const nomeLower = conta.nome.toLowerCase().trim();

    // Strategy 1: exact match
    const exact = planoContas.find((c) => c.nome.toLowerCase().trim() === nomeLower);
    if (exact) {
      line.mappedContaId = exact.id;
      line.mappedContaNome = exact.nome;
      return line;
    }

    // Strategy 2: partial (≥5 chars)
    if (nomeLower.length >= 5) {
      const partial = planoContas.find((c) => {
        const cLower = c.nome.toLowerCase().trim();
        return cLower.includes(nomeLower) || nomeLower.includes(cLower);
      });
      if (partial) {
        line.mappedContaId = partial.id;
        line.mappedContaNome = partial.nome;
        return line;
      }
    }

    return line;
  });
}

export function ImportNiboDialog({ open, onOpenChange, clienteId, clienteNome, competencia, competenciaLabel, contas }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [lines, setLines] = useState<MappedLine[]>([]);
  const [fileName, setFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [parseResult, setParseResult] = useState<ResultadoParseNibo | null>(null);
  const [selectedMes, setSelectedMes] = useState('');
  const queryClient = useQueryClient();

  const handleFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const result = await parseNiboXlsx(file);
      setParseResult(result);
      setFileName(file.name);
      // Default to first month
      if (result.mesesDisponiveis.length > 0) {
        const defaultMes = result.mesesDisponiveis[0];
        setSelectedMes(defaultMes);
        const mapped = autoMapLines(result.contas, contas, clienteId, defaultMes);
        setLines(mapped);
      }
      setStep(2);
    } catch {
      toast.error('Erro ao processar o arquivo');
    } finally {
      setIsUploading(false);
    }
  }, [contas, clienteId]);

  const handleMesChange = useCallback((mes: string) => {
    setSelectedMes(mes);
    if (parseResult) {
      const mapped = autoMapLines(parseResult.contas, contas, clienteId, mes);
      setLines(mapped);
    }
  }, [parseResult, contas, clienteId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.xlsx')) handleFile(file);
    else toast.error('Apenas arquivos .xlsx são aceitos');
  }, [handleFile]);

  const updateLine = (index: number, field: Partial<MappedLine>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...field } : l)));
  };

  const mappedCount = lines.filter((l) => !l.ignored && l.mappedContaId).length;
  const unmappedLines = lines.filter((l) => !l.ignored && !l.mappedContaId);
  const activeLines = lines.filter((l) => !l.ignored && l.mappedContaId);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const comp = parseResult && selectedMes
        ? buildCompetencia(selectedMes, parseResult.anoReferencia)
        : competencia;

      // Aggregate values by conta_id
      const aggregated = new Map<string, number>();
      for (const l of activeLines) {
        const current = aggregated.get(l.mappedContaId!) || 0;
        aggregated.set(l.mappedContaId!, current + l.valor);
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

      // Save mapping cache
      const cacheKey = `gpi_mapeamento_nibo_${clienteId}`;
      const cache: Record<string, string> = {};
      for (const l of activeLines) {
        cache[l.contaNibo.nome] = l.mappedContaId!;
      }
      localStorage.setItem(cacheKey, JSON.stringify(cache));

      // Record import
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from('importacoes_nibo').insert({
        cliente_id: clienteId,
        competencia: comp,
        arquivo_nome: fileName,
        status: unmappedLines.length > 0 ? 'parcial' : 'processado',
        total_contas_importadas: activeLines.length,
        total_contas_nao_mapeadas: unmappedLines.length,
        importado_por: userData.user?.id || null,
      });

      const label = parseResult && selectedMes
        ? mesAbrevParaNomeCompleto(selectedMes, parseResult.anoReferencia)
        : competenciaLabel;
      queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
      queryClient.invalidateQueries({ queryKey: ['importacoes-nibo'] });
      toast.success(`Importação concluída. ${activeLines.length} valores registrados para ${label}.`);
      handleClose();
    } catch (err) {
      console.error('Erro ao salvar importação:', err);
      toast.error('Erro ao salvar importação');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    setStep(1);
    setLines([]);
    setFileName('');
    setParseResult(null);
    setSelectedMes('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && 'Importar DRE do Nibo'}
            {step === 2 && 'Mapear contas'}
            {step === 3 && 'Confirmar importação'}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div
            className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border p-12 transition-colors hover:border-primary"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {isUploading ? (
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            ) : (
              <>
                <Upload className="h-12 w-12 text-txt-muted" />
                <p className="text-center text-sm text-txt-sec">Arraste o arquivo de DRE exportado do Nibo</p>
                <p className="text-xs text-txt-muted">Cliente: <strong>{clienteNome}</strong></p>
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span><FileSpreadsheet className="mr-2 h-4 w-4" />Selecionar arquivo</span>
                  </Button>
                  <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                </label>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {/* Month selector */}
            {parseResult && parseResult.mesesDisponiveis.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs text-txt-muted">Mês a importar</label>
                <Select value={selectedMes} onValueChange={handleMesChange}>
                  <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {parseResult.mesesDisponiveis.map((m) => (
                      <SelectItem key={m} value={m}>{mesAbrevParaNomeCompleto(m, parseResult.anoReferencia)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex items-center gap-4 text-sm">
              <span className="text-primary font-medium">{mappedCount} contas mapeadas automaticamente</span>
              <span className="text-txt-muted">·</span>
              <span className="text-amber font-medium">{unmappedLines.length} precisam de atenção</span>
            </div>

            {/* Show only unmapped lines for manual resolution */}
            {unmappedLines.length > 0 && (
              <div className="max-h-[40vh] overflow-y-auto">
                <p className="text-xs text-txt-muted mb-2 font-medium">Contas não mapeadas — resolução manual:</p>
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="border-b border-border text-left text-xs text-txt-muted">
                      <th className="p-2">Nome na planilha</th>
                      <th className="p-2 w-28">Valor</th>
                      <th className="p-2">→ Mapear para</th>
                      <th className="p-2 w-20"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      if (l.mappedContaId || l.ignored) return null;
                      return (
                        <tr key={i} className="border-b border-border/50">
                          <td className="p-2 text-txt">{l.contaNibo.nome}</td>
                          <td className="p-2 font-mono text-txt">{formatCurrency(l.valor)}</td>
                          <td className="p-2">
                            <Select
                              value=""
                              onValueChange={(v) => {
                                const conta = contas.find((c) => c.id === v);
                                updateLine(i, { mappedContaId: v, mappedContaNome: conta?.nome || null });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Selecionar conta..." />
                              </SelectTrigger>
                              <SelectContent>
                                {contas.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="p-2">
                            <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => updateLine(i, { ignored: true })}>
                              Ignorar
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Summary of mapped */}
            {mappedCount > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-txt-muted hover:text-txt">{mappedCount} contas mapeadas automaticamente (ver detalhes)</summary>
                <div className="mt-2 max-h-[30vh] overflow-y-auto rounded border border-border/50">
                  <table className="w-full text-xs">
                    <tbody>
                      {lines.filter((l) => l.mappedContaId && !l.ignored).map((l, i) => (
                        <tr key={i} className="border-b border-border/30">
                          <td className="p-1.5 text-txt">{l.contaNibo.nome}</td>
                          <td className="p-1.5 text-txt-sec">→ {l.mappedContaNome}</td>
                          <td className="p-1.5 font-mono text-right">{formatCurrency(l.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}

            <div className="flex justify-end">
              <Button onClick={() => setStep(3)} disabled={activeLines.length === 0}>
                Confirmar mapeamento →
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="rounded-lg border border-border p-3">
                <p className="text-txt-muted text-xs">Competência</p>
                <p className="font-medium text-txt">{parseResult && selectedMes ? mesAbrevParaNomeCompleto(selectedMes, parseResult.anoReferencia) : competenciaLabel}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-txt-muted text-xs">Arquivo</p>
                <p className="font-medium text-txt truncate">{fileName}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-txt-muted text-xs">Contas mapeadas</p>
                <p className="font-medium text-green">{activeLines.length}</p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-txt-muted text-xs">Ignoradas / não mapeadas</p>
                <p className="font-medium text-amber">{lines.length - activeLines.length}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStep(2)}>← Voltar</Button>
              <Button onClick={handleSave} disabled={isSaving}>
                {isSaving ? 'Salvando...' : `Confirmar importação (${activeLines.length} valores)`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
