import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet } from 'lucide-react';
import { buildDreRows, calcIndicador } from '@/lib/dre-indicadores';

const tipoBorderColors: Record<string, string> = {
  receita: 'border-l-primary',
  custo_variavel: 'border-l-red',
  despesa_fixa: 'border-l-amber',
  investimento: 'border-l-[#9333EA]',
  financeiro: 'border-l-txt-muted',
};

function getYearOptions() {
  const now = new Date();
  const years: string[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) {
    years.push(String(y));
  }
  return years;
}

function getMonthsForYear(year: string) {
  const months: { value: string; label: string; shortLabel: string }[] = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(Number(year), m, 1);
    months.push({
      value: `${year}-${String(m + 1).padStart(2, '0')}-01`,
      label: d.toLocaleDateString('pt-BR', { month: 'long' }),
      shortLabel: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(),
    });
  }
  return months;
}

interface Props {
  clienteId: string;
}

export function DreAnualTab({ clienteId }: Props) {
  const years = getYearOptions();
  const [ano, setAno] = useState(years[0]);
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null);
  const months = getMonthsForYear(ano);

  const { data: contas } = useQuery({
    queryKey: ['plano-contas-dre', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const competencias = months.map((m) => m.value);

  const { data: valoresAnuais } = useQuery({
    queryKey: ['valores-mensais-dre', clienteId, ano, contas?.length ?? 0],
    enabled: !!clienteId && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map((c) => c.id);
      const { data } = await supabase
        .from('valores_mensais')
        .select('conta_id, competencia, valor_realizado')
        .in('conta_id', contaIds)
        .in('competencia', competencias);
      return data || [];
    },
  });

  // Map: conta_id -> competencia -> valor_realizado
  const valoresMap = useMemo(() => {
    const map: Record<string, Record<string, number | null>> = {};
    valoresAnuais?.forEach((v) => {
      if (!map[v.conta_id]) map[v.conta_id] = {};
      map[v.conta_id][v.competencia] = v.valor_realizado;
    });
    return map;
  }, [valoresAnuais]);

  const mesesComDados = useMemo(() => {
    const set = new Set<string>();
    valoresAnuais?.forEach((v) => {
      if (v.valor_realizado != null) set.add(v.competencia);
    });
    return months.filter((m) => set.has(m.value));
  }, [valoresAnuais, months]);

  const hasContas = contas && contas.length > 0;
  const hasData = mesesComDados.length > 0;

  const displayMonths = mesSelecionado
    ? months.filter((m) => m.value === mesSelecionado)
    : mesesComDados;

  const dreRows = useMemo(() => (contas ? buildDreRows(contas) : []), [contas]);

  // Helper: get flat values map for a specific month (conta_id -> value)
  const getMonthValuesMap = (comp: string): Record<string, number | null> => {
    const map: Record<string, number | null> = {};
    contas?.forEach((c) => {
      map[c.id] = valoresMap[c.id]?.[comp] ?? null;
    });
    return map;
  };

  // Faturamento per month for AV%
  const faturamentoPorMes = useMemo(() => {
    const map: Record<string, number> = {};
    if (!contas) return map;
    const receitaContas = contas.filter((c) => c.tipo === 'receita');
    for (const m of displayMonths) {
      let total = 0;
      receitaContas.forEach((c) => {
        const val = valoresMap[c.id]?.[m.value];
        if (val != null) total += val;
      });
      map[m.value] = total;
    }
    return map;
  }, [contas, valoresMap, displayMonths]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Ano</label>
          <Select value={ano} onValueChange={(v) => { setAno(v); setMesSelecionado(null); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Filtrar mês</label>
          <Select value={mesSelecionado || 'todos'} onValueChange={(v) => setMesSelecionado(v === 'todos' ? null : v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os meses</SelectItem>
              {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {!hasContas && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <BookOpen className="h-12 w-12 text-txt-muted/40" />
          <p className="text-sm text-txt-sec">Plano de contas não configurado. Vá até a aba Importação para configurar.</p>
        </div>
      )}

      {hasContas && !hasData && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileSpreadsheet className="h-12 w-12 text-txt-muted/40" />
          <p className="text-sm text-txt-sec">Nenhum valor importado para {ano}. Importe planilhas na aba Importação.</p>
        </div>
      )}

      {hasContas && hasData && (
        <div className="rounded-xl border border-border bg-surface overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="border-b border-border bg-surface-hi text-left text-xs text-txt-muted">
                <th className="p-3 sticky left-0 bg-surface-hi z-10 min-w-[200px]">Conta DRE</th>
                {displayMonths.map((m) => (
                  <th key={m.value} className="p-3 text-right min-w-[110px]">{m.shortLabel}</th>
                ))}
                {displayMonths.length > 1 && (
                  <th className="p-3 text-right min-w-[110px] font-bold">ACUMULADO</th>
                )}
              </tr>
            </thead>
            <tbody>
              {dreRows.map((row, idx) => {
                if (row.type === 'indicador') {
                  const ind = row.indicador;
                  let acumuladoTotal = 0;
                  return (
                    <tr key={ind.key} className={`border-b-2 border-border border-l-[3px] ${ind.borderColor} bg-primary/5 font-bold`}>
                      <td className="p-3 text-txt sticky left-0 bg-primary/5 z-10">{ind.nome}</td>
                      {displayMonths.map((m) => {
                        const monthMap = getMonthValuesMap(m.value);
                        const val = calcIndicador(contas!, monthMap, ind.acumula);
                        acumuladoTotal += val;
                        const fat = faturamentoPorMes[m.value] || 0;
                        return (
                          <td key={m.value} className="p-3 text-right font-mono text-xs">
                            <span className={val >= 0 ? 'text-green' : 'text-destructive'}>{formatCurrency(val)}</span>
                            {fat !== 0 && (
                              <span className="block text-[10px] text-txt-muted">{((val / fat) * 100).toFixed(1)}%</span>
                            )}
                          </td>
                        );
                      })}
                      {displayMonths.length > 1 && (
                        <td className="p-3 text-right font-mono text-xs font-bold">
                          <span className={acumuladoTotal >= 0 ? 'text-green' : 'text-destructive'}>{formatCurrency(acumuladoTotal)}</span>
                        </td>
                      )}
                    </tr>
                  );
                }

                const conta = row.conta;
                const isHighlight = conta.is_total || conta.nivel === 1;
                const borderColor = tipoBorderColors[conta.tipo] || 'border-l-transparent';
                let acumulado = 0;

                return (
                  <tr key={conta.id} className={`border-b border-border/50 border-l-[3px] ${borderColor} ${isHighlight ? 'bg-muted/50 font-semibold' : ''}`}>
                    <td className="p-3 text-txt sticky left-0 bg-inherit z-10" style={{ paddingLeft: `${12 + conta.nivel * 16}px` }}>
                      {conta.nome}
                    </td>
                    {displayMonths.map((m) => {
                      const val = valoresMap[conta.id]?.[m.value] ?? null;
                      if (val != null) acumulado += val;
                      return (
                        <td key={m.value} className="p-3 text-right font-mono text-txt text-xs">
                          {val != null ? formatCurrency(val) : '—'}
                        </td>
                      );
                    })}
                    {displayMonths.length > 1 && (
                      <td className="p-3 text-right font-mono text-txt text-xs font-bold">
                        {acumulado !== 0 ? formatCurrency(acumulado) : '—'}
                      </td>
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
