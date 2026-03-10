import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { BookOpen, FileSpreadsheet, TrendingUp, TrendingDown } from 'lucide-react';
import { buildDreRows, calcIndicador } from '@/lib/dre-indicadores';

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

  const valoresMap = useMemo(() => {
    const map: Record<string, { valor_realizado: number | null; valor_meta: number | null }> = {};
    valores?.forEach((v) => { map[v.conta_id] = { valor_realizado: v.valor_realizado, valor_meta: v.valor_meta }; });
    return map;
  }, [valores]);

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
    const receitaContas = contas.filter((c) => c.tipo === 'receita');
    let real = 0, meta = 0;
    receitaContas.forEach((c) => {
      const v = valoresMap[c.id];
      if (v?.valor_realizado) real += v.valor_realizado;
      if (v?.valor_meta) meta += v.valor_meta;
    });
    return { real, meta };
  }, [contas, valoresMap]);

  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some((v) => v.valor_realizado != null);
  const hasAnterior = valoresAnterior && valoresAnterior.some((v) => v.valor_realizado != null);
  const compLabel = competencias.find((c) => c.value === competencia)?.label || '';

  const dreRows = useMemo(() => (contas ? buildDreRows(contas) : []), [contas]);

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
              {dreRows.map((row) => {
                if (row.type === 'indicador') {
                  const ind = row.indicador;
                  const realVal = calcIndicador(contas!, realizadoMap, ind.acumula);
                  const metaVal = calcIndicador(contas!, metaMap, ind.acumula);
                  const antVal = hasAnterior ? calcIndicador(contas!, valoresAntMap, ind.acumula) : null;
                  const av = faturamento.real ? ((realVal / faturamento.real) * 100).toFixed(1) : null;

                  return (
                    <tr key={ind.key} className={`border-b-2 border-border border-l-[3px] ${ind.borderColor} bg-primary/5 font-bold`}>
                      <td className="p-3 text-txt">{ind.nome}</td>
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
                const v = valoresMap[conta.id];
                const real = v?.valor_realizado;
                const meta = v?.valor_meta;
                const ant = valoresAntMap[conta.id];
                const av = real != null && faturamento.real ? ((real / faturamento.real) * 100).toFixed(1) : null;
                const isHighlight = conta.is_total || conta.nivel === 1;
                const borderColor = tipoBorderColors[conta.tipo] || 'border-l-transparent';

                return (
                  <tr key={conta.id} className={`border-b border-border/50 border-l-[3px] ${borderColor} ${isHighlight ? 'bg-muted/50 font-semibold' : ''}`}>
                    <td className="p-3 text-txt" style={{ paddingLeft: `${12 + conta.nivel * 20}px` }}>{conta.nome}</td>
                    <td className="p-3 text-right font-mono text-txt text-xs">{real != null ? formatCurrency(real) : '—'}</td>
                    <td className="p-3 text-right text-xs text-txt-sec">{av ? `${av}%` : '—'}</td>
                    <td className="p-3 text-right font-mono text-txt-sec text-xs">{meta != null ? formatCurrency(meta) : '—'}</td>
                    <td className="p-3 text-right"><DeltaBadge realizado={real} meta={meta} /></td>
                    {hasAnterior && (
                      <>
                        <td className="p-3 text-right font-mono text-txt-sec text-xs border-l border-border/50">{ant != null ? formatCurrency(ant) : '—'}</td>
                        <td className="p-3 text-right"><VariacaoBadge atual={real} anterior={ant} /></td>
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
