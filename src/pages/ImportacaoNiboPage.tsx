import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload, FileSpreadsheet, Pencil, Trash2, Check, ChevronRight,
  ArrowUp, ArrowDown, Info, CheckCircle2, AlertTriangle,
} from 'lucide-react';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { parseNiboXlsx, buildCompetencia, mesAbrevParaNomeCompleto, type ResultadoParseNibo, type ContaParseada } from '@/lib/nibo-parser';
import { ImportNiboDialog } from '@/components/importacao/ImportNiboDialog';
import { ImportActionDialog } from '@/components/importacao/ImportActionDialog';
import { formatCurrency } from '@/lib/plano-contas-utils';
import { toast } from 'sonner';

const competencias = getCompetenciaOptions();

export default function ImportacaoNiboPage() {
  const [clienteId, setClienteId] = useState('');
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [importOpen, setImportOpen] = useState(false);
  const [actionDialog, setActionDialog] = useState<{ type: 'edit' | 'delete'; importId: string; currentCompetencia: string; clienteId: string } | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Mode A state
  const [modeAStep, setModeAStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const [parseResult, setParseResult] = useState<ResultadoParseNibo | null>(null);
  const [selectedMes, setSelectedMes] = useState('');
  const [fileName, setFileName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ grupos: number; categorias: number; valores: number } | null>(null);

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
      return data || [];
    },
  });

  const hasPlano = contas && contas.length > 0;
  const clienteSel = clientes?.find((c) => c.id === clienteId);
  const compLabel = competencias.find((c) => c.value === competencia)?.label || '';

  // ========== MODE A HANDLERS ==========
  const handleModeAFile = useCallback(async (file: File) => {
    try {
      const result = await parseNiboXlsx(file);
      setParseResult(result);
      setFileName(file.name);
      if (result.mesesDisponiveis.length > 0) setSelectedMes(result.mesesDisponiveis[0]);
      setModeAStep(1);
    } catch {
      toast.error('Erro ao processar o arquivo');
    }
  }, []);

  const handleModeADrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.name.endsWith('.xlsx')) handleModeAFile(file);
    else toast.error('Apenas arquivos .xlsx são aceitos');
  }, [handleModeAFile]);

  const handleModeAConfirm = async () => {
    if (!parseResult || !clienteId || !selectedMes) return;
    setIsSaving(true);
    try {
      const comp = buildCompetencia(selectedMes, parseResult.anoReferencia);

      // PASSO 1: Create seções (nivel 0)
      const secaoIdMap: Record<string, string> = {};
      let ordem = 0;
      for (const secao of parseResult.secoes) {
        const tipo = parseResult.contas.find((c) => c.secaoNome === secao)?.tipo || 'despesa_fixa';
        const { data, error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: secao,
          tipo,
          nivel: 0,
          is_total: false,
          ordem: ordem++,
          conta_pai_id: null,
        }).select('id').single();
        if (error) throw error;
        secaoIdMap[secao] = data.id;
      }

      // PASSO 2: Create grupos (nivel 1)
      const grupoIdMap: Record<string, string> = {};
      const grupos = parseResult.contas.filter((c) => c.nivel === 1);
      for (const grupo of grupos) {
        const paiId = secaoIdMap[grupo.secaoNome] || null;
        const { data, error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: grupo.nome,
          tipo: grupo.tipo,
          nivel: 1,
          is_total: false,
          ordem: ordem++,
          conta_pai_id: paiId,
        }).select('id').single();
        if (error) throw error;
        grupoIdMap[grupo.nomeOriginal] = data.id;
      }

      // PASSO 3: Create categorias (nivel 2) + collect valores
      const valoresRows: { conta_id: string; competencia: string; valor_realizado: number }[] = [];
      const categorias = parseResult.contas.filter((c) => c.nivel === 2);
      for (const cat of categorias) {
        const paiId = cat.grupoNome ? grupoIdMap[cat.grupoNome] : null;
        const { data, error } = await supabase.from('plano_de_contas').insert({
          cliente_id: clienteId,
          nome: cat.nome,
          tipo: cat.tipo,
          nivel: 2,
          is_total: false,
          ordem: ordem++,
          conta_pai_id: paiId,
        }).select('id').single();
        if (error) throw error;

        const val = cat.valores[selectedMes];
        if (val !== undefined && val !== null) {
          valoresRows.push({ conta_id: data.id, competencia: comp, valor_realizado: val });
        }
      }

      // PASSO 4: Insert valores
      if (valoresRows.length > 0) {
        const { error } = await supabase.from('valores_mensais').upsert(valoresRows, { onConflict: 'conta_id,competencia' });
        if (error) throw error;
      }

      // Record import
      const { data: userData } = await supabase.auth.getUser();
      await supabase.from('importacoes_nibo').insert({
        cliente_id: clienteId,
        competencia: comp,
        arquivo_nome: fileName,
        status: 'processado',
        total_contas_importadas: categorias.length,
        total_contas_nao_mapeadas: 0,
        importado_por: userData.user?.id || null,
      });

      setSaveResult({ grupos: grupos.length, categorias: categorias.length, valores: valoresRows.length });
      setModeAStep(4);
      queryClient.invalidateQueries({ queryKey: ['plano-contas-simple'] });
      queryClient.invalidateQueries({ queryKey: ['importacoes-nibo'] });
      queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
    } catch (err) {
      console.error('Erro ao criar plano:', err);
      toast.error('Erro ao criar plano de contas. Verifique e tente novamente.');
    } finally {
      setIsSaving(false);
    }
  };

  const resetModeA = () => {
    setModeAStep(0);
    setParseResult(null);
    setSelectedMes('');
    setFileName('');
    setSaveResult(null);
  };

  const handleRecriarPlano = async () => {
    if (!clienteId) return;
    const confirmed = window.confirm('Isso substituirá o plano de contas existente. Todos os valores importados serão perdidos. Deseja continuar?');
    if (!confirmed) return;
    // Delete existing contas (cascade will handle valores_mensais via FK)
    await supabase.from('plano_de_contas').delete().eq('cliente_id', clienteId);
    queryClient.invalidateQueries({ queryKey: ['plano-contas-simple'] });
    toast.success('Plano anterior removido. Importe o arquivo para criar o novo.');
  };

  // ========== RENDER ==========

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

  const mesLabel = parseResult ? mesAbrevParaNomeCompleto(selectedMes, parseResult.anoReferencia) : '';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt">Importação Nibo</h1>
        <p className="text-sm text-txt-sec">Importe a planilha de DRE exportada do Nibo para registrar os valores realizados do mês</p>
      </div>

      {/* Client selector */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Cliente</label>
          <Select value={clienteId} onValueChange={(v) => { setClienteId(v); resetModeA(); }}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Selecionar cliente..." /></SelectTrigger>
            <SelectContent>
              {clientes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ============ MODE A: Empty plan ============ */}
      {clienteId && !hasPlano && modeAStep === 0 && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/5 p-4">
            <Info className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-txt">Este cliente ainda não tem plano de contas configurado.</p>
              <p className="text-sm text-txt-sec mt-1">Ao importar o arquivo do Nibo, o plano será criado automaticamente com a mesma estrutura de categorias do Nibo.</p>
            </div>
          </div>
          <div
            className="flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-border p-12 transition-colors hover:border-primary"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleModeADrop}
          >
            <Upload className="h-12 w-12 text-txt-muted" />
            <p className="text-sm text-txt-sec text-center">Arraste o arquivo .xlsx exportado do Nibo</p>
            <label className="cursor-pointer">
              <Button variant="default" size="default" asChild>
                <span><FileSpreadsheet className="mr-2 h-4 w-4" />Importar e configurar plano de contas</span>
              </Button>
              <input type="file" accept=".xlsx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleModeAFile(f); }} />
            </label>
          </div>
        </div>
      )}

      {/* MODE A Step 1: Summary + Month selection */}
      {clienteId && !hasPlano && modeAStep === 1 && parseResult && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <h3 className="text-sm font-bold text-txt">Estrutura detectada</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-txt-sec">• <strong className="text-txt">{parseResult.totalGrupos}</strong> grupos encontrados</span>
              <span className="text-txt-sec">• <strong className="text-txt">{parseResult.totalCategorias}</strong> categorias encontradas</span>
              <span className="text-txt-sec">• Meses: <strong className="text-txt">{parseResult.mesesDisponiveis.join(', ')}</strong></span>
            </div>
            <div className="space-y-1 pt-2">
              <label className="text-xs text-txt-muted">Qual mês importar junto?</label>
              <Select value={selectedMes} onValueChange={setSelectedMes}>
                <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {parseResult.mesesDisponiveis.map((m) => (
                    <SelectItem key={m} value={m}>{mesAbrevParaNomeCompleto(m, parseResult.anoReferencia)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={resetModeA}>← Voltar</Button>
            <Button onClick={() => setModeAStep(2)} disabled={!selectedMes}>Criar plano e importar →</Button>
          </div>
        </div>
      )}

      {/* MODE A Step 2: Preview hierarchy */}
      {clienteId && !hasPlano && modeAStep === 2 && parseResult && (
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-txt">Preview da estrutura que será criada</h3>
          <div className="rounded-xl border border-border bg-surface overflow-hidden max-h-[60vh] overflow-y-auto">
            {parseResult.secoes.map((secao) => {
              const secaoContas = parseResult.contas.filter((c) => c.secaoNome === secao);
              return (
                <div key={secao}>
                  {/* Seção header */}
                  <div className="bg-muted px-4 py-2.5 text-xs font-bold text-txt uppercase tracking-wide border-b border-border">
                    {secao}
                  </div>
                  {secaoContas.map((conta, idx) => {
                    const val = conta.valores[selectedMes] ?? 0;
                    const isGrupo = conta.nivel === 1;
                    return (
                      <div
                        key={idx}
                        className={`flex items-center justify-between px-4 py-2 border-b border-border/50 ${isGrupo ? 'bg-surface font-semibold' : 'bg-surface'}`}
                        style={{ paddingLeft: isGrupo ? '16px' : '40px' }}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          {!isGrupo && (
                            conta.prefixo === '+' ? (
                              <ArrowUp className="h-3.5 w-3.5 text-green shrink-0" />
                            ) : (
                              <ArrowDown className="h-3.5 w-3.5 text-destructive shrink-0" />
                            )
                          )}
                          <span className={`text-sm truncate ${val === 0 && !isGrupo ? 'text-txt-muted' : 'text-txt'}`}>
                            {conta.nome}
                          </span>
                          <Badge variant="outline" className="text-[10px] shrink-0">{isGrupo ? 'Grupo' : 'Conta'}</Badge>
                        </div>
                        {!isGrupo && (
                          <span className={`text-xs font-mono tabular-nums shrink-0 ${val === 0 ? 'text-txt-muted' : 'text-txt'}`}>
                            {formatCurrency(val)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setModeAStep(1)}>← Voltar</Button>
            <Button onClick={handleModeAConfirm} disabled={isSaving}>
              {isSaving ? 'Criando plano...' : 'Confirmar e criar'}
            </Button>
          </div>
        </div>
      )}

      {/* MODE A Step 4: Success */}
      {clienteId && modeAStep === 4 && saveResult && parseResult && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-green/30 bg-green/5 p-5">
            <CheckCircle2 className="h-6 w-6 text-green mt-0.5 shrink-0" />
            <div>
              <h3 className="text-sm font-bold text-txt">Plano de contas criado com sucesso</h3>
              <p className="text-sm text-txt-sec mt-1">
                {saveResult.grupos} grupos · {saveResult.categorias} categorias
              </p>
              <p className="text-sm text-txt-sec">
                Valores de {mesLabel} importados: {saveResult.valores} contas
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate(`/plano-de-contas/${clienteId}`)}>
              Ver plano de contas →
            </Button>
            <Button variant="outline" onClick={() => navigate('/torre-de-controle')}>
              Ver Torre de Controle →
            </Button>
          </div>
        </div>
      )}

      {/* ============ MODE B: Existing plan ============ */}
      {clienteId && hasPlano && (
        <>
          <div className="flex flex-wrap items-end gap-4">
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

          <button
            onClick={handleRecriarPlano}
            className="text-xs text-txt-muted hover:text-primary underline underline-offset-2 transition-colors"
          >
            Recriar plano de contas a partir do arquivo ↗
          </button>

          {/* Import history */}
          {historico && historico.length > 0 && (
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
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-txt-muted hover:text-primary"
                            onClick={() => setActionDialog({ type: 'edit', importId: h.id, currentCompetencia: h.competencia, clienteId: h.cliente_id })}
                            title="Alterar competência">
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-txt-muted hover:text-destructive"
                            onClick={() => setActionDialog({ type: 'delete', importId: h.id, currentCompetencia: h.competencia, clienteId: h.cliente_id })}
                            title="Excluir importação">
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

          {(!historico || historico.length === 0) && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <FileSpreadsheet className="h-16 w-16 text-txt-muted/40" />
              <p className="text-txt-sec">Nenhuma importação registrada para este cliente</p>
            </div>
          )}

          <ImportNiboDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            clienteId={clienteId}
            clienteNome={clienteSel?.nome_empresa || ''}
            competencia={competencia}
            competenciaLabel={compLabel}
            contas={contas || []}
          />
        </>
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
