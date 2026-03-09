import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, Check, AlertTriangle } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { parseNiboXlsx, autoMapContas, type NiboLine } from '@/lib/nibo-import-utils';
import { formatCurrency } from '@/lib/plano-contas-utils';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ContaOption {
  id: string;
  nome: string;
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

export function ImportNiboDialog({ open, onOpenChange, clienteId, clienteNome, competencia, competenciaLabel, contas }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [lines, setLines] = useState<NiboLine[]>([]);
  const [fileName, setFileName] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const handleFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const parsed = await parseNiboXlsx(file);
      const mapped = autoMapContas(parsed, contas);
      setLines(mapped);
      setFileName(file.name);
      setStep(2);
    } catch {
      toast.error('Erro ao processar o arquivo');
    } finally {
      setIsUploading(false);
    }
  }, [contas]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.xlsx')) handleFile(file);
    else toast.error('Apenas arquivos .xlsx são aceitos');
  }, [handleFile]);

  const updateLine = (index: number, field: Partial<NiboLine>) => {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...field } : l)));
  };

  const mappedCount = lines.filter((l) => !l.ignored && l.mappedContaId).length;
  const unmappedCount = lines.filter((l) => !l.ignored && !l.mappedContaId).length;
  const activeLines = lines.filter((l) => !l.ignored && l.mappedContaId);

  const handleConfirmMapping = () => setStep(3);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Upsert valores_mensais
      const rows = activeLines.map((l) => ({
        conta_id: l.mappedContaId!,
        competencia,
        valor_realizado: l.valor,
      }));

      if (rows.length > 0) {
        const { error } = await supabase.from('valores_mensais').upsert(rows, { onConflict: 'conta_id,competencia' });
        if (error) { console.error('Erro upsert valores:', error); throw error; }
      }

      // Record import
      const { data: userData } = await supabase.auth.getUser();
      const { error: importError } = await supabase.from('importacoes_nibo').insert({
        cliente_id: clienteId,
        competencia,
        arquivo_nome: fileName,
        status: unmappedCount > 0 ? 'parcial' : 'processado',
        total_contas_importadas: activeLines.length,
        total_contas_nao_mapeadas: unmappedCount,
        importado_por: userData.user?.id || null,
      });
      if (importError) { console.error('Erro insert importacao:', importError); throw importError; }

      queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
      queryClient.invalidateQueries({ queryKey: ['importacoes-nibo'] });
      toast.success(`Importação concluída. ${activeLines.length} valores registrados para ${competenciaLabel}.`);
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
                <p className="text-center text-sm text-txt-sec">
                  Arraste o arquivo de DRE exportado do Nibo
                </p>
                <p className="text-xs text-txt-muted">
                  Competência: <strong>{competenciaLabel}</strong> · Cliente: <strong>{clienteNome}</strong>
                </p>
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
            <div className="flex items-center gap-4 text-sm">
              <span className="text-primary font-medium">{mappedCount} contas mapeadas automaticamente</span>
              <span className="text-txt-muted">·</span>
              <span className="text-amber font-medium">{unmappedCount} precisam de atenção</span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left text-xs text-txt-muted">
                    <th className="p-2">Nome na planilha</th>
                    <th className="p-2 w-28">Valor</th>
                    <th className="p-2">→ Mapeado para</th>
                    <th className="p-2 w-28">Status</th>
                    <th className="p-2 w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className={`border-b border-border/50 ${l.ignored ? 'opacity-40' : ''}`}>
                      <td className="p-2 text-txt">{l.nome}</td>
                      <td className="p-2 font-mono text-txt">{formatCurrency(l.valor)}</td>
                      <td className="p-2">
                        {!l.ignored && (
                          <Select
                            value={l.mappedContaId || ''}
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
                        )}
                      </td>
                      <td className="p-2">
                        {l.ignored ? (
                          <span className="text-xs text-txt-muted">Ignorado</span>
                        ) : l.mappedContaId ? (
                          <span className="flex items-center gap-1 text-xs text-green"><Check className="h-3 w-3" />Mapeado</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-amber"><AlertTriangle className="h-3 w-3" />Não mapeado</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Button variant="ghost" size="sm" className="text-xs h-7" onClick={() => updateLine(i, { ignored: !l.ignored })}>
                          {l.ignored ? 'Restaurar' : 'Ignorar'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleConfirmMapping} disabled={activeLines.length === 0}>
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
                <p className="font-medium text-txt">{competenciaLabel}</p>
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
            <div className="max-h-[35vh] overflow-y-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-xs text-txt-muted">
                    <th className="p-2 text-left">Conta</th>
                    <th className="p-2 text-right">Valor realizado</th>
                  </tr>
                </thead>
                <tbody>
                  {activeLines.map((l, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="p-2 text-txt">{l.mappedContaNome}</td>
                      <td className="p-2 text-right font-mono text-txt">{formatCurrency(l.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
