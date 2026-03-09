import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type ContaTipo, tipoLabels, tipoBadgeColors, getFaturamentoReferencia, getMetaSugerida, getCompetenciaAtual } from '@/lib/plano-contas-utils';
import { Copy, Check } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteSegmento: string;
  clienteFaixa: string;
}

export function CopyFromClienteDialog({ open, onOpenChange, clienteId, clienteSegmento, clienteFaixa }: Props) {
  const [selectedCliente, setSelectedCliente] = useState<string | null>(null);
  const [filterSegmento, setFilterSegmento] = useState(clienteSegmento);
  const [step, setStep] = useState<'select' | 'metas'>('select');
  const [savedContaIds, setSavedContaIds] = useState<{ id: string; nome: string; tipo: ContaTipo }[]>([]);
  const [metas, setMetas] = useState<Record<string, number | null>>({});
  const [isSaving, setIsSaving] = useState(false);
  const queryClient = useQueryClient();

  const { data: clientes } = useQuery({
    queryKey: ['clientes-with-contas', filterSegmento],
    queryFn: async () => {
      let query = supabase.from('clientes').select('*').eq('status', 'ativo').neq('id', clienteId);
      if (filterSegmento) query = query.eq('segmento', filterSegmento);
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },
    enabled: open,
  });

  const { data: contasCounts } = useQuery({
    queryKey: ['contas-counts-copy'],
    queryFn: async () => {
      const { data, error } = await supabase.from('plano_de_contas').select('cliente_id, id');
      if (error) throw error;
      const counts: Record<string, number> = {};
      data?.forEach((c) => { counts[c.cliente_id] = (counts[c.cliente_id] || 0) + 1; });
      return counts;
    },
    enabled: open,
  });

  const { data: previewContas } = useQuery({
    queryKey: ['preview-contas', selectedCliente],
    queryFn: async () => {
      if (!selectedCliente) return [];
      const { data, error } = await supabase
        .from('plano_de_contas')
        .select('*')
        .eq('cliente_id', selectedCliente)
        .order('ordem');
      if (error) throw error;
      return data;
    },
    enabled: !!selectedCliente && open,
  });

  const handleCopy = async () => {
    if (!selectedCliente || !previewContas?.length) return;
    setIsSaving(true);

    const rows = previewContas.map((c, i) => ({
      cliente_id: clienteId,
      nome: c.nome,
      tipo: c.tipo,
      nivel: c.nivel,
      ordem: i,
      is_total: c.is_total || false,
    }));

    const { data, error } = await supabase.from('plano_de_contas').insert(rows).select('id, nome, tipo');
    if (error) {
      toast.error('Erro ao copiar estrutura');
      setIsSaving(false);
      return;
    }

    setSavedContaIds(data || []);
    const fRef = getFaturamentoReferencia(clienteFaixa);
    const metasInit: Record<string, number | null> = {};
    data?.forEach((c) => {
      const s = getMetaSugerida(c.tipo as ContaTipo, c.nome, fRef);
      metasInit[c.id] = s.valor;
    });
    setMetas(metasInit);

    queryClient.invalidateQueries({ queryKey: ['plano-contas'] });
    queryClient.invalidateQueries({ queryKey: ['plano-contas-count'] });
    toast.success(`${data?.length} contas copiadas`);
    setIsSaving(false);
    setStep('metas');
  };

  const handleSaveMetas = async () => {
    setIsSaving(true);
    const comp = getCompetenciaAtual();
    const rows = Object.entries(metas)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([contaId, valor]) => ({ conta_id: contaId, competencia: comp, valor_meta: valor }));

    if (rows.length > 0) {
      const { error } = await supabase.from('valores_mensais').upsert(rows, { onConflict: 'conta_id,competencia' });
      if (error) { toast.error('Erro ao salvar metas'); setIsSaving(false); return; }
    }
    queryClient.invalidateQueries({ queryKey: ['valores-mensais'] });
    queryClient.invalidateQueries({ queryKey: ['metas-pendentes'] });
    toast.success('Metas salvas');
    setIsSaving(false);
    handleClose();
  };

  const handleClose = () => {
    setStep('select');
    setSelectedCliente(null);
    setSavedContaIds([]);
    setMetas({});
    onOpenChange(false);
  };

  const segmentos = ['alimentacao', 'saude', 'estetica', 'varejo', 'servicos', 'outro'];
  const fRef = getFaturamentoReferencia(clienteFaixa);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{step === 'select' ? 'Copiar de outro cliente' : 'Sugestão de metas'}</DialogTitle>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4">
            <select
              value={filterSegmento}
              onChange={(e) => { setFilterSegmento(e.target.value); setSelectedCliente(null); }}
              className="rounded border border-border bg-surface-hi px-3 py-1.5 text-sm"
            >
              <option value="">Todos os segmentos</option>
              {segmentos.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>

            <div className="grid gap-2 max-h-[30vh] overflow-y-auto">
              {clientes?.filter((c) => (contasCounts?.[c.id] || 0) > 0).map((c) => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCliente(c.id)}
                  className={`flex items-center justify-between rounded-lg border p-3 text-left text-sm transition-colors ${
                    selectedCliente === c.id ? 'border-primary bg-primary-lo' : 'border-border hover:bg-surface-hi'
                  }`}
                >
                  <div>
                    <p className="font-medium text-txt">{c.nome_empresa}</p>
                    <p className="text-xs text-txt-muted">{c.segmento}</p>
                  </div>
                  <span className="font-mono text-xs text-txt-sec">{contasCounts?.[c.id] || 0} contas</span>
                </button>
              ))}
              {clientes?.filter((c) => (contasCounts?.[c.id] || 0) > 0).length === 0 && (
                <p className="py-8 text-center text-sm text-txt-muted">Nenhum cliente com plano configurado</p>
              )}
            </div>

            {selectedCliente && previewContas && previewContas.length > 0 && (
              <div className="rounded-lg border border-border bg-surface-hi p-3">
                <p className="mb-2 text-xs font-semibold text-txt-muted uppercase">Preview da estrutura</p>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {previewContas.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-xs" style={{ paddingLeft: (c.nivel - 1) * 16 }}>
                      <span className={`rounded px-1.5 py-0.5 ${tipoBadgeColors[c.tipo as ContaTipo] || ''}`}>
                        {tipoLabels[c.tipo as ContaTipo] || c.tipo}
                      </span>
                      <span className={c.is_total ? 'font-bold text-txt' : 'text-txt-sec'}>{c.nome}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={handleCopy} disabled={!selectedCliente || isSaving}>
                <Copy className="mr-2 h-4 w-4" />
                {isSaving ? 'Copiando...' : 'Copiar estrutura →'}
              </Button>
            </div>
          </div>
        )}

        {step === 'metas' && (
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
                        onChange={(e) => setMetas((prev) => ({ ...prev, [c.id]: e.target.value ? Number(e.target.value) : null }))}
                      />
                    </div>
                    {metas[c.id] != null ? <Check className="h-4 w-4 text-green shrink-0" /> : (
                      <span className="rounded-full bg-amber/10 px-2 py-0.5 text-[10px] font-medium text-amber shrink-0">Pendente</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={handleClose}>Pular — definir depois</Button>
              <Button onClick={handleSaveMetas} disabled={isSaving}>{isSaving ? 'Salvando...' : 'Salvar metas'}</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
