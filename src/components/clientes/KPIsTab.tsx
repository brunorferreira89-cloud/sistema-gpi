import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ArcGauge } from '@/components/ui/arc-gauge';
import { SparkLine } from '@/components/ui/spark-line';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ChevronDown, Pencil, RotateCcw, Trash2, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas, sumLeafByTipo } from '@/lib/dre-indicadores';
import {
  fetchMergedIndicadores,
  calcularIndicadores,
  calcScore,
  getLast6Months,
  getFormula,
  type KpiIndicador,
  type IndicadorCalculado,
} from '@/lib/kpi-indicadores-utils';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, arrayMove, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function getLast12Months() {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      value: d.toISOString().split('T')[0],
      label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    });
  }
  return months;
}

/* fmtCurrency is defined after SortableKpiCard below */

const STATUS_CONFIG = {
  verde: { bg: '#00A86B1A', color: '#00A86B', label: '✓ No esperado' },
  ambar: { bg: '#D977061A', color: '#D97706', label: '⚠ Atenção' },
  vermelho: { bg: '#DC26261A', color: '#DC2626', label: '✗ Crítico' },
};

interface Props { clienteId: string; }

function SortableKpiCard({ item, cfg, spark, isActive, onClick }: {
  item: IndicadorCalculado;
  cfg: { bg: string; color: string; label: string };
  spark: number[];
  isActive: boolean;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: item.indicador.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isActive ? 0.4 : 1,
    borderColor: '#DDE4F0',
    background: '#FFFFFF',
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}
      className="rounded-xl border p-5 transition-all hover:shadow-md relative group"
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.borderColor = '#1A3CFF'; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDE4F0'; }}
    >
      {/* Drag handle */}
      <div
        {...listeners}
        className="absolute left-1.5 top-1/2 -translate-y-1/2 p-1 rounded cursor-grab opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: 'rgba(26,60,255,0.06)' }}
        onClick={e => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" style={{ color: '#8A9BBC' }} />
      </div>

      {/* Card content - clickable */}
      <div onClick={onClick} className="cursor-pointer">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[13px] font-semibold" style={{ color: '#0D1B35' }}>{item.indicador.nome}</span>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>
            {cfg.label}
          </span>
        </div>
        <div className="flex items-center justify-center my-2">
          <ArcGauge
            value={item.pct ?? 0}
            benchmark={item.indicador.limite_verde}
            color={cfg.color}
            label=""
            size={120}
          />
        </div>
        <div className="flex items-center justify-between mt-3">
          <div>
            <span className="text-xs" style={{ color: '#4A5E80' }}>{fmtCurrency(Math.abs(item.valor ?? 0))}</span>
            <span className="text-[11px] ml-1" style={{ color: '#8A9BBC' }}>/ {fmtCurrency(item.faturamento)} fat.</span>
          </div>
          <SparkLine data={spark} color={cfg.color} width={50} height={18} />
        </div>
      </div>
    </div>
  );
}

const fmtCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

