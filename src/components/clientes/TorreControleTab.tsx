import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { BookOpen, FileSpreadsheet, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from 'lucide-react';
import { buildDreRows, calcIndicador, getLeafContas, sumLeafByTipo, sumChildrenOfGroup, sumChildrenOfSection } from '@/lib/dre-indicadores';
import { IndicadorDetalhe } from '@/components/clientes/IndicadorDetalhe';

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

function VariacaoBadge({ atual, anterior }: { atual: number | null; anterior: number | null }) {
  if (atual == null || anterior == null || anterior === 0) return null;
  const delta = ((atual - anterior) / Math.abs(anterior)) * 100;
  const positive = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${positive ? 'bg-primary/10 text-primary' : 'bg-red/10 text-red'}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

interface Props {
  clienteId: string;
}

export function TorreControleTab({ clienteId }: Props) {
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const mesAnterior = useMemo(() => {
    if (!competencia) return '';
    const [y, m] = competencia.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  }, [competencia]);

  const { data: contas } = useQuery({
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

  const { data: valoresAnterior } = useQuery({
    queryKey: ['valores-mensais-torre-ant', clienteId, mesAnterior, contas?.length ?? 0],
    enabled: !!clienteId && !!mesAnterior && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map((c) => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, valor_realizado').in('conta_id', contaIds).eq('competencia', mesAnterior);
      return data || [];
    },
  });

  const realizadoMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valores?.forEach((v) => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valores]);

  const metaMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valores?.forEach((v) => { map[v.conta_id] = v.valor_meta; });
    return map;
  }, [valores]);

  const valoresAntMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valoresAnterior?.forEach((v) => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valoresAnterior]);

  const faturamento = useMemo(() => {
    if (!contas) return { real: 0, meta: 0 };
    const leafs = getLeafContas(contas);
    const receitaLeafs = leafs.filter((c) => c.tipo === 'receita');
    let real = 0, meta = 0;
    receitaLeafs.forEach((c) => {
      const r = realizadoMap[c.id];
      if (r != null) real += r;
      const m = metaMap[c.id];
      if (m != null) meta += m;
    });
    return { real, meta };
  }, [contas, realizadoMap, metaMap]);

  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some((v) => v.valor_realizado != null);
  const hasAnterior = valoresAnterior && valoresAnterior.some((v) => v.valor_realizado != null);
  const compLabel = competencias.find((c) => c.value === competencia)?.label || '';

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Build visible rows with hierarchy
  const visibleRows = useMemo(() => {
    if (!contas) return [];
    const rows: DreRowExt[] = [];
    let lastTipo = '';

    for (let i = 0; i < contas.length; i++) {
      const conta = contas[i];

      // Check if parent is collapsed
      if (conta.nivel === 2 && conta.conta_pai_id && collapsed.has(conta.conta_pai_id)) continue;
      if (conta.nivel === 1 && conta.conta_pai_id && collapsed.has(conta.conta_pai_id)) continue;
      if (conta.nivel === 2 && conta.conta_pai_id) {
        // Also check if grandparent (seção) is collapsed
        const parent = contas.find((c) => c.id === conta.conta_pai_id);
        if (parent?.conta_pai_id && collapsed.has(parent.conta_pai_id)) continue;
      }

      // Insert indicator when type changes
      if (lastTipo && lastTipo !== conta.tipo) {
        const { indicadorAfterType } = require('@/lib/dre-indicadores');
        const indicator = indicadorAfterType[lastTipo];
        if (indicator) rows.push({ type: 'indicador', indicador: indicator });
      }

      rows.push({ type: 'conta', conta });
      lastTipo = conta.tipo;
    }

    // Final indicator
    if (lastTipo) {
      const { indicadorAfterType } = require('@/lib/dre-indicadores');
      const indicator = indicadorAfterType[lastTipo];
      if (indicator) rows.push({ type: 'indicador', indicador: indicator });
    }

    return rows;
  }, [contas, collapsed]);

  type DreRowExt = { type: 'conta'; conta: ContaRow } | { type: 'indicador'; indicador: any };

  return (
    <div className="space-y-4">
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
      </div>

      {!hasContas && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <BookOpen className="h-12 w-12 text-txt-muted/40" />
          <p className="text-sm text-txt-sec">Plano de contas não configurado.</p>
        </div>
      )}

      {hasContas && !hasValores && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileSpreadsheet className="h-12 w-12 text-txt-muted/40" />
          <p className="text-sm text-txt-sec">Nenhum valor importado para {compLabel}</p>
        </div>
      )}

      {hasContas && hasValores && (
        <div className="rounded-xl border border-border bg-surface overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="border-b border-border bg-surface-hi text-left text-xs text-txt-muted">
                <th className="p-3">Conta DRE</th>
                <th className="p-3 text-right">Realizado</th>
                <th className="p-3 text-right">A.V.%</th>
                <th className="p-3 text-right">Meta</th>
                <th className="p-3 text-right">Δ vs Meta</th>
                {hasAnterior && (
                  <>
                    <th className="p-3 text-right border-l border-border">Mês anterior</th>
                    <th className="p-3 text-right">Δ vs Ant.</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => {
                if (row.type === 'indicador') {
                  const ind = row.indicador;
                  const realVal = calcIndicador(contas!, realizadoMap, ind.acumula);
                  const metaVal = calcIndicador(contas!, metaMap, ind.acumula);
                  const antVal = hasAnterior ? calcIndicador(contas!, valoresAntMap, ind.acumula) : null;
                  const av = faturamento.real ? ((realVal / faturamento.real) * 100).toFixed(1) : null;

                  return (
                    <tr key={ind.key} className={`border-b-2 border-border border-l-[3px] ${ind.borderColor} bg-primary/5 font-bold`}>
                      <td className="p-3 text-txt">
                        <IndicadorDetalhe indicador={ind} contas={contas!} valoresMap={realizadoMap}>
                          {ind.nome}
                        </IndicadorDetalhe>
                      </td>
                      <td className="p-3 text-right font-mono text-xs">
                        <span className={realVal >= 0 ? 'text-green' : 'text-destructive'}>{formatCurrency(realVal)}</span>
                      </td>
                      <td className="p-3 text-right text-xs text-txt-sec">{av ? `${av}%` : '—'}</td>
                      <td className="p-3 text-right font-mono text-xs text-txt-sec">
                        {metaVal !== 0 ? formatCurrency(metaVal) : '—'}
                      </td>
                      <td className="p-3 text-right">
                        <DeltaBadge realizado={realVal} meta={metaVal !== 0 ? metaVal : null} />
                      </td>
                      {hasAnterior && (
                        <>
                          <td className="p-3 text-right font-mono text-xs text-txt-sec border-l border-border/50">
                            {antVal != null ? formatCurrency(antVal) : '—'}
                          </td>
                          <td className="p-3 text-right">
                            <VariacaoBadge atual={realVal} anterior={antVal} />
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }

                const conta = row.conta;
                const isSecao = conta.nivel === 0;
                const isGrupo = conta.nivel === 1;
                const isConta = conta.nivel === 2;

                // Calculate totals for sections and groups
                let displayReal: number | null = null;
                let displayMeta: number | null = null;
                let displayAnt: number | null = null;

                if (isConta) {
                  displayReal = realizadoMap[conta.id] ?? null;
                  displayMeta = metaMap[conta.id] ?? null;
                  displayAnt = valoresAntMap[conta.id] ?? null;
                } else if (isGrupo) {
                  displayReal = sumChildrenOfGroup(contas!, realizadoMap, conta.id);
                  displayMeta = sumChildrenOfGroup(contas!, metaMap, conta.id);
                  displayAnt = hasAnterior ? sumChildrenOfGroup(contas!, valoresAntMap, conta.id) : null;
                } else if (isSecao) {
                  displayReal = sumChildrenOfSection(contas!, realizadoMap, conta.id);
                  displayMeta = sumChildrenOfSection(contas!, metaMap, conta.id);
                  displayAnt = hasAnterior ? sumChildrenOfSection(contas!, valoresAntMap, conta.id) : null;
                }

                const av = displayReal != null && faturamento.real ? ((displayReal / faturamento.real) * 100).toFixed(1) : null;
                const borderColor = tipoBorderColors[conta.tipo] || 'border-l-transparent';
                const hasChildren = contas!.some((c) => c.conta_pai_id === conta.id);
                const isCollapsed = collapsed.has(conta.id);

                return (
                  <tr
                    key={conta.id}
                    className={`border-b border-border/50 border-l-[3px] ${borderColor} ${
                      isSecao ? 'bg-muted font-bold uppercase text-xs' :
                      isGrupo ? 'bg-muted/50 font-semibold' : ''
                    }`}
                  >
                    <td
                      className="p-3 text-txt"
                      style={{ paddingLeft: `${12 + conta.nivel * 20}px` }}
                    >
                      <div className="flex items-center gap-1.5">
                        {hasChildren && (isSecao || isGrupo) && (
                          <button onClick={() => toggleCollapse(conta.id)} className="p-0.5 rounded hover:bg-surface-hi">
                            {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {conta.nome}
                      </div>
                    </td>
                    <td className="p-3 text-right font-mono text-txt text-xs">
                      {displayReal != null ? formatCurrency(displayReal) : '—'}
                    </td>
                    <td className="p-3 text-right text-xs text-txt-sec">{av ? `${av}%` : '—'}</td>
                    <td className="p-3 text-right font-mono text-txt-sec text-xs">
                      {displayMeta != null ? formatCurrency(displayMeta) : '—'}
                    </td>
                    <td className="p-3 text-right"><DeltaBadge realizado={displayReal} meta={displayMeta} /></td>
                    {hasAnterior && (
                      <>
                        <td className="p-3 text-right font-mono text-txt-sec text-xs border-l border-border/50">
                          {displayAnt != null ? formatCurrency(displayAnt) : '—'}
                        </td>
                        <td className="p-3 text-right"><VariacaoBadge atual={displayReal} anterior={displayAnt} /></td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
