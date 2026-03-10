import { useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { parseCategoriasNibo, type ResultadoParseCategorias } from '@/lib/nibo-categorias-parser';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const MAPA_TIPO: Record<string, string> = {
  'receitas operacionais': 'receita',
  'custos operacionais': 'custo_variavel',
  'despesas operacionais e outras receitas': 'despesa_fixa',
  'atividades de investimento': 'investimento',
  'atividades de financiamento': 'financeiro',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteFaixa?: string;
}

export function ImportXlsxDialog({ open, onOpenChange, clienteId }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [parseResult, setParseResult] = useState<ResultadoParseCategorias | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [done, setDone] = useState(false);
  const queryClient = useQueryClient();

  const handleFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const result = await parseCategoriasNibo(file);
      setParseResult(result);
      if (result.valido) setStep(1); // stay on step 1 showing results
    } catch {
      setParseResult({ valido: false, erro: 'Erro ao processar o arquivo.', grupos: [], subgrupos: [], categorias: [], avisos: [] });
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.xlsx')) handleFile(file);
    else toast.error('Apenas arquivos .xlsx são aceitos');
  }, [handleFile]);

  const handleConfirm = async () => {
    if (!parseResult || !parseResult.valido) return;
    setIsSaving(true);
    setStep(3);

    try {
      // Step A: delete existing
      await supabase.from('plano_de_contas').delete().eq('cliente_id', clienteId);

      // Step B: create groups (nivel=0)
      const mapaGrupos: Record<string, string> = {};
      for (let i = 0; i < parseResult.grupos.length; i++) {
        const grupo = parseResult.grupos[i];
        const tipoGrupo = MAPA_TIPO[grupo.toLowerCase().trim()] || 'despesa_fixa';
        const { data, error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: grupo,
          tipo: tipoGrupo,
          nivel: 0,
          is_total: false,
          ordem: i,
          conta_pai_id: null,
        }).select('id').single();
        if (error || !data) throw new Error(`Erro ao criar grupo: ${grupo}`);
        mapaGrupos[grupo] = data.id;
      }

      // Step C: create subgroups (nivel=1)
      const mapaSubgrupos: Record<string, string> = {};
      for (let i = 0; i < parseResult.subgrupos.length; i++) {
        const sub = parseResult.subgrupos[i];
        const tipoSub = MAPA_TIPO[sub.grupo.toLowerCase().trim()] || 'despesa_fixa';
        const { data, error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: sub.nome,
          tipo: tipoSub,
          nivel: 1,
          is_total: false,
          ordem: i,
          conta_pai_id: mapaGrupos[sub.grupo] || null,
        }).select('id').single();
        if (error || !data) throw new Error(`Erro ao criar subgrupo: ${sub.nome}`);
        mapaSubgrupos[sub.grupo + '||' + sub.nome] = data.id;
      }

      // Step D: create categories (nivel=2)
      for (const cat of parseResult.categorias) {
        const chave = cat.grupo + '||' + cat.subgrupo;
        const { error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: cat.nomeLimpo,
          tipo: cat.tipo,
          nivel: 2,
          is_total: false,
          ordem: cat.ordem,
          conta_pai_id: mapaSubgrupos[chave] || null,
        });
        if (error) throw new Error(`Erro ao criar categoria: ${cat.nomeLimpo}`);
      }

      setDone(true);
      queryClient.invalidateQueries({ queryKey: ['plano-contas'] });
      queryClient.invalidateQueries({ queryKey: ['plano-contas-count'] });
      toast.success('Plano de contas criado com sucesso');
    } catch (err) {
      console.error(err);
      // Rollback
      await supabase.from('plano_de_contas').delete().eq('cliente_id', clienteId);
      toast.error('Falha ao criar plano. Nenhuma conta foi salva. Tente novamente.');
      setStep(1);
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (done) {
      queryClient.invalidateQueries({ queryKey: ['plano-contas'] });
    }
    setStep(1);
    setParseResult(null);
    setIsUploading(false);
    setIsSaving(false);
    setDone(false);
    onOpenChange(false);
  };

  const totalGrupos = parseResult?.grupos.length ?? 0;
  const totalSubgrupos = parseResult?.subgrupos.length ?? 0;
  const totalCategorias = parseResult?.categorias.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 && 'Configurar Plano de Contas'}
            {step === 2 && 'Visualizar estrutura'}
            {step === 3 && (done ? 'Plano criado' : 'Criando plano...')}
          </DialogTitle>
        </DialogHeader>

        {/* STEP 1 — Upload */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Exporte as categorias do Nibo e faça o upload aqui.
              <br />
              <span className="text-xs">No Nibo: <strong>Configurações → Categorias → Exportar</strong></span>
            </p>

            <div
              className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border p-10 transition-colors hover:border-primary"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              {isUploading ? (
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              ) : (
                <>
                  <Upload className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground text-center">Arraste o arquivo .xlsx ou clique para selecionar</p>
                  <label className="cursor-pointer">
                    <Button variant="outline" size="sm" asChild>
                      <span><FileSpreadsheet className="mr-2 h-4 w-4" />Selecionar arquivo</span>
                    </Button>
                    <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
                  </label>
                </>
              )}
            </div>

            {parseResult && !parseResult.valido && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>{parseResult.erro}</span>
              </div>
            )}

            {parseResult && parseResult.valido && (
              <>
                <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-3 text-sm text-green-700 flex items-start gap-2">
                  <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>✓ {totalGrupos} grupos · {totalSubgrupos} subgrupos · {totalCategorias} categorias encontradas</span>
                </div>

                {parseResult.avisos.length > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 space-y-1">
                    {parseResult.avisos.map((a, i) => (
                      <p key={i} className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>{a}</span>
                      </p>
                    ))}
                  </div>
                )}

                <div className="flex justify-end">
                  <Button onClick={() => setStep(2)}>Visualizar estrutura →</Button>
                </div>
              </>
            )}
          </div>
        )}

        {/* STEP 2 — Preview */}
        {step === 2 && parseResult && (
          <div className="space-y-4">
            <div className="max-h-[55vh] overflow-y-auto rounded-lg border border-border">
              {parseResult.grupos.map((grupo) => (
                <div key={grupo}>
                  {/* Group band */}
                  <div className="px-4 py-2.5" style={{ backgroundColor: '#F3F4F6' }}>
                    <span className="text-xs font-semibold uppercase tracking-wide text-foreground">{grupo.toUpperCase()}</span>
                  </div>

                  {parseResult.subgrupos
                    .filter((s) => s.grupo === grupo)
                    .map((sub) => (
                      <div key={sub.grupo + '||' + sub.nome}>
                        {/* Subgroup */}
                        <div className="px-4 py-2.5 border-b" style={{ borderColor: '#F3F4F6' }}>
                          <span className="text-sm font-semibold text-foreground">{sub.nome}</span>
                        </div>

                        {/* Categories */}
                        {parseResult.categorias
                          .filter((c) => c.grupo === grupo && c.subgrupo === sub.nome)
                          .map((cat, ci) => (
                            <div key={ci} className="flex items-center gap-2 py-2 pr-4 border-b" style={{ paddingLeft: '40px', borderColor: '#F3F4F6' }}>
                              <span style={{ color: cat.prefixo === '+' ? '#16A34A' : '#DC2626' }} className="text-sm font-medium">
                                {cat.prefixo === '+' ? '↑' : '↓'}
                              </span>
                              <span className="text-sm text-foreground">{cat.nomeLimpo}</span>
                            </div>
                          ))}
                      </div>
                    ))}
                </div>
              ))}
            </div>

            <div className="rounded-lg border border-border bg-muted/50 p-3 text-sm text-muted-foreground text-center">
              {totalGrupos} grupos · {totalSubgrupos} subgrupos · {totalCategorias} categorias
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}>← Voltar</Button>
              <Button onClick={handleConfirm}>Confirmar e criar plano →</Button>
            </div>
          </div>
        )}

        {/* STEP 3 — Execution / Done */}
        {step === 3 && (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            {!done ? (
              <>
                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Criando plano de contas...</p>
              </>
            ) : (
              <>
                <CheckCircle className="h-12 w-12 text-green-500" />
                <p className="text-lg font-semibold text-foreground">Plano criado com sucesso</p>
                <p className="text-sm text-muted-foreground">
                  {totalGrupos} grupos · {totalSubgrupos} subgrupos · {totalCategorias} categorias
                </p>
                <Button onClick={handleClose}>Fechar</Button>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