export function KPIsTab({ clienteId }: Props) {
  currentMonth.setDate(1);
  const [competencia, setCompetencia] = useState(currentMonth.toISOString().split('T')[0]);
  const months = getLast12Months();
  const queryClient = useQueryClient();

  const [drawerItem, setDrawerItem] = useState<IndicadorCalculado | null>(null);
  const [editItem, setEditItem] = useState<KpiIndicador | null>(null);
  const [showDisabled, setShowDisabled] = useState(false);

  // Fetch indicadores
  const { data: indicadores } = useQuery({
    queryKey: ['kpi-indicadores', clienteId],
    queryFn: () => fetchMergedIndicadores(clienteId),
    enabled: !!clienteId,
  });

  // Fetch contas
  const { data: contas } = useQuery({
    queryKey: ['plano-contas-kpis', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  // Fetch valores for selected month
  const { data: valoresData } = useQuery({
    queryKey: ['valores-kpis', clienteId, competencia],
    enabled: !!clienteId && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map(c => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, valor_realizado').in('conta_id', contaIds).eq('competencia', competencia);
      return data || [];
    },
  });

  // Fetch spark history (6 months)
  const sparkMonths = useMemo(() => getLast6Months(competencia), [competencia]);
  const { data: sparkData } = useQuery({
    queryKey: ['valores-spark-kpis', clienteId, competencia],
    enabled: !!clienteId && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map(c => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, competencia, valor_realizado').in('conta_id', contaIds).in('competencia', sparkMonths);
      return data || [];
    },
  });

  const valoresMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valoresData?.forEach(v => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valoresData]);

  const calculados = useMemo(() => {
    if (!indicadores || !contas) return [];
    return calcularIndicadores(indicadores, contas, valoresMap);
  }, [indicadores, contas, valoresMap]);

  const ativos = calculados.filter(c => c.indicador.ativo);
  const [ativosOrdered, setAtivosOrdered] = useState<IndicadorCalculado[]>([]);

  // Keep ativosOrdered in sync with calculated data
  useMemo(() => {
    if (ativos.length > 0) {
      setAtivosOrdered(ativos);
    }
  }, [JSON.stringify(ativos.map(a => a.indicador.id + a.pct))]);

  const displayAtivos = ativosOrdered.length > 0 ? ativosOrdered : ativos;

  const inativos = useMemo(() => {
    if (!indicadores) return [];
    return indicadores.filter(i => !i.ativo);
  }, [indicadores]);

  const score = calcScore(displayAtivos);
  const verdeCount = displayAtivos.filter(c => c.status === 'verde').length;

  // Spark history per indicator
  const sparkHistories = useMemo(() => {
    if (!sparkData || !contas || !indicadores) return new Map<string, number[]>();
    const map = new Map<string, number[]>();
    for (const ind of indicadores.filter(i => i.ativo)) {
      const history = sparkMonths.map(m => {
        const monthMap: Record<string, number | null> = {};
        sparkData.filter(v => v.competencia === m).forEach(v => { monthMap[v.conta_id] = v.valor_realizado; });
        const results = calcularIndicadores([ind], contas, monthMap);
        return results[0]?.pct ?? 0;
      });
      map.set(ind.id, history);
    }
    return map;
  }, [sparkData, contas, indicadores, sparkMonths]);

  const scoreColor = score >= 75 ? '#00A86B' : score >= 40 ? '#D97706' : '#DC2626';

  // --- Drag-and-drop ---
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } })
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = displayAtivos.findIndex(i => i.indicador.id === active.id);
    const newIndex = displayAtivos.findIndex(i => i.indicador.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(displayAtivos, oldIndex, newIndex);
    setAtivosOrdered(reordered);

    // Persist new ordem
    const updates = reordered.map((item, i) => 
      supabase.from('kpi_indicadores' as any).update({ ordem: i }).eq('id', item.indicador.id)
    );
    await Promise.all(updates);
    queryClient.invalidateQueries({ queryKey: ['kpi-indicadores', clienteId] });
  }, [displayAtivos, clienteId, queryClient]);

  const activeItem = activeId ? displayAtivos.find(i => i.indicador.id === activeId) : null;

  // Reactivate mutation
  const reactivateMutation = useMutation({
    mutationFn: async (ind: KpiIndicador) => {
      if (ind.cliente_id) {
        await supabase.from('kpi_indicadores' as any).update({ ativo: true }).eq('id', ind.id);
      } else {
        await supabase.from('kpi_indicadores' as any).insert({
          cliente_id: clienteId, nome: ind.nome, descricao: ind.descricao,
          tipo_fonte: ind.tipo_fonte, conta_id: ind.conta_id, totalizador_key: ind.totalizador_key,
          limite_verde: ind.limite_verde, limite_ambar: ind.limite_ambar, direcao: ind.direcao,
          ativo: true, ordem: ind.ordem,
          conta_ids: (ind as any).conta_ids || [],
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kpi-indicadores', clienteId] });
      toast.success('Indicador reativado');
    },
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <Select value={competencia} onValueChange={setCompetencia}>
          <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
          <SelectContent>
            {months.map(m => <SelectItem key={m.value} value={m.value} className="capitalize">{m.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Score Card */}
      <div className="flex flex-col items-center justify-center rounded-xl border p-8" style={{ borderColor: '#DDE4F0', background: '#FFFFFF' }}>
        <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
          <svg width="140" height="140" viewBox="0 0 140 140">
            <circle cx="70" cy="70" r="60" fill="none" stroke="#F0F4FA" strokeWidth="10" />
            <circle
              cx="70" cy="70" r="60" fill="none"
              stroke={scoreColor} strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={`${(score / 100) * 377} 377`}
              transform="rotate(-90 70 70)"
              style={{ transition: 'stroke-dasharray 0.8s ease' }}
            />
          </svg>
          <span className="absolute font-extrabold" style={{ fontSize: 48, color: scoreColor, lineHeight: 1 }}>{score}</span>
        </div>
        <p className="mt-3 text-sm font-medium" style={{ color: '#4A5E80' }}>Saúde Financeira</p>
        <p className="text-xs" style={{ color: '#8A9BBC' }}>{verdeCount} de {displayAtivos.length} indicadores no verde</p>
      </div>

      {/* Grid Cards with DnD */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <SortableContext items={displayAtivos.map(i => i.indicador.id)} strategy={rectSortingStrategy}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {displayAtivos.map(item => {
              const cfg = STATUS_CONFIG[item.status];
              const spark = sparkHistories.get(item.indicador.id) || [];
              return (
                <SortableKpiCard
                  key={item.indicador.id}
                  item={item}
                  cfg={cfg}
                  spark={spark}
                  isActive={activeId === item.indicador.id}
                  onClick={() => setDrawerItem(item)}
                />
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay>
          {activeItem ? (
            <div className="rounded-xl border p-5" style={{ borderColor: '#1A3CFF', background: '#FFFFFF', boxShadow: '0 8px 32px rgba(26,60,255,0.18)', opacity: 0.9 }}>
              <span className="text-[13px] font-semibold" style={{ color: '#0D1B35' }}>{activeItem.indicador.nome}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Disabled indicators */}
      {inativos.length > 0 && (
        <div>
          <button
            onClick={() => setShowDisabled(v => !v)}
            className="flex items-center gap-1.5 text-xs font-medium"
            style={{ color: '#8A9BBC' }}
          >
            <ChevronDown className="h-3.5 w-3.5" style={{ transform: showDisabled ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s' }} />
            Indicadores desativados ({inativos.length})
          </button>
          {showDisabled && (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 mt-3">
              {inativos.map(ind => (
                <div key={ind.id} className="rounded-xl border p-4" style={{ borderColor: '#DDE4F0', background: '#F8F9FB', opacity: 0.7 }}>
                  <span className="text-[13px] font-medium" style={{ color: '#8A9BBC' }}>{ind.nome}</span>
                  <div className="mt-2">
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => reactivateMutation.mutate(ind)}>
                      Reativar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drawer */}
      <Sheet open={!!drawerItem} onOpenChange={open => { if (!open) setDrawerItem(null); }}>
        <SheetContent className="w-[420px] overflow-y-auto">
          {drawerItem && (
            <DrawerContent
              item={drawerItem}
              sparkData={sparkHistories.get(drawerItem.indicador.id) || []}
              sparkMonths={sparkMonths}
              onEdit={() => { setEditItem(drawerItem.indicador); setDrawerItem(null); }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Edit Modal */}
      {editItem && (
        <EditIndicadorModal
          indicador={editItem}
          clienteId={clienteId}
          contas={contas || []}
          onClose={() => setEditItem(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['kpi-indicadores', clienteId] });
            setEditItem(null);
          }}
        />
      )}
    </div>
  );
}

// --- Drawer Content ---
function DrawerContent({ item, sparkData, sparkMonths, onEdit }: {
  item: IndicadorCalculado;
  sparkData: number[];
  sparkMonths: string[];
  onEdit: () => void;
}) {
  const cfg = STATUS_CONFIG[item.status];
  const formula = getFormula(item.indicador);
  const formulaValues = item.pct != null
    ? `${item.indicador.nome} = ${fmtCurrency(Math.abs(item.valor ?? 0))} / ${fmtCurrency(item.faturamento)} × 100 = ${item.pct.toFixed(1)}%`
    : '';

  return (
    <div className="space-y-5 pt-2">
      <SheetHeader className="p-0">
        <div className="flex items-center justify-between">
          <SheetTitle className="text-base">{item.indicador.nome}</SheetTitle>
          <button onClick={onEdit} className="p-1.5 rounded-md hover:bg-muted" title="Editar indicador">
            <Pencil className="h-4 w-4" style={{ color: '#4A5E80' }} />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
          <span className="text-xs" style={{ color: '#8A9BBC' }}>{item.pontos} pts</span>
        </div>
      </SheetHeader>

      {/* Formula */}
      <div className="rounded-lg p-4" style={{ background: '#F0F4FA' }}>
        <p className="text-xs font-mono" style={{ color: '#4A5E80' }}>{formula}</p>
        {formulaValues && <p className="text-xs font-mono mt-1" style={{ color: '#0D1B35' }}>{formulaValues}</p>}
      </div>

      {/* Composição */}
      <div>
        <p className="text-[11px] uppercase font-semibold tracking-wider mb-2" style={{ color: '#8A9BBC' }}>Composição</p>
        <div className="rounded-lg border" style={{ borderColor: '#DDE4F0' }}>
          <table className="w-full text-xs">
            <thead>
              <tr style={{ background: '#F0F4FA', borderBottom: '1px solid #DDE4F0' }}>
                <th className="text-left p-2 font-medium" style={{ color: '#4A5E80' }}>Conta</th>
                <th className="text-right p-2 font-medium" style={{ color: '#4A5E80' }}>Valor</th>
                <th className="text-right p-2 font-medium" style={{ color: '#4A5E80' }}>% Fat.</th>
              </tr>
            </thead>
            <tbody>
              {item.detalhe.map((d, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #F0F4FA' }}>
                  <td className="p-2" style={{ color: '#0D1B35' }}>{d.nome}</td>
                  <td className="p-2 text-right font-mono" style={{ color: '#0D1B35' }}>{fmtCurrency(Math.abs(d.valor))}</td>
                  <td className="p-2 text-right font-mono" style={{ color: '#8A9BBC' }}>{d.pct.toFixed(1)}%</td>
                </tr>
              ))}
              <tr style={{ background: '#F0F4FA' }}>
                <td className="p-2 font-semibold" style={{ color: '#0D1B35' }}>Total</td>
                <td className="p-2 text-right font-mono font-semibold" style={{ color: '#0D1B35' }}>{fmtCurrency(Math.abs(item.valor ?? 0))}</td>
                <td className="p-2 text-right font-mono font-semibold" style={{ color: '#0D1B35' }}>{item.pct?.toFixed(1)}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Benchmarks */}
      <div>
        <p className="text-[11px] uppercase font-semibold tracking-wider mb-2" style={{ color: '#8A9BBC' }}>Benchmarks</p>
        <div className="flex gap-2">
          {[
            { label: item.indicador.direcao === 'menor_melhor' ? `< ${item.indicador.limite_verde}%` : `> ${item.indicador.limite_verde}%`, color: '#00A86B', active: item.status === 'verde' },
            { label: item.indicador.direcao === 'menor_melhor' ? `${item.indicador.limite_verde}–${item.indicador.limite_ambar}%` : `${item.indicador.limite_ambar}–${item.indicador.limite_verde}%`, color: '#D97706', active: item.status === 'ambar' },
            { label: item.indicador.direcao === 'menor_melhor' ? `> ${item.indicador.limite_ambar}%` : `< ${item.indicador.limite_ambar}%`, color: '#DC2626', active: item.status === 'vermelho' },
          ].map((b, i) => (
            <div key={i} className="flex-1 rounded-lg p-2 text-center" style={{
              border: b.active ? `2px solid ${b.color}` : '1px solid #DDE4F0',
              background: b.active ? `${b.color}11` : '#FFFFFF',
            }}>
              <svg width="8" height="8" className="mx-auto mb-1"><circle cx="4" cy="4" r="4" fill={b.color} /></svg>
              <span className="text-[10px] font-mono" style={{ color: b.color }}>{b.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Histórico */}
      <div>
        <p className="text-[11px] uppercase font-semibold tracking-wider mb-2" style={{ color: '#8A9BBC' }}>Histórico (6 meses)</p>
        <SparkLine data={sparkData} color={cfg.color} width={340} height={40} />
        <div className="mt-2 space-y-1">
          {sparkMonths.map((m, i) => {
            const val = sparkData[i];
            const mLabel = new Date(m + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
            const dotColor = val != null
              ? (item.indicador.direcao === 'menor_melhor'
                ? (val < item.indicador.limite_verde ? '#00A86B' : val < item.indicador.limite_ambar ? '#D97706' : '#DC2626')
                : (val > item.indicador.limite_verde ? '#00A86B' : val > item.indicador.limite_ambar ? '#D97706' : '#DC2626'))
              : '#C4CFEA';
            return (
              <div key={m} className="flex items-center justify-between text-[11px]">
                <span style={{ color: '#4A5E80' }}>{mLabel}</span>
                <span className="font-mono" style={{ color: '#0D1B35' }}>{val?.toFixed(1) ?? '—'}%</span>
                <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill={dotColor} /></svg>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// --- Edit Modal ---
function EditIndicadorModal({ indicador, clienteId, contas, onClose, onSaved }: {
  indicador: KpiIndicador;
  clienteId: string;
  contas: ContaRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isOverride = indicador.cliente_id === clienteId;

  const [nome, setNome] = useState(indicador.nome);
  const [descricao, setDescricao] = useState(indicador.descricao || '');
  const [tipoFonte, setTipoFonte] = useState(indicador.tipo_fonte);
  const [selectedContaIds, setSelectedContaIds] = useState<string[]>(() => {
    const ids = (indicador as any)?.conta_ids;
    if (ids && Array.isArray(ids) && ids.length > 0) return ids;
    if (indicador?.conta_id) return [indicador.conta_id];
    return [];
  });
  const [totalizadorKey, setTotalizadorKey] = useState(indicador.totalizador_key || 'MC');
  const [direcao, setDirecao] = useState(indicador.direcao);
  const [limiteVerde, setLimiteVerde] = useState(String(indicador.limite_verde));
  const [limiteAmbar, setLimiteAmbar] = useState(String(indicador.limite_ambar));
  const [ativo, setAtivo] = useState(indicador.ativo);

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

  const TIPO_LABELS: Record<string, string> = {
    custo_variavel: 'CUSTOS VARIÁVEIS',
    despesa_fixa: 'DESPESAS FIXAS',
    investimento: 'INVESTIMENTOS',
    financeiro: 'FINANCEIRO',
  };

  const verde = Number(limiteVerde);
  const ambar = Number(limiteAmbar);
  const hasValid = !isNaN(verde) && !isNaN(ambar) && limiteVerde !== '' && limiteAmbar !== '';

  const toggleContaId = (id: string) => {
    const conta = contas.find(c => c.id === id);
    if (!conta) return;

    if (conta.nivel === 1) {
      if (selectedContaIds.includes(id)) {
        setSelectedContaIds(prev => prev.filter(x => x !== id));
        return;
      }
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
      if (conta.conta_pai_id && selectedContaIds.includes(conta.conta_pai_id)) {
        toast.error(`O subgrupo pai já está selecionado. Remova-o antes de selecionar categorias individuais.`);
        return;
      }
      setSelectedContaIds(prev => [...prev, id]);
    }
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: any = {
        cliente_id: clienteId,
        nome,
        descricao: descricao || null,
        tipo_fonte: tipoFonte,
        conta_id: tipoFonte === 'subgrupo' && selectedContaIds.length > 0 ? selectedContaIds[0] : null,
        conta_ids: tipoFonte === 'subgrupo' ? selectedContaIds : [],
        totalizador_key: tipoFonte === 'totalizador' ? totalizadorKey : null,
        limite_verde: verde,
        limite_ambar: ambar,
        direcao,
        ativo,
        ordem: indicador.ordem,
      };
      if (isOverride) {
        const { error } = await supabase.from('kpi_indicadores' as any).update(payload).eq('id', indicador.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('kpi_indicadores' as any).insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success('Indicador salvo'); onSaved(); },
    onError: () => toast.error('Erro ao salvar'),
  });

  const restoreMutation = useMutation({
    mutationFn: async () => {
      if (isOverride) {
        await supabase.from('kpi_indicadores' as any).delete().eq('id', indicador.id);
      }
    },
    onSuccess: () => { toast.success('Restaurado para padrão GPI'); onSaved(); },
    onError: () => toast.error('Erro ao restaurar'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (isOverride) {
        const { error } = await supabase.from('kpi_indicadores' as any).delete().eq('id', indicador.id);
        if (error) throw error;
      }
    },
    onSuccess: () => { toast.success('Indicador apagado'); onSaved(); },
    onError: () => toast.error('Erro ao apagar indicador'),
  });

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent style={{ minWidth: 520, maxWidth: 580 }} className="w-[95vw] sm:w-auto">
        <DialogHeader>
          <DialogTitle>Configurar {indicador.nome}</DialogTitle>
          <p className="text-xs" style={{ color: '#8A9BBC' }}>
            {isOverride ? 'Este cliente usa configuração personalizada' : 'Este cliente usa o padrão GPI'}
          </p>
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
                        padding: '2px 8px', fontSize: 12,
                      }}>
                        {label}
                        <button onClick={() => setSelectedContaIds(prev => prev.filter(x => x !== id))} className="hover:opacity-70">
                          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.5" /></svg>
                        </button>
                      </span>
                    );
                  })}
                </div>
              ) : (
                <p style={{ fontSize: 12, color: '#8A9BBC', marginTop: 8 }}>Nenhum subgrupo selecionado</p>
              )}

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
                          <label
                            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[#F6F9FF] transition-colors"
                            style={{
                              borderBottom: '1px solid #F8F9FB',
                              background: subSelected ? '#1A3CFF0F' : undefined,
                            }}
                          >
                            <input type="checkbox" checked={subSelected} onChange={() => toggleContaId(sub.id)} className="accent-[#1A3CFF]" />
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#0D1B35' }}>{sub.nome.replace(/^\([+-]\)\s*/, '')}</span>
                          </label>
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
                                <input type="checkbox" checked={catSelected || disabled} onChange={() => !disabled && toggleContaId(cat.id)} disabled={disabled} className="accent-[#0099E6]" />
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
            <div className="flex gap-2">
              {isOverride && (
                <Button variant="outline" size="sm" onClick={() => restoreMutation.mutate()} disabled={restoreMutation.isPending}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  Restaurar padrão GPI
                </Button>
              )}
              {isOverride && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => {
                    if (window.confirm('Tem certeza que deseja apagar este indicador? Esta ação não pode ser desfeita.')) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Apagar
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Cancelar</Button>
              <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                Salvar para este cliente
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
