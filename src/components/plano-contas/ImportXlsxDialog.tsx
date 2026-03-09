import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, Check } from 'lucide-react';
import { parseXlsx } from '@/lib/xlsx-parser';
import { type ImportedConta, type ContaTipo, tipoLabels, formatCurrency, getMetaSugerida, getFaturamentoReferencia, getCompetenciaAtual } from '@/lib/plano-contas-utils';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteFaixa: string;
}

export function ImportXlsxDialog({ open, onOpenChange, clienteId, clienteFaixa }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [contas, setContas] = useState<ImportedConta[]>([]);
  const [savedContaIds, setSavedContaIds] = useState<{ id: string; nome: string; tipo: ContaTipo }[]>([]);
  const [metas, setMetas] = useState<Record<string, number | null>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [hierarchyWarning, setHierarchyWarning] = useState(false);
  const queryClient = useQueryClient();

  const handleFileChange = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const parsed = await parseXlsx(file);
      setContas(parsed);
      const allLevel1 = parsed.every((c) => c.nivel === 1) && parsed.length > 3;
      setHierarchyWarning(allLevel1);
      setStep(2);
    } catch {
      toast.error('Erro ao processar o arquivo');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.xlsx')) handleFileChange(file);
    else toast.error('Apenas arquivos .xlsx são aceitos');
  }, [handleFileChange]);

  const updateConta = (index: number, field: keyof ImportedConta, value: unknown) => {
    setContas((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  };

  const handleSaveContas = async () => {
    setIsSaving(true);
    const selected = contas.filter((c) => c.selected);
    const rows = selected.map((c, i) => ({
      cliente_id: clienteId,
      nome: c.nome,
      tipo: c.tipo,
      nivel: c.nivel,
      ordem: i,
      is_total: c.is_total,
    }));

    const { data, error } = await supabase.from('plano_de_contas').insert(rows).select('id, nome, tipo');
    if (error) {
      toast.error('Erro ao salvar contas');
      setIsSaving(false);
      return;
    }
    setSavedContaIds(data || []);

    // Pre-fill meta suggestions
    const fRef = getFaturamentoReferencia(clienteFaixa);
    const metasInit: Record<string, number | null> = {};
    data?.forEach((c) => {
      const sugestao = getMetaSugerida(c.tipo as ContaTipo, c.nome, fRef);
      metasInit[c.id] = sugestao.valor;
    });
    setMetas(metasInit);

    setIsSaving(false);
    setStep(3);
    queryClient.invalidateQueries({ queryKey: ['plano-contas'] });
    queryClient.invalidateQueries({ queryKey: ['plano-contas-count'] });
    toast.success(`${data?.length} contas importadas`);
  };

  const handleSaveMetas = async () => {
    setIsSaving(true);
    const comp = getCompetenciaAtual();
    const rows = Object.entries(metas)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([contaId, valor]) => ({
        conta_id: contaId,
        competencia: comp,
        valor_meta: valor,
      }));

    if (rows.length > 0) {
      const { error } = await supabase.from('valores_mensais').upsert(rows, { onConflict: 'conta_id,competencia' });
      if (error) {
        toast.error('Erro ao salvar metas');
        setIsSaving(false);
        return;
      }
    }
    queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
    queryClient.invalidateQueries({ queryKey: ['metas-pendentes'] });
    toast.success('Metas salvas com sucesso');
    setIsSaving(false);
    handleClose();
  };

  const handleClose = () => {
    setStep(1);
    setContas([]);
    setSavedContaIds([]);
    setMetas({});
    setHierarchyWarning(false);
    onOpenChange(false);
  };

  const fRef = getFaturamentoReferencia(clienteFaixa);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && 'Importar DRE do Nibo'}
            {step === 2 && 'Revisar contas importadas'}
            {step === 3 && 'Sugestão de metas'}
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
                  Arraste o arquivo .xlsx da DRE exportado do Nibo
                </p>
                <label className="cursor-pointer">
                  <Button variant="outline" size="sm" asChild>
                    <span>
                      <FileSpreadsheet className="mr-2 h-4 w-4" />
                      Selecionar arquivo
                    </span>
                  </Button>
                  <input
                    type="file"
                    accept=".xlsx"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileChange(f);
                    }}
                  />
                </label>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            {hierarchyWarning && (
              <div className="rounded-lg border border-amber/30 bg-amber/5 p-3 text-sm text-amber">
                ⚠ Hierarquia não detectada automaticamente. Organize as contas manualmente após importar.
              </div>
            )}
            <div className="max-h-[50vh] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface">
                  <tr className="border-b border-border text-left text-xs text-txt-muted">
                    <th className="p-2 w-8"></th>
                    <th className="p-2">Nome</th>
                    <th className="p-2 w-20">Nível</th>
                    <th className="p-2 w-32">Tipo</th>
                    <th className="p-2 w-16">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {contas.map((c, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={c.selected}
                          onChange={(e) => updateConta(i, 'selected', e.target.checked)}
                          className="accent-primary"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          className="w-full bg-transparent text-sm text-txt outline-none focus:border-b focus:border-primary"
                          value={c.nome}
                          onChange={(e) => updateConta(i, 'nome', e.target.value)}
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={c.nivel}
                          onChange={(e) => updateConta(i, 'nivel', Number(e.target.value))}
                          className="rounded border border-border bg-surface-hi px-1 py-0.5 text-xs"
                        >
                          {[1, 2, 3, 4].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          value={c.tipo}
                          onChange={(e) => updateConta(i, 'tipo', e.target.value)}
                          className="rounded border border-border bg-surface-hi px-1 py-0.5 text-xs"
                        >
                          {Object.entries(tipoLabels).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2 text-center">
                        <input
                          type="checkbox"
                          checked={c.is_total}
                          onChange={(e) => updateConta(i, 'is_total', e.target.checked)}
                          className="accent-primary"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleSaveContas} disabled={isSaving || contas.filter((c) => c.selected).length === 0}>
                {isSaving ? 'Salvando...' : 'Confirmar e salvar →'}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="max-h-[50vh] overflow-y-auto space-y-2">
              {savedContaIds.map((c) => {
                const sugestao = getMetaSugerida(c.tipo as ContaTipo, c.nome, fRef);
                return (
                  <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-txt truncate">{c.nome}</p>
                      {sugestao.label && (
                        <span className={`text-[11px] ${sugestao.valor ? 'text-primary' : 'text-amber'}`}>
                          {sugestao.valor ? '🔵 ' : '🟡 '}{sugestao.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-txt-muted">R$</span>
                      <input
                        type="number"
                        className="w-28 rounded border border-border bg-surface-hi px-2 py-1 text-right font-mono text-sm text-txt outline-none focus:border-primary"
                        value={metas[c.id] ?? ''}
                        placeholder="—"
                        onChange={(e) => setMetas((prev) => ({
                          ...prev,
                          [c.id]: e.target.value ? Number(e.target.value) : null,
                        }))}
                      />
                    </div>
                    {metas[c.id] != null ? (
                      <Check className="h-4 w-4 text-green shrink-0" />
                    ) : (
                      <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber shrink-0">
                        Pendente
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>Pular — definir depois</Button>
              <Button onClick={handleSaveMetas} disabled={isSaving}>
                {isSaving ? 'Salvando...' : 'Salvar metas'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
