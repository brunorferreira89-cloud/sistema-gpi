import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';
import { getLeafContas } from '@/lib/dre-indicadores';

// --- helpers ---

function getYearOptions() {
  const now = new Date();
  const years: string[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) years.push(String(y));
  return years;
}

function getMonthsForYear(year: string) {
  const months: { value: string; label: string; shortLabel: string }[] = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(Number(year), m, 1);
    months.push({
      value: `${year}-${String(m + 1).padStart(2, '0')}-01`,
      label: d.toLocaleDateString('pt-BR', { month: 'long' }),
      shortLabel: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
    });
  }
  return months;
}

interface DreNode {
  conta: ContaRow;
  children: DreNode[];
}

function buildDreTree(contas: ContaRow[]): DreNode[] {
  const map = new Map<string, DreNode>();
  const roots: DreNode[] = [];
  for (const c of contas) map.set(c.id, { conta: c, children: [] });
  for (const c of contas) {
    const node = map.get(c.id)!;
    if (c.conta_pai_id && map.has(c.conta_pai_id)) {
      map.get(c.conta_pai_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const sort = (arr: DreNode[]) => { arr.sort((a, b) => a.conta.ordem - b.conta.ordem); arr.forEach((n) => sort(n.children)); };
  sort(roots);
  return roots;
}

const TIPO_ORDER = ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'];

interface Indicador {
  key: string;
  nomeDisplay: string;
  pctLabel: string;
  tipos: string[];
  dotColor: string;
}

const INDICADORES: Indicador[] = [
  { key: 'mc', nomeDisplay: 'Margem de contribuição (A+B)', pctLabel: '% ((A+B)÷A)', tipos: ['receita', 'custo_variavel'], dotColor: '#00A86B' },
  { key: 'ro', nomeDisplay: 'Resultado Operacional', pctLabel: '% (RO÷A)', tipos: ['receita', 'custo_variavel', 'despesa_fixa'], dotColor: '#D97706' },
  { key: 'gc', nomeDisplay: 'Geração de Caixa', pctLabel: '% (GC÷A)', tipos: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'], dotColor: '#1A3CFF' },
];

const INDICADOR_AFTER_TIPO: Record<string, Indicador> = {
  custo_variavel: INDICADORES[0],
  despesa_fixa: INDICADORES[1],
  investimento: INDICADORES[2],
};

function calcIndicadorValue(leafs: ContaRow[], valMap: Record<string, number | null>, tipos: string[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const c of leafs) {
    if (!tipos.includes(c.tipo)) continue;
    const v = valMap[c.id];
    if (v == null) continue;
    hasAny = true;
    // Value is already signed correctly from DB; receita adds, others subtract
    total += c.tipo === 'receita' ? v : -Math.abs(v);
  }
  return hasAny ? total : null;
}

function sumLeafsOfNode(node: DreNode, valMap: Record<string, number | null>): number | null {
  if (node.conta.nivel === 2) {
    // Value is already signed correctly from DB (negative for deductions like Troco)
    return valMap[node.conta.id] ?? null;
  }
  let total = 0;
  let hasAny = false;
  for (const child of node.children) {
    const v = sumLeafsOfNode(child, valMap);
    if (v != null) { total += v; hasAny = true; }
  }
  return hasAny ? total : null;
}

function hasPrefixPlus(nome: string): boolean { return nome.trim().startsWith('(+)'); }
function hasPrefixMinus(nome: string): boolean { return nome.trim().startsWith('(-)'); }

/** Format value Nibo-style: negatives as (1.234), zero as "0", null as "—" */
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

// --- component ---

interface Props { clienteId: string; }

export function DreAnualTab({ clienteId }: Props) {
  const years = getYearOptions();
  const [ano, setAno] = useState(years[0]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const months = getMonthsForYear(ano);

  // Current month detection for highlight
  const now = new Date();
  const currentMonthComp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

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
      const { data } = await supabase.from('valores_mensais').select('conta_id, competencia, valor_realizado').in('conta_id', contaIds).in('competencia', competencias);
      return data || [];
    },
  });

  const valoresMap = useMemo(() => {
    const map: Record<string, Record<string, number | null>> = {};
    valoresAnuais?.forEach((v) => {
      if (!map[v.conta_id]) map[v.conta_id] = {};
      map[v.conta_id][v.competencia] = v.valor_realizado;
    });
    return map;
  }, [valoresAnuais]);

  const hasAnyData = useMemo(() => {
    return valoresAnuais?.some((v) => v.valor_realizado != null) ?? false;
  }, [valoresAnuais]);

  const tree = useMemo(() => (contas ? buildDreTree(contas) : []), [contas]);

  const sortedRoots = useMemo(() => {
    return [...tree].sort((a, b) => {
      const ai = TIPO_ORDER.indexOf(a.conta.tipo);
      const bi = TIPO_ORDER.indexOf(b.conta.tipo);
      if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a.conta.ordem - b.conta.ordem;
    });
  }, [tree]);

  const hasContas = contas && contas.length > 0;

  const getMonthMap = (comp: string): Record<string, number | null> => {
    const map: Record<string, number | null> = {};
    contas?.forEach((c) => { map[c.id] = valoresMap[c.id]?.[comp] ?? null; });
    return map;
  };

  const leafContas = useMemo(() => (contas ? getLeafContas(contas) : []), [contas]);

  const faturamentoPorMes = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of months) {
      let total = 0;
      for (const c of leafContas) {
        if (c.tipo === 'receita') {
          const v = valoresMap[c.id]?.[m.value];
          if (v != null) {
            total += hasPrefixMinus(c.nome) ? -Math.abs(v) : Math.abs(v);
          }
        }
      }
      map[m.value] = total;
    }
    return map;
  }, [leafContas, valoresMap, months]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // --- Sticky cell style helper ---
  const stickyTd = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
    position: 'sticky',
    left: 0,
    zIndex: 10,
    background: bg,
    borderRight: '1px solid #DDE4F0',
    minWidth: 280,
    maxWidth: 320,
    ...extra,
  });

  const yearColStyle = (extra?: React.CSSProperties): React.CSSProperties => ({
    background: '#F6F9FF',
    borderLeft: '1px solid #DDE4F0',
    ...extra,
  });

  const isCurrentMonth = (comp: string) => comp === currentMonthComp;

  // --- Row renderers ---

  const renderCategoriaRow = (node: DreNode) => {
    const nome = node.conta.nome;
    const isPlus = hasPrefixPlus(nome);
    const isMinus = hasPrefixMinus(nome);
    const cleanName = nome.replace(/^\([+-]\)\s*/, '');

    let yearTotal = 0;
    let hasYearVal = false;

    return (
      <tr key={node.conta.id} className="hover:bg-[#F6F9FF]" style={{ borderBottom: '1px solid #F8F9FB' }}>
        <td style={stickyTd('#FFFFFF', { padding: '7px 12px 7px 48px', fontWeight: 400, fontSize: 12, color: '#4A5E80' })}>
          <span className="flex items-center gap-1.5">
            {isPlus && <ArrowUp className="h-3 w-3 flex-shrink-0" style={{ color: '#00A86B' }} />}
            {isMinus && <ArrowDown className="h-3 w-3 flex-shrink-0" style={{ color: '#DC2626' }} />}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanName}</span>
          </span>
        </td>
        {months.map((m) => {
          const val = valoresMap[node.conta.id]?.[m.value] ?? null;
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const f = fmtVal(val);
          return (
            <td key={m.value} style={{
              textAlign: val == null ? 'center' : 'right',
              fontFamily: 'monospace', fontSize: 12, color: f.color, padding: '7px 12px',
              background: isCurrentMonth(m.value) ? '#FAFCFF' : undefined,
            }}>
              {f.text}
            </td>
          );
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '7px 12px' }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
      </tr>
    );
  };

  const renderSubgrupoRow = (node: DreNode) => {
    const isExp = !collapsed.has(node.conta.id);
    const hasKids = node.children.length > 0;
    let yearTotal = 0;
    let hasYearVal = false;

    return (
      <tr key={node.conta.id} className="hover:bg-[#F6F9FF]" style={{ background: '#FFFFFF', borderBottom: '1px solid #F0F4FA' }}>
        <td style={stickyTd('#FFFFFF', { padding: '8px 12px 8px 24px', fontWeight: 600, fontSize: 12, color: '#0D1B35' })}>
          <span className="flex items-center gap-1.5">
            {hasKids && (
              <button onClick={() => toggleCollapse(node.conta.id)} className="p-0.5 rounded hover:bg-[#E8EEF8]" style={{ lineHeight: 0 }}>
                {isExp ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            )}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.conta.nome}</span>
          </span>
        </td>
        {months.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const f = fmtVal(val);
          return (
            <td key={m.value} style={{
              textAlign: val == null ? 'center' : 'right',
              fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: f.color, padding: '8px 12px',
              background: isCurrentMonth(m.value) ? '#FAFCFF' : undefined,
            }}>
              {f.text}
            </td>
          );
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, padding: '8px 12px' }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
      </tr>
    );
  };

  const renderGrupoRow = (node: DreNode) => {
    const isExp = !collapsed.has(node.conta.id);
    const hasKids = node.children.length > 0;
    let yearTotal = 0;
    let hasYearVal = false;

    return (
      <tr key={node.conta.id} style={{ background: '#F0F4FA', borderTop: '1px solid #C4CFEA', borderBottom: '1px solid #C4CFEA' }}>
        <td style={stickyTd('#F0F4FA', { padding: '10px 12px', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#0D1B35', letterSpacing: '0.04em' })}>
          <span className="flex items-center gap-1.5">
            {hasKids && (
              <button onClick={() => toggleCollapse(node.conta.id)} className="p-0.5 rounded hover:bg-[#DDE4F0]" style={{ lineHeight: 0 }}>
                {isExp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
            )}
            <span>{node.conta.nome}</span>
          </span>
        </td>
        {months.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const f = fmtVal(val);
          return (
            <td key={m.value} style={{
              textAlign: val == null ? 'center' : 'right',
              fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: f.color, padding: '10px 12px',
              background: isCurrentMonth(m.value) ? '#E8EEF8' : undefined,
            }}>
              {f.text}
            </td>
          );
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 12, padding: '10px 12px' }), color: hasYearVal ? fmtVal(yearTotal).color : '#C4CFEA' }}>
          {hasYearVal ? fmtVal(yearTotal).text : '—'}
        </td>
      </tr>
    );
  };

  const renderIndicadorRows = (ind: Indicador) => {
    let yearTotal = 0;
    let hasYearVal = false;
    const rows: React.ReactNode[] = [];

    // Value row
    rows.push(
      <tr key={ind.key} style={{ background: '#0D1B35' }}>
        <td style={{ ...stickyTd('#0D1B35', { padding: '11px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF', borderRightColor: '#2A3A5C' }) }}>
          <span className="flex items-center gap-2">
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: ind.dotColor, flexShrink: 0, display: 'inline-block' }} />
            {ind.nomeDisplay}
          </span>
        </td>
        {months.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = calcIndicadorValue(leafContas, monthMap, ind.tipos);
          if (val != null) { yearTotal += val; hasYearVal = true; }
          const f = fmtIndicadorVal(val);
          return (
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: f.color, padding: '11px 12px' }}>
              {f.text}
            </td>
          );
        })}
        <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 800, fontSize: 13, padding: '11px 12px', background: '#0F1F3D', borderLeft: '1px solid #2A3A5C', color: hasYearVal ? fmtIndicadorVal(yearTotal).color : '#8A9BBC' }}>
          {hasYearVal ? fmtIndicadorVal(yearTotal).text : '—'}
        </td>
      </tr>
    );

    // Percentage row
    rows.push(
      <tr key={`${ind.key}_pct`} style={{ background: '#1A3CFF0F' }}>
        <td style={{ ...stickyTd('#F5F7FF', { padding: '6px 12px', fontSize: 11, color: '#4A5E80', fontStyle: 'italic' }) }}>
          {ind.pctLabel}
        </td>
        {months.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = calcIndicadorValue(leafContas, monthMap, ind.tipos);
          const fat = faturamentoPorMes[m.value] || 0;
          const pct = fat !== 0 && val != null ? ((val / fat) * 100).toFixed(0) : null;
          return (
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#1A3CFF', padding: '6px 12px' }}>
              {pct != null ? `${pct} %` : '—'}
            </td>
          );
        })}
        <td style={{ ...yearColStyle({ textAlign: 'right', fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: '#1A3CFF', padding: '6px 12px' }) }}>
          {(() => {
            const totalFat = Object.values(faturamentoPorMes).reduce((a, b) => a + b, 0);
            if (!hasYearVal || totalFat === 0) return '—';
            return `${((yearTotal / totalFat) * 100).toFixed(0)} %`;
          })()}
        </td>
      </tr>
    );

    return rows;
  };

  // --- Build full table body ---
  const buildTableBody = () => {
    const output: React.ReactNode[] = [];
    let lastTipo: string | null = null;

    for (const root of sortedRoots) {
      if (lastTipo && lastTipo !== root.conta.tipo) {
        const ind = INDICADOR_AFTER_TIPO[lastTipo];
        if (ind) output.push(...renderIndicadorRows(ind));
      }
      output.push(renderGrupoRow(root));

      const grupoExpanded = !collapsed.has(root.conta.id);
      if (grupoExpanded) {
        for (const child of root.children) {
          if (child.conta.nivel === 1) {
            output.push(renderSubgrupoRow(child));
            const subExpanded = !collapsed.has(child.conta.id);
            if (subExpanded) {
              for (const cat of child.children) {
                if (cat.conta.nivel === 2) output.push(renderCategoriaRow(cat));
              }
            }
          } else if (child.conta.nivel === 2) {
            output.push(renderCategoriaRow(child));
          }
        }
      }
      lastTipo = root.conta.tipo;
    }

    if (lastTipo) {
      const ind = INDICADOR_AFTER_TIPO[lastTipo];
      if (ind) output.push(...renderIndicadorRows(ind));
    }

    return output;
  };

  return (
    <div className="space-y-4">
      {/* Title + Filter */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#8A9BBC', textTransform: 'uppercase' }}>
          DRE GERENCIAL — BASE MENSAL
        </div>
        <div className="space-y-1">
          <label className="text-xs" style={{ color: '#8A9BBC' }}>Ano</label>
          <Select value={ano} onValueChange={(v) => { setAno(v); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      {/* Empty states */}
      {!hasContas && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <BookOpen className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Plano de contas não configurado.</p>
        </div>
      )}

      {hasContas && !hasAnyData && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileSpreadsheet className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Nenhum valor importado para {ano}.</p>
        </div>
      )}

      {/* DRE Table */}
      {hasContas && hasAnyData && (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: '#DDE4F0', background: '#FAFCFF' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 280 + 12 * 88 + 96 }}>
            <thead>
              <tr style={{ background: '#F0F4FA', borderBottom: '2px solid #DDE4F0' }}>
                <th style={{
                  ...stickyTd('#F0F4FA', {
                    padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                    color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em',
                  }),
                  width: 280,
                }}>
                  RESULTADO
                </th>
                {months.map((m) => (
                  <th key={m.value} style={{
                    padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: isCurrentMonth(m.value) ? 700 : 600,
                    color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em',
                    width: 88, whiteSpace: 'nowrap',
                    background: isCurrentMonth(m.value) ? '#1A3CFF1A' : undefined,
                  }}>
                    {m.shortLabel}
                  </th>
                ))}
                <th style={{
                  ...yearColStyle({
                    padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700,
                    color: '#0D1B35', textTransform: 'uppercase', letterSpacing: '0.06em',
                    width: 96, whiteSpace: 'nowrap',
                  }),
                }}>
                  {ano}
                </th>
              </tr>
            </thead>
            <tbody>
              {buildTableBody()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
