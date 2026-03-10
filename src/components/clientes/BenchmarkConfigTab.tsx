import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Settings, Plus, RotateCcw, ArrowUp, ArrowDown, X, Search } from 'lucide-react';
import type { ContaRow } from '@/lib/plano-contas-utils';
import { fetchAllIndicadores, type KpiIndicador } from '@/lib/kpi-indicadores-utils';

interface Props { clienteId: string; }

const TIPO_LABELS: Record<string, string> = {
  custo_variavel: 'CUSTOS VARIÁVEIS',
  despesa_fixa: 'DESPESAS FIXAS',
  investimento: 'INVESTIMENTOS',
  financeiro: 'FINANCEIRO',
};

export function BenchmarkConfigTab({ clienteId }: Props) {
  const queryClient = useQueryClient();
  const [editItem, setEditItem] = useState<KpiIndicador | null>(null);
  const [showNew, setShowNew] = useState(false);

  const { data: indicadores, isLoading } = useQuery({
    queryKey: ['kpi-indicadores-config', clienteId],
    queryFn: () => fetchAllIndicadores(clienteId),
    enabled: !!clienteId,
  });

  const { data: contas } = useQuery({
    queryKey: ['plano-contas-config', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const ativos = useMemo(() => indicadores?.filter(i => i.ativo) || [], [indicadores]);
  const inativos = useMemo(() => indicadores?.filter(i => !i.ativo) || [], [indicadores]);

  const toggleAtivo = useMutation({
    mutationFn: async ({ ind, newAtivo }: { ind: KpiIndicador; newAtivo: boolean }) => {
      if (ind.cliente_id === clienteId) {
        await supabase.from('kpi_indicadores' as any).update({ ativo: newAtivo }).eq('id', ind.id);
      } else {
        await supabase.from('kpi_indicadores' as any).insert({
          cliente_id: clienteId, nome: ind.nome, descricao: ind.descricao,
          tipo_fonte: ind.tipo_fonte, conta_id: ind.conta_id, totalizador_key: ind.totalizador_key,
          limite_verde: ind.limite_verde, limite_ambar: ind.limite_ambar, direcao: ind.direcao,
          ativo: newAtivo, ordem: ind.ordem,
          conta_ids: (ind as any).conta_ids || [],
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-indicadores', clienteId] });
      queryClient.invalidateQueries({ queryKey: ['kpi-indicadores-config', clienteId] });
    },
  });

  const moveOrder = useMutation({
    mutationFn: async ({ ind, direction }: { ind: KpiIndicador; direction: 'up' | 'down' }) => {
      const list = [...(indicadores || [])].sort((a, b) => a.ordem - b.ordem);
      const idx = list.findIndex(i => i.id === ind.id);
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= list.length) return;

      const current = list[idx];
      const swap = list[swapIdx];

      const updateOrCreate = async (item: KpiIndicador, newOrdem: number) => {
        if (item.cliente_id === clienteId) {
          await supabase.from('kpi_indicadores' as any).update({ ordem: newOrdem }).eq('id', item.id);
        } else {
          await supabase.from('kpi_indicadores' as any).insert({
            cliente_id: clienteId, nome: item.nome, descricao: item.descricao,
            tipo_fonte: item.tipo_fonte, conta_id: item.conta_id, totalizador_key: item.totalizador_key,
            limite_verde: item.limite_verde, limite_ambar: item.limite_ambar, direcao: item.direcao,
            ativo: item.ativo, ordem: newOrdem,
            conta_ids: (item as any).conta_ids || [],
          });
        }
      };
      await updateOrCreate(current, swap.ordem);
      await updateOrCreate(swap, current.ordem);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-indicadores', clienteId] });
      queryClient.invalidateQueries({ queryKey: ['kpi-indicadores-config', clienteId] });
    },
  });

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 py-4">
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#8A9BBC', letterSpacing: '0.08em' }}>
          INDICADORES DE SAÚDE
        </div>
        <p style={{ fontSize: 12, color: '#4A5E80', marginTop: 4 }}>
          Gerencie os indicadores que compõem o Score de Saúde Financeira do cliente
        </p>
      </div>

      {/* Active indicators table */}
      <div className="rounded-lg border" style={{ borderColor: '#DDE4F0', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#F0F4FA', borderBottom: '1px solid #DDE4F0' }}>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 40 }}>⇅</th>
              <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80' }}>INDICADOR</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 100 }}>FONTE</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 200 }}>LIMITES</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 80 }}>ATIVO</th>
              <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 100 }}>AÇÕES</th>
            </tr>
          </thead>
          <tbody>
            {[...ativos, ...inativos].map((ind, idx) => {
              const isDefault = ind.cliente_id === null;
              return (
                <tr key={ind.id} style={{ borderBottom: '1px solid #F0F4FA', background: ind.ativo ? '#FFFFFF' : '#F8F9FB', opacity: ind.ativo ? 1 : 0.6 }}>
                  <td style={{ padding: '8px 12px' }}>
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => moveOrder.mutate({ ind, direction: 'up' })} className="p-0.5 rounded hover:bg-muted" disabled={idx === 0}>
                        <ArrowUp className="h-3 w-3" style={{ color: '#8A9BBC' }} />
                      </button>
                      <button onClick={() => moveOrder.mutate({ ind, direction: 'down' })} className="p-0.5 rounded hover:bg-muted">
                        <ArrowDown className="h-3 w-3" style={{ color: '#8A9BBC' }} />
                      </button>
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: '#0D1B35', fontWeight: 500 }}>{ind.nome}</span>
                    {isDefault && <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded" style={{ background: '#F0F4FA', color: '#8A9BBC' }}>GPI</span>}
                    {ind.descricao && <p className="text-[10px] mt-0.5" style={{ color: '#8A9BBC' }}>{ind.descricao}</p>}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', fontSize: 11, color: '#4A5E80' }}>
                    {ind.tipo_fonte === 'totalizador' ? ind.totalizador_key : 'Subgrupo'}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <div className="flex items-center justify-center gap-2" style={{ fontSize: 11 }}>
                      <span className="inline-flex items-center gap-1">
                        <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#00A86B" /></svg>
                        {ind.direcao === 'menor_melhor' ? `<${ind.limite_verde}%` : `>${ind.limite_verde}%`}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#D97706" /></svg>
                        {ind.direcao === 'menor_melhor' ? `${ind.limite_verde}–${ind.limite_ambar}%` : `${ind.limite_ambar}–${ind.limite_verde}%`}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#DC2626" /></svg>
                        {ind.direcao === 'menor_melhor' ? `>${ind.limite_ambar}%` : `<${ind.limite_ambar}%`}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <Switch checked={ind.ativo} onCheckedChange={v => toggleAtivo.mutate({ ind, newAtivo: v })} />
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <button
                      onClick={() => setEditItem(ind)}
                      className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
                      style={{ color: '#1A3CFF' }}
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Configurar
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => setShowNew(true)}
        className="flex items-center gap-1.5 text-xs font-medium hover:underline"
        style={{ color: '#1A3CFF' }}
      >
        <Plus className="h-3.5 w-3.5" />
        Novo indicador
      </button>

      {/* Edit Modal */}
      {(editItem || showNew) && (
        <ConfigModal
          indicador={editItem}
          clienteId={clienteId}
          contas={contas || []}
          onClose={() => { setEditItem(null); setShowNew(false); }}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['kpi-indicadores', clienteId] });
            queryClient.invalidateQueries({ queryKey: ['kpi-indicadores-config', clienteId] });
            queryClient.invalidateQueries({ queryKey: ['kpi-indicadores-benchmark', clienteId] });
            setEditItem(null);
            setShowNew(false);
          }}
        />
      )}
    </div>
  );
}

function ConfigModal({ indicador, clienteId, contas, onClose, onSaved }: {
  indicador: KpiIndicador | null;
  clienteId: string;
  contas: ContaRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !indicador;
  const isOverride = indicador?.cliente_id === clienteId;

  const [nome, setNome] = useState(indicador?.nome || '');
  const [descricao, setDescricao] = useState(indicador?.descricao || '');
  const [tipoFonte, setTipoFonte] = useState(indicador?.tipo_fonte || 'subgrupo');
  const [selectedContaIds, setSelectedContaIds] = useState<string[]>(() => {
    const ids = (indicador as any)?.conta_ids;
    if (ids && Array.isArray(ids) && ids.length > 0) return ids;
    if (indicador?.conta_id) return [indicador.conta_id];
    return [];
  });
  const [totalizadorKey, setTotalizadorKey] = useState(indicador?.totalizador_key || 'MC');
  const [direcao, setDirecao] = useState(indicador?.direcao || 'menor_melhor');
  const [limiteVerde, setLimiteVerde] = useState(indicador ? String(indicador.limite_verde) : '');
  const [limiteAmbar, setLimiteAmbar] = useState(indicador ? String(indicador.limite_ambar) : '');
  const [ativo, setAtivo] = useState(indicador?.ativo ?? true);

  // Build hierarchical tree: N1 subgroups with N2 children
  const contasTree = useMemo(() => {
    const n1 = contas.filter(c => c.nivel === 1 && ['custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'].includes(c.tipo));
    const groups: Record<string, { sub: ContaRow; children: ContaRow[] }[]> = {};
    for (const s of n1) {
      if (!groups[s.tipo]) groups[s.tipo] = [];
      const children = contas.filter(c => c.conta_pai_id === s.id && c.nivel === 2).sort((a, b) => a.ordem - b.ordem);
      groups[s.tipo].push({ sub: s, children });
    }
    return groups;
  }, [contas]);

  const verde = Number(limiteVerde);
  const ambar = Number(limiteAmbar);
  const hasValid = !isNaN(verde) && !isNaN(ambar) && limiteVerde !== '' && limiteAmbar !== '';

  // Helper: get parent subgroup of a conta
  const getParentSub = (id: string) => contas.find(c => c.id === id && c.nivel === 1) ? id : contas.find(c => c.nivel === 2 && c.id === id)?.conta_pai_id;

  const toggleContaId = (id: string) => {
    const conta = contas.find(c => c.id === id);
    if (!conta) return;

    if (conta.nivel === 1) {
      // Selecting a subgroup
      if (selectedContaIds.includes(id)) {
        // Deselecting subgroup
        setSelectedContaIds(prev => prev.filter(x => x !== id));
        return;
      }
      // Check if any children are already selected
      const childIds = contas.filter(c => c.conta_pai_id === id && c.nivel === 2).map(c => c.id);
      const selectedChildren = childIds.filter(cid => selectedContaIds.includes(cid));
      if (selectedChildren.length > 0) {
        if (window.confirm(`Algumas categorias filhas estão selecionadas. Selecionar o subgrupo vai substituí-las. Confirmar?`)) {
          setSelectedContaIds(prev => [...prev.filter(x => !selectedChildren.includes(x)), id]);
        }
        return;
      }
      setSelectedContaIds(prev => [...prev, id]);
    } else if (conta.nivel === 2) {
      if (selectedContaIds.includes(id)) {
        setSelectedContaIds(prev => prev.filter(x => x !== id));
        return;
      }
      // Check if parent subgroup is selected
      if (conta.conta_pai_id && selectedContaIds.includes(conta.conta_pai_id)) {
        toast.error(`O subgrupo pai já está selecionado. Remova-o antes de selecionar categorias individuais.`);
        return;
      }
      setSelectedContaIds(prev => [...prev, id]);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!nome.trim()) throw new Error('Nome obrigatório');
      if (!hasValid) throw new Error('Limites inválidos');

      const payload: any = {
        cliente_id: clienteId,
        nome: nome.trim(),
        descricao: descricao || null,
        tipo_fonte: tipoFonte,
        conta_id: tipoFonte === 'subgrupo' && selectedContaIds.length > 0 ? selectedContaIds[0] : null,
        conta_ids: tipoFonte === 'subgrupo' ? selectedContaIds : [],
        totalizador_key: tipoFonte === 'totalizador' ? totalizadorKey : null,
        limite_verde: verde,
        limite_ambar: ambar,
        direcao,
        ativo,
        ordem: indicador?.ordem ?? 99,
      };

      if (isNew) {
        const { error } = await supabase.from('kpi_indicadores' as any).insert(payload);
        if (error) throw error;
      } else if (isOverride) {
        const { error } = await supabase.from('kpi_indicadores' as any).update(payload).eq('id', indicador!.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('kpi_indicadores' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success('Indicador salvo'); onSaved(); },
    onError: (err: Error) => toast.error(err.message || 'Erro ao salvar'),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (isOverride && indicador) {
        await supabase.from('kpi_indicadores' as any).delete().eq('id', indicador.id);
      }
    },
    onSuccess: () => { toast.success('Restaurado para padrão GPI'); onSaved(); },
  });

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent style={{ minWidth: 520, maxWidth: 580 }} className="w-[95vw] sm:w-auto">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Novo Indicador' : `Configurar ${indicador?.nome}`}</DialogTitle>
          {!isNew && (
            <p className="text-xs" style={{ color: '#8A9BBC' }}>
              {isOverride ? 'Configuração personalizada' : 'Usando padrão GPI'}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs">Nome</Label>
            <Input value={nome} onChange={e => setNome(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Descrição</Label>
            <Input value={descricao} onChange={e => setDescricao(e.target.value)} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs mb-2 block">Tipo de fonte</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" checked={tipoFonte === 'subgrupo'} onChange={() => setTipoFonte('subgrupo')} />
                Conta do plano (subgrupo)
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" checked={tipoFonte === 'totalizador'} onChange={() => setTipoFonte('totalizador')} />
                Totalizador da DRE
              </label>
            </div>
          </div>

          {tipoFonte === 'subgrupo' && (
            <div>
              <Label className="text-xs">Subgrupos e categorias que compõem este indicador</Label>
              <p style={{ fontSize: 11, color: '#8A9BBC', marginTop: 2 }}>
                Selecione subgrupos inteiros ou categorias individuais
              </p>

              {/* Selected pills */}
              {selectedContaIds.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {selectedContaIds.map(id => {
                    const conta = contas.find(c => c.id === id);
                    const isN1 = conta?.nivel === 1;
                    const parentName = !isN1 && conta?.conta_pai_id ? contas.find(c => c.id === conta.conta_pai_id)?.nome.replace(/^\([+-]\)\s*/, '') : null;
                    const label = isN1
                      ? conta?.nome.replace(/^\([+-]\)\s*/, '') || id
                      : `${parentName || ''} / ${conta?.nome.replace(/^\([+-]\)\s*/, '') || id}`;
                    return (
                      <span key={id} className="inline-flex items-center gap-1 rounded" style={{
                        background: isN1 ? '#1A3CFF0F' : '#0099E60F',
                        color: isN1 ? '#1A3CFF' : '#0099E6',
                        padding: '2px 8px', fontSize: 12
                      }}>
                        {label}
                        <button onClick={() => setSelectedContaIds(prev => prev.filter(x => x !== id))} className="hover:opacity-70"><X className="h-3 w-3" /></button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#8A9BBC', marginTop: 8 }}>Nenhum subgrupo selecionado</p>
              )}

              {/* Hierarchical checkbox list */}
              <div className="mt-2 rounded-lg border overflow-y-auto" style={{ borderColor: '#DDE4F0', maxHeight: 200 }}>
                {Object.entries(contasTree).map(([tipo, items]) => (
                  <div key={tipo}>
                    <div style={{ padding: '6px 10px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: '#8A9BBC', letterSpacing: '0.06em', background: '#F0F4FA', borderBottom: '1px solid #DDE4F0' }}>
                      {TIPO_LABELS[tipo] || tipo}
                    </div>
                    {items.map(({ sub, children }) => {
                      const subSelected = selectedContaIds.includes(sub.id);
                      return (
                        <div key={sub.id}>
                          {/* N1 row */}
                          <label
                            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F6F9FF] transition-colors"
                            style={{
                              borderBottom: '1px solid #F8F9FB',
                              background: subSelected ? '#1A3CFF0F' : undefined,
                            }}
                          >
                            <Checkbox
                              checked={subSelected}
                              onCheckedChange={() => toggleContaId(sub.id)}
                              style={{ borderColor: subSelected ? '#1A3CFF' : undefined }}
                            />
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#0D1B35' }}>{sub.nome.replace(/^\([+-]\)\s*/, '')}</span>
                          </label>
                          {/* N2 children */}
                          {children.map(cat => {
                            const catSelected = selectedContaIds.includes(cat.id);
                            const disabled = subSelected;
                            return (
                              <label
                                key={cat.id}
                                className="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-[#F6F9FF] transition-colors"
                                style={{
                                  paddingLeft: 36,
                                  paddingRight: 12,
                                  borderBottom: '1px solid #FAFBFD',
                                  background: catSelected ? '#0099E60F' : undefined,
                                  opacity: disabled ? 0.45 : 1,
                                  cursor: disabled ? 'not-allowed' : 'pointer',
                                }}
                                title={disabled ? 'Já incluída via subgrupo pai' : undefined}
                              >
                                <Checkbox
                                  checked={catSelected || disabled}
                                  onCheckedChange={() => !disabled && toggleContaId(cat.id)}
                                  disabled={disabled}
                                  style={{ borderColor: catSelected ? '#0099E6' : undefined }}
                                />
                                <span style={{ fontSize: 12, color: '#4A5E80' }}>{cat.nome.replace(/^\([+-]\)\s*/, '')}</span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tipoFonte === 'totalizador' && (
            <div>
              <Label className="text-xs">Totalizador</Label>
              <Select value={totalizadorKey} onValueChange={setTotalizadorKey}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MC">Margem de Contribuição</SelectItem>
                  <SelectItem value="RO">Resultado Operacional</SelectItem>
                  <SelectItem value="RAI">Resultado após Investimentos</SelectItem>
                  <SelectItem value="GC">Geração de Caixa</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="text-xs mb-2 block">Direção</Label>
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" checked={direcao === 'menor_melhor'} onChange={() => setDirecao('menor_melhor')} />
                Menor é melhor
              </label>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="radio" checked={direcao === 'maior_melhor'} onChange={() => setDirecao('maior_melhor')} />
                Maior é melhor
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Limite Verde</Label>
              <div className="relative mt-1">
                <Input type="number" value={limiteVerde} onChange={e => setLimiteVerde(e.target.value)} placeholder="ex: 38" className="pr-8" />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8A9BBC' }}>%</span>
              </div>
            </div>
            <div>
              <Label className="text-xs">Limite Âmbar</Label>
              <div className="relative mt-1">
                <Input type="number" value={limiteAmbar} onChange={e => setLimiteAmbar(e.target.value)} placeholder="ex: 50" className="pr-8" />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs" style={{ color: '#8A9BBC' }}>%</span>
              </div>
            </div>
          </div>

          {hasValid && (
            <div className="flex flex-wrap items-center gap-3" style={{ fontSize: 11 }}>
              <span className="inline-flex items-center gap-1">
                <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#00A86B" /></svg>
                {direcao === 'menor_melhor' ? `< ${verde}%` : `> ${verde}%`}
              </span>
              <span className="inline-flex items-center gap-1">
                <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#D97706" /></svg>
                {direcao === 'menor_melhor' ? `${verde}–${ambar}%` : `${ambar}–${verde}%`}
              </span>
              <span className="inline-flex items-center gap-1">
                <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#DC2626" /></svg>
                {direcao === 'menor_melhor' ? `> ${ambar}%` : `< ${ambar}%`}
              </span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <Switch checked={ativo} onCheckedChange={setAtivo} />
            <Label className="text-xs">Ativo</Label>
          </div>
        </div>

        <DialogFooter>
          <div className="flex w-full items-center justify-between">
            <div>
              {isOverride && (
                <Button variant="outline" size="sm" onClick={() => restoreMutation.mutate()} disabled={restoreMutation.isPending}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Restaurar padrão GPI
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                {isNew ? 'Criar indicador' : 'Salvar para este cliente'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
