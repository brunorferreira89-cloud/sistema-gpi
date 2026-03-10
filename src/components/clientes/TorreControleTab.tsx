import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { BookOpen, FileSpreadsheet, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';
import { calcIndicador, getLeafContas, sumChildrenOfGroup, sumChildrenOfSection, indicadorAfterType, type IndicadorDRE } from '@/lib/dre-indicadores';

const competencias = getCompetenciaOptions();

// --- Format helpers (same as DRE) ---
function fmtVal(val: number | null): { text: string; color: string } {
  if (val == null) return { text: '—', color: '#C4CFEA' };
  if (val === 0) return { text: '0', color: '#8A9BBC' };
  if (val < 0) {
    const abs = formatCurrency(Math.abs(val)).replace('R$\u00a0', '').replace('R$ ', '');
    return { text: `(${abs})`, color: '#DC2626' };
  }
  return { text: formatCurrency(val).replace('R$\u00a0', '').replace('R$ ', ''), color: '#0D1B35' };
}

function fmtIndicadorVal(val: number | null): { text: string; color: string } {
  if (val == null) return { text: '—', color: '#8A9BBC' };
  if (val === 0) return { text: '0', color: '#8A9BBC' };
  const abs = formatCurrency(Math.abs(val)).replace('R$\u00a0', '').replace('R$ ', '');
  if (val < 0) return { text: `(${abs})`, color: '#DC2626' };
  return { text: abs, color: '#00A86B' };
}

function hasPrefixPlus(nome: string): boolean { return nome.trim().startsWith('(+)'); }
function hasPrefixMinus(nome: string): boolean { return nome.trim().startsWith('(-)'); }

// --- Indicador dot colors (matching DRE) ---
const indicadorDotColors: Record<string, string> = {
  margem_contribuicao: '#00A86B',
  resultado_operacional: '#D97706',
  resultado_apos_investimentos: '#0099E6',
  resultado_caixa: '#1A3CFF',
};

const indicadorAvColors: Record<string, string> = {
  margem_contribuicao: '#00A86B',
  resultado_operacional: '#D97706',
  resultado_apos_investimentos: '#0099E6',
  resultado_caixa: '#1A3CFF',
};

interface Props { clienteId: string; }

type DreRowExt = { type: 'conta'; conta: ContaRow } | { type: 'indicador'; indicador: IndicadorDRE };

export function TorreControleTab({ clienteId }: Props) {
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const anoSelecionado = useMemo(() => competencia ? competencia.split('-')[0] : String(new Date().getFullYear()), [competencia]);

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

  const { data: valoresAnoCompleto } = useQuery({
    queryKey: ['valores-ano-completo-torre', clienteId, anoSelecionado, contas?.length ?? 0],
    enabled: !!clienteId && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map((c) => c.id);
      const { data } = await supabase
        .from('valores_mensais')
        .select('conta_id, valor_realizado')
        .in('conta_id', contaIds)
        .gte('competencia', `${anoSelecionado}-01-01`)
        .lte('competencia', `${anoSelecionado}-12-31`)
        .not('valor_realizado', 'is', null);
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

  const leafContas = useMemo(() => (contas ? getLeafContas(contas) : []), [contas]);

  const faturamento = useMemo(() => {
    if (!contas) return { real: 0, meta: 0 };
    const receitaLeafs = leafContas.filter((c) => c.tipo === 'receita');
    let real = 0, meta = 0;
    receitaLeafs.forEach((c) => {
      const r = realizadoMap[c.id]; if (r != null) real += r;
      const m = metaMap[c.id]; if (m != null) meta += m;
    });
    return { real, meta };
  }, [leafContas, realizadoMap, metaMap]);

  const faturamentoAnt = useMemo(() => {
    if (!leafContas.length) return 0;
    let total = 0;
    leafContas.filter((c) => c.tipo === 'receita').forEach((c) => {
      const v = valoresAntMap[c.id]; if (v != null) total += v;
    });
    return total;
  }, [leafContas, valoresAntMap]);

  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some((v) => v.valor_realizado != null);
  const hasAnterior = valoresAnterior && valoresAnterior.some((v) => v.valor_realizado != null);
  const compLabel = competencias.find((c) => c.value === competencia)?.label || '';

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // --- Filter ---
  const contasComValor = useMemo(() => {
    const set = new Set<string>();
    valoresAnoCompleto?.forEach((v) => { set.add(v.conta_id); });
    return set;
  }, [valoresAnoCompleto]);

  const contaHasValues = useCallback((contaId: string, nivel: number): boolean => {
    if (nivel === 2) return contasComValor.has(contaId);
    return contas?.some((c) => c.conta_pai_id === contaId && contaHasValues(c.id, c.nivel)) ?? false;
  }, [contas, contasComValor]);

  const visibleRows = useMemo((): DreRowExt[] => {
    if (!contas) return [];
    const rows: DreRowExt[] = [];
    let lastTipo = '';

    for (const conta of contas) {
      if (!contaHasValues(conta.id, conta.nivel)) continue;
      if (conta.nivel === 2 && conta.conta_pai_id && collapsed.has(conta.conta_pai_id)) continue;
      if (conta.nivel === 1 && conta.conta_pai_id && collapsed.has(conta.conta_pai_id)) continue;
      if (conta.nivel === 2 && conta.conta_pai_id) {
        const parent = contas.find((c) => c.id === conta.conta_pai_id);
        if (parent?.conta_pai_id && collapsed.has(parent.conta_pai_id)) continue;
      }

      if (lastTipo && lastTipo !== conta.tipo) {
        const indicator = indicadorAfterType[lastTipo];
        if (indicator) rows.push({ type: 'indicador', indicador: indicator });
      }
      rows.push({ type: 'conta', conta });
      lastTipo = conta.tipo;
    }

    if (lastTipo) {
      const indicator = indicadorAfterType[lastTipo];
      if (indicator) rows.push({ type: 'indicador', indicador: indicator });
    }
    return rows;
  }, [contas, collapsed, contaHasValues]);

  // --- Sticky cell style helper (same as DRE) ---
  const stickyTd = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
    position: 'sticky',
    left: 0,
    zIndex: 10,
    background: bg,
    borderRight: '1px solid #DDE4F0',
    minWidth: 280,
    maxWidth: 360,
    ...extra,
  });

  // --- Delta badge ---
  const renderDelta = (val: number | null, ref: number | null) => {
    if (val == null || ref == null || ref === 0) return null;
    const delta = ((val - ref) / Math.abs(ref)) * 100;
    const positive = delta >= 0;
    const color = positive ? '#00A86B' : '#DC2626';
    const bg = positive ? 'rgba(0,168,107,0.08)' : 'rgba(220,38,38,0.08)';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, borderRadius: 999, padding: '2px 8px', fontSize: 11, fontWeight: 600, color, background: bg }}>
        {positive ? '▲' : '▼'} {positive ? '+' : ''}{delta.toFixed(1)}%
      </span>
    );
  };

  // Number of data columns
  const colCount = hasAnterior ? 6 : 4;

  return (
    <div className="space-y-4">
      {/* Title + Filter */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#8A9BBC', textTransform: 'uppercase' }}>
          TORRE DE CONTROLE — DRE MENSAL
        </div>
        <div className="space-y-1">
          <label className="text-xs" style={{ color: '#8A9BBC' }}>Competência</label>
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
          <BookOpen className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Plano de contas não configurado.</p>
        </div>
      )}

      {hasContas && !hasValores && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileSpreadsheet className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Nenhum valor importado para {compLabel}</p>
        </div>
      )}

      {hasContas && hasValores && (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: '#DDE4F0', background: '#FAFCFF' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
            <thead>
              <tr style={{ background: '#F0F4FA', borderBottom: '2px solid #DDE4F0' }}>
                <th style={{
                  ...stickyTd('#F0F4FA', {
                    padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                    color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em',
                  }),
                  width: 280,
                }}>
                  CONTA DRE
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em', width: 120 }}>
                  REALIZADO
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 10, fontWeight: 400, color: '#8A9BBC', fontStyle: 'italic', width: 60 }}>
                  AV%
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em', width: 120 }}>
                  META
                </th>
                <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em', width: 100 }}>
                  Δ VS META
                </th>
                {hasAnterior && (
                  <>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em', width: 120, borderLeft: '1px solid #DDE4F0' }}>
                      MÊS ANT.
                    </th>
                    <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em', width: 100 }}>
                      Δ VS ANT.
                    </th>
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
                  const dotColor = indicadorDotColors[ind.key] || '#1A3CFF';
                  const avColor = indicadorAvColors[ind.key] || '#1A3CFF';
                  const f = fmtIndicadorVal(realVal);

                  return [
                    // Value row
                    <tr key={ind.key} style={{ background: '#0D1B35' }}>
                      <td style={{ ...stickyTd('#0D1B35', { padding: '11px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', borderRightColor: '#2A3A5C' }) }}>
                        <span className="flex items-center gap-2">
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }} />
                          {ind.nome}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: f.color, padding: '11px 12px' }}>
                        {f.text}
                      </td>
                      <td style={{ textAlign: 'right', padding: '11px 6px' }}>
                        {av != null && (
                          <span style={{ color: avColor, fontSize: 11, fontFamily: 'monospace', fontWeight: 600 }}>{av}%</span>
                        )}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#8A9BBC', padding: '11px 12px' }}>
                        {metaVal !== 0 ? fmtIndicadorVal(metaVal).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '11px 12px' }}>
                        {renderDelta(realVal, metaVal !== 0 ? metaVal : null)}
                      </td>
                      {hasAnterior && (
                        <>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: '#8A9BBC', padding: '11px 12px', borderLeft: '1px solid #2A3A5C' }}>
                            {antVal != null ? fmtIndicadorVal(antVal).text : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '11px 12px' }}>
                            {renderDelta(realVal, antVal)}
                          </td>
                        </>
                      )}
                    </tr>,
                    // Percentage row
                    <tr key={`${ind.key}_pct`} style={{ background: '#1A3CFF0F' }}>
                      <td style={{ ...stickyTd('#F5F7FF', { padding: '6px 12px', fontSize: 11, color: '#4A5E80', fontStyle: 'italic' }) }}>
                        % sobre Faturamento
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: avColor, padding: '6px 12px' }}>
                        {av != null ? `${av} %` : '—'}
                      </td>
                      <td />
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#8A9BBC', padding: '6px 12px' }}>
                        {faturamento.meta ? `${((metaVal / faturamento.meta) * 100).toFixed(1)} %` : '—'}
                      </td>
                      <td />
                      {hasAnterior && (
                        <>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#8A9BBC', padding: '6px 12px', borderLeft: '1px solid #DDE4F0' }}>
                            {faturamentoAnt ? `${((antVal! / faturamentoAnt) * 100).toFixed(1)} %` : '—'}
                          </td>
                          <td />
                        </>
                      )}
                    </tr>,
                  ];
                }

                const conta = row.conta;
                const isSecao = conta.nivel === 0;
                const isGrupo = conta.nivel === 1;
                const isConta = conta.nivel === 2;

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

                const av = displayReal != null && faturamento.real ? ((Math.abs(displayReal) / Math.abs(faturamento.real)) * 100).toFixed(1) : null;
                const hasChildren = contas!.some((c) => c.conta_pai_id === conta.id);
                const isCollapsedItem = collapsed.has(conta.id);

                const nome = conta.nome;
                const isPlus = hasPrefixPlus(nome);
                const isMinus = hasPrefixMinus(nome);
                const cleanName = nome.replace(/^\([+-]\)\s*/, '');

                // --- Grupo (nivel=0) ---
                if (isSecao) {
                  const f = fmtVal(displayReal);
                  return (
                    <tr key={conta.id} style={{ background: '#F0F4FA', borderTop: '1px solid #C4CFEA', borderBottom: '1px solid #C4CFEA' }}>
                      <td style={stickyTd('#F0F4FA', { padding: '10px 12px', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#0D1B35', letterSpacing: '0.04em' })}>
                        <span className="flex items-center gap-1.5">
                          {hasChildren && (
                            <button onClick={() => toggleCollapse(conta.id)} className="p-0.5 rounded hover:bg-[#DDE4F0]" style={{ lineHeight: 0 }}>
                              {isCollapsedItem ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          <span>{conta.nome}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: f.color, padding: '10px 12px' }}>
                        {f.text}
                      </td>
                      <td style={{ textAlign: 'right', padding: '10px 6px', color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace' }}>
                        {av ? `${av}%` : ''}
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: displayMeta != null ? fmtVal(displayMeta).color : '#C4CFEA', padding: '10px 12px' }}>
                        {displayMeta != null ? fmtVal(displayMeta).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '10px 12px' }}>
                        {renderDelta(displayReal, displayMeta)}
                      </td>
                      {hasAnterior && (
                        <>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '10px 12px', borderLeft: '1px solid #DDE4F0' }}>
                            {displayAnt != null ? fmtVal(displayAnt).text : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '10px 12px' }}>
                            {renderDelta(displayReal, displayAnt)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }

                // --- Subgrupo (nivel=1) ---
                if (isGrupo) {
                  const f = fmtVal(displayReal);
                  return (
                    <tr key={conta.id} className="hover:bg-[#F6F9FF]" style={{ background: '#FFFFFF', borderBottom: '1px solid #F0F4FA' }}>
                      <td style={stickyTd('#FFFFFF', { padding: '8px 12px 8px 24px', fontWeight: 600, fontSize: 12, color: '#0D1B35' })}>
                        <span className="flex items-center gap-1.5">
                          {hasChildren && (
                            <button onClick={() => toggleCollapse(conta.id)} className="p-0.5 rounded hover:bg-[#E8EEF8]" style={{ lineHeight: 0 }}>
                              {isCollapsedItem ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </button>
                          )}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{conta.nome}</span>
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: f.color, padding: '8px 12px' }}>
                        {f.text}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 6px' }} />
                      <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: displayMeta != null ? fmtVal(displayMeta).color : '#C4CFEA', padding: '8px 12px' }}>
                        {displayMeta != null ? fmtVal(displayMeta).text : '—'}
                      </td>
                      <td style={{ textAlign: 'right', padding: '8px 12px' }}>
                        {renderDelta(displayReal, displayMeta)}
                      </td>
                      {hasAnterior && (
                        <>
                          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '8px 12px', borderLeft: '1px solid #DDE4F0' }}>
                            {displayAnt != null ? fmtVal(displayAnt).text : '—'}
                          </td>
                          <td style={{ textAlign: 'right', padding: '8px 12px' }}>
                            {renderDelta(displayReal, displayAnt)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                }

                // --- Categoria (nivel=2) ---
                const f = fmtVal(displayReal);
                const isReceita = conta.tipo === 'receita';
                return (
                  <tr key={conta.id} className="hover:bg-[#F6F9FF]" style={{ borderBottom: '1px solid #F8F9FB' }}>
                    <td style={stickyTd('#FFFFFF', { padding: '7px 12px 7px 48px', fontWeight: 400, fontSize: 12, color: '#4A5E80' })}>
                      <span className="flex items-center gap-1.5">
                        {isPlus && <ArrowUp className="h-3 w-3 flex-shrink-0" style={{ color: '#00A86B' }} />}
                        {isMinus && <ArrowDown className="h-3 w-3 flex-shrink-0" style={{ color: '#DC2626' }} />}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanName}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: displayReal == null ? 'center' : 'right', fontFamily: 'monospace', fontSize: 12, color: f.color, padding: '7px 12px' }}>
                      {f.text}
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 6px', color: '#8A9BBC', fontSize: 11, fontFamily: 'monospace' }}>
                      {!isReceita && av ? `${av}%` : ''}
                    </td>
                    <td style={{ textAlign: displayMeta == null ? 'center' : 'right', fontFamily: 'monospace', fontSize: 12, color: displayMeta != null ? fmtVal(displayMeta).color : '#C4CFEA', padding: '7px 12px' }}>
                      {displayMeta != null ? fmtVal(displayMeta).text : '—'}
                    </td>
                    <td style={{ textAlign: 'right', padding: '7px 12px' }}>
                      {renderDelta(displayReal, displayMeta)}
                    </td>
                    {hasAnterior && (
                      <>
                        <td style={{ textAlign: displayAnt == null ? 'center' : 'right', fontFamily: 'monospace', fontSize: 12, color: displayAnt != null ? fmtVal(displayAnt).color : '#C4CFEA', padding: '7px 12px', borderLeft: '1px solid #DDE4F0' }}>
                          {displayAnt != null ? fmtVal(displayAnt).text : '—'}
                        </td>
                        <td style={{ textAlign: 'right', padding: '7px 12px' }}>
                          {renderDelta(displayReal, displayAnt)}
                        </td>
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
