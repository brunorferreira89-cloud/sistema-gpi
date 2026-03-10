import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet, ArrowUp, ArrowDown } from 'lucide-react';
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
      shortLabel: d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(),
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
  nome: string;
  nomeDisplay: string;
  tipos: string[];
  dotColor: string;
}

const INDICADORES: Indicador[] = [
  { key: 'mc', nome: '= MARGEM DE CONTRIBUIÇÃO', nomeDisplay: '= Margem de Contribuição', tipos: ['receita', 'custo_variavel'], dotColor: '#00A86B' },
  { key: 'ro', nome: '= RESULTADO OPERACIONAL', nomeDisplay: '= Resultado Operacional', tipos: ['receita', 'custo_variavel', 'despesa_fixa'], dotColor: '#D97706' },
  { key: 'gc', nome: '= GERAÇÃO DE CAIXA', nomeDisplay: '= Geração de Caixa', tipos: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'], dotColor: '#1A3CFF' },
];

const INDICADOR_AFTER_TIPO: Record<string, Indicador> = {
  custo_variavel: INDICADORES[0],
  despesa_fixa: INDICADORES[1],
  investimento: INDICADORES[2],
};

const TIPO_BAR_COLORS: Record<string, string> = {
  receita: '#00A86B',
  custo_variavel: '#DC2626',
  despesa_fixa: '#D97706',
  investimento: '#8A9BBC',
  financeiro: '#0099E6',
};

function calcIndicadorValue(leafs: ContaRow[], valMap: Record<string, number | null>, tipos: string[]): number | null {
  let total = 0;
  let hasAny = false;
  for (const c of leafs) {
    if (!tipos.includes(c.tipo)) continue;
    const v = valMap[c.id];
    if (v == null) continue;
    hasAny = true;
    total += c.tipo === 'receita' ? v : -v;
  }
  return hasAny ? total : null;
}

function sumLeafsOfNode(node: DreNode, valMap: Record<string, number | null>): number | null {
  if (node.conta.nivel === 2) return valMap[node.conta.id] ?? null;
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

// --- KPI card helpers ---

function getKpiColor(val: number, thresholds: [number, number], inverted = false): string {
  if (inverted) {
    if (val <= thresholds[0]) return '#00A86B';
    if (val <= thresholds[1]) return '#D97706';
    return '#DC2626';
  }
  if (val >= thresholds[1]) return '#00A86B';
  if (val >= thresholds[0]) return '#D97706';
  return '#DC2626';
}

function KpiProgressBar({ value, max, thresholds, inverted, color }: { value: number; max: number; thresholds: [number, number]; inverted?: boolean; color: string }) {
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const t1 = (thresholds[0] / max) * 100;
  const t2 = (thresholds[1] / max) * 100;
  return (
    <div style={{ position: 'relative', width: '100%', height: 8, borderRadius: 4, background: '#E8EEF8', marginTop: 12 }}>
      {/* zone markers */}
      <div style={{ position: 'absolute', left: `${t1}%`, top: -2, bottom: -2, width: 1, background: '#C4CFEA', zIndex: 1 }} />
      <div style={{ position: 'absolute', left: `${t2}%`, top: -2, bottom: -2, width: 1, background: '#C4CFEA', zIndex: 1 }} />
      {/* fill */}
      <div style={{ height: '100%', width: `${pct}%`, borderRadius: 4, background: color, transition: 'width 0.3s' }} />
      {/* marker dot */}
      <div style={{
        position: 'absolute', top: '50%', left: `${pct}%`, transform: 'translate(-50%, -50%)',
        width: 12, height: 12, borderRadius: '50%', background: color, border: '2px solid #FFFFFF',
        boxShadow: '0 1px 4px rgba(0,0,0,0.15)', zIndex: 2,
      }} />
    </div>
  );
}

// --- component ---

interface Props { clienteId: string; }

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

  const mesesComDados = useMemo(() => {
    const set = new Set<string>();
    valoresAnuais?.forEach((v) => { if (v.valor_realizado != null) set.add(v.competencia); });
    return months.filter((m) => set.has(m.value));
  }, [valoresAnuais, months]);

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
  const hasData = mesesComDados.length > 0;
  const displayMonths = mesSelecionado ? months.filter((m) => m.value === mesSelecionado) : mesesComDados;

  const getMonthMap = (comp: string): Record<string, number | null> => {
    const map: Record<string, number | null> = {};
    contas?.forEach((c) => { map[c.id] = valoresMap[c.id]?.[comp] ?? null; });
    return map;
  };

  const leafContas = useMemo(() => (contas ? getLeafContas(contas) : []), [contas]);

  const faturamentoPorMes = useMemo(() => {
    const map: Record<string, number> = {};
    for (const m of displayMonths) {
      let total = 0;
      for (const c of leafContas) {
        if (c.tipo === 'receita') {
          const v = valoresMap[c.id]?.[m.value];
          if (v != null) total += v;
        }
      }
      map[m.value] = total;
    }
    return map;
  }, [leafContas, valoresMap, displayMonths]);

  // Aggregated values for single-month view (KPI cards)
  const singleMonthMap = useMemo(() => {
    if (displayMonths.length !== 1) return null;
    return getMonthMap(displayMonths[0].value);
  }, [displayMonths, contas, valoresMap]);

  // KPI calculations for single month
  const kpis = useMemo(() => {
    if (!singleMonthMap || !contas) return null;
    const fat = faturamentoPorMes[displayMonths[0]?.value] || 0;
    if (fat === 0) return null;

    const mc = calcIndicadorValue(leafContas, singleMonthMap, ['receita', 'custo_variavel']);
    const custosVar = (() => { let t = 0; leafContas.filter(c => c.tipo === 'custo_variavel').forEach(c => { const v = singleMonthMap[c.id]; if (v != null) t += v; }); return t; })();
    const gc = calcIndicadorValue(leafContas, singleMonthMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento']);

    // CMO: leafs whose parent subgrupo name contains "PESSOAL"
    const pessoalSubgrupos = contas.filter(c => c.nivel === 1 && c.nome.toUpperCase().includes('PESSOAL'));
    const pessoalIds = new Set(pessoalSubgrupos.map(c => c.id));
    let cmo = 0;
    leafContas.forEach(c => {
      if (c.conta_pai_id && pessoalIds.has(c.conta_pai_id)) {
        const v = singleMonthMap[c.id];
        if (v != null) cmo += v;
      }
    });

    return {
      mcPct: mc != null ? (mc / fat) * 100 : null,
      mcVal: mc,
      mcReceita: fat,
      mcCustos: custosVar,
      cmvPct: (custosVar / fat) * 100,
      cmoPct: (cmo / fat) * 100,
      gcPct: gc != null ? (gc / fat) * 100 : null,
      gcVal: gc,
    };
  }, [singleMonthMap, leafContas, faturamentoPorMes, displayMonths, contas]);

  // --- rendering ---

  const renderCategoriaRow = (node: DreNode) => {
    const nome = node.conta.nome;
    const isPlus = hasPrefixPlus(nome);
    const isMinus = hasPrefixMinus(nome);
    const barColor = TIPO_BAR_COLORS[node.conta.tipo] || '#8A9BBC';

    // For single month: show pct + bar. For multi: show columns.
    if (displayMonths.length === 1) {
      const comp = displayMonths[0].value;
      const val = valoresMap[node.conta.id]?.[comp] ?? null;
      const fat = faturamentoPorMes[comp] || 0;
      const pct = fat > 0 && val != null ? (val / fat) * 100 : null;
      const pctWidth = pct != null ? Math.min(pct, 100) : 0;

      return (
        <div key={node.conta.id} style={{ display: 'flex', alignItems: 'center', padding: '10px 16px 10px 32px', borderBottom: '1px solid #F0F4FA', background: '#FFFFFF', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            {isPlus && <ArrowUp className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#00A86B' }} />}
            {isMinus && <ArrowDown className="h-3.5 w-3.5 flex-shrink-0" style={{ color: '#DC2626' }} />}
            <span style={{ fontSize: 13, color: '#4A5E80', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {nome.replace(/^\([+-]\)\s*/, '')}
            </span>
          </div>
          {/* pct + bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: '#8A9BBC', width: 48, textAlign: 'right', fontFamily: 'monospace' }}>
              {pct != null ? `${pct.toFixed(1)}%` : ''}
            </span>
            <div style={{ width: 120, height: 4, borderRadius: 2, background: '#E8EEF8', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${pctWidth}%`, borderRadius: 2, background: barColor, transition: 'width 0.3s' }} />
            </div>
          </div>
          {/* value */}
          <span style={{ fontFamily: 'monospace', fontSize: 13, color: '#0D1B35', fontWeight: 500, minWidth: 120, textAlign: 'right' }}>
            {val != null ? formatCurrency(val) : '—'}
          </span>
        </div>
      );
    }

    // Multi-month table rows
    let acum = 0;
    let hasAcum = false;
    return (
      <tr key={node.conta.id} style={{ background: '#FFFFFF', borderBottom: '1px solid #F0F4FA' }}>
        <td style={{ padding: '10px 16px 10px 32px', fontWeight: 400, fontSize: 13, color: '#4A5E80' }}>
          <span className="flex items-center gap-1.5">
            {isPlus && <ArrowUp className="h-3.5 w-3.5" style={{ color: '#00A86B' }} />}
            {isMinus && <ArrowDown className="h-3.5 w-3.5" style={{ color: '#DC2626' }} />}
            {nome.replace(/^\([+-]\)\s*/, '')}
          </span>
        </td>
        {displayMonths.map((m) => {
          const val = valoresMap[node.conta.id]?.[m.value] ?? null;
          if (val != null) { acum += val; hasAcum = true; }
          return (
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#0D1B35', fontWeight: 500, padding: '10px 16px' }}>
              {val != null ? formatCurrency(val) : '—'}
            </td>
          );
        })}
        {displayMonths.length > 1 && (
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: '#0D1B35', padding: '10px 16px' }}>
            {hasAcum ? formatCurrency(acum) : '—'}
          </td>
        )}
      </tr>
    );
  };

  const renderSubgrupoRow = (node: DreNode) => {
    if (displayMonths.length === 1) {
      const comp = displayMonths[0].value;
      const monthMap = getMonthMap(comp);
      const val = sumLeafsOfNode(node, monthMap);
      return (
        <div key={node.conta.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#F6F9FF', borderBottom: '1px solid #DDE4F0' }}>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#0D1B35' }}>{node.conta.nome}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: '#0D1B35' }}>
            {val != null ? formatCurrency(val) : '—'}
          </span>
        </div>
      );
    }
    let acum = 0;
    let hasAcum = false;
    return (
      <tr key={node.conta.id} style={{ background: '#F6F9FF', borderBottom: '1px solid #DDE4F0' }}>
        <td style={{ padding: '10px 16px', fontWeight: 600, fontSize: 13, color: '#0D1B35' }}>{node.conta.nome}</td>
        {displayMonths.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { acum += val; hasAcum = true; }
          return (
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, color: '#0D1B35', padding: '10px 16px' }}>
              {val != null ? formatCurrency(val) : '—'}
            </td>
          );
        })}
        {displayMonths.length > 1 && (
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 600, color: '#0D1B35', padding: '10px 16px' }}>
            {hasAcum ? formatCurrency(acum) : '—'}
          </td>
        )}
      </tr>
    );
  };

  const renderGrupoHeader = (node: DreNode) => {
    if (displayMonths.length === 1) {
      const comp = displayMonths[0].value;
      const monthMap = getMonthMap(comp);
      const val = sumLeafsOfNode(node, monthMap);
      return (
        <div key={node.conta.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: '#E8EEF8', borderBottom: '1px solid #C4CFEA' }}>
          <span style={{ fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#4A5E80', letterSpacing: '0.05em' }}>{node.conta.nome}</span>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#0D1B35' }}>
            {val != null ? formatCurrency(val) : '—'}
          </span>
        </div>
      );
    }
    let acum = 0;
    let hasAcum = false;
    return (
      <tr key={node.conta.id} style={{ background: '#E8EEF8', borderBottom: '1px solid #C4CFEA' }}>
        <td style={{ padding: '12px 16px', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', color: '#4A5E80', letterSpacing: '0.05em' }}>{node.conta.nome}</td>
        {displayMonths.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { acum += val; hasAcum = true; }
          return (
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#0D1B35', padding: '12px 16px' }}>
              {val != null ? formatCurrency(val) : '—'}
            </td>
          );
        })}
        {displayMonths.length > 1 && (
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: '#0D1B35', padding: '12px 16px' }}>
            {hasAcum ? formatCurrency(acum) : '—'}
          </td>
        )}
      </tr>
    );
  };

  const renderIndicador = (ind: Indicador) => {
    if (displayMonths.length === 1) {
      const comp = displayMonths[0].value;
      const monthMap = getMonthMap(comp);
      const val = calcIndicadorValue(leafContas, monthMap, ind.tipos);
      const fat = faturamentoPorMes[comp] || 0;
      const pct = fat !== 0 && val != null ? ((val / fat) * 100).toFixed(1) : null;
      const valColor = val == null ? '#8A9BBC' : val > 0 ? '#00A86B' : val < 0 ? '#DC2626' : '#8A9BBC';

      return (
        <div key={ind.key} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#0D1B35', borderRadius: 8, padding: '14px 20px', margin: '8px 0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: ind.dotColor, flexShrink: 0 }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF' }}>{ind.nomeDisplay}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {pct && <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)', fontFamily: 'monospace' }}>{pct}%</span>}
            <span style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 800, color: valColor }}>
              {val != null ? formatCurrency(val) : '—'}
            </span>
          </div>
        </div>
      );
    }

    // Multi-month: table row
    let acum = 0;
    let hasAcum = false;
    return (
      <tr key={ind.key}>
        <td colSpan={displayMonths.length + 2} style={{ padding: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: '#0D1B35', borderRadius: 8, padding: '14px 20px', margin: '8px 4px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: ind.dotColor, flexShrink: 0 }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#FFFFFF' }}>{ind.nomeDisplay}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              {displayMonths.map((m) => {
                const monthMap = getMonthMap(m.value);
                const val = calcIndicadorValue(leafContas, monthMap, ind.tipos);
                if (val != null) { acum += val; hasAcum = true; }
                const valColor = val == null ? '#8A9BBC' : val > 0 ? '#00A86B' : val < 0 ? '#DC2626' : '#8A9BBC';
                return (
                  <span key={m.value} style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: valColor, minWidth: 100, textAlign: 'right' }}>
                    {val != null ? formatCurrency(val) : '—'}
                  </span>
                );
              })}
              {displayMonths.length > 1 && (
                <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: !hasAcum ? '#8A9BBC' : acum > 0 ? '#00A86B' : acum < 0 ? '#DC2626' : '#8A9BBC', minWidth: 110, textAlign: 'right' }}>
                  {hasAcum ? formatCurrency(acum) : '—'}
                </span>
              )}
            </div>
          </div>
        </td>
      </tr>
    );
  };

  // Build full DRE output
  const buildSingleMonthDre = () => {
    const output: React.ReactNode[] = [];
    let lastTipo: string | null = null;
    for (const root of sortedRoots) {
      if (lastTipo && lastTipo !== root.conta.tipo) {
        const ind = INDICADOR_AFTER_TIPO[lastTipo];
        if (ind) output.push(renderIndicador(ind));
      }
      output.push(renderGrupoHeader(root));
      for (const child of root.children) {
        if (child.conta.nivel === 1) {
          output.push(renderSubgrupoRow(child));
          for (const cat of child.children) {
            if (cat.conta.nivel === 2) output.push(renderCategoriaRow(cat));
          }
        } else if (child.conta.nivel === 2) {
          output.push(renderCategoriaRow(child));
        }
      }
      lastTipo = root.conta.tipo;
    }
    if (lastTipo) {
      const ind = INDICADOR_AFTER_TIPO[lastTipo];
      if (ind) output.push(renderIndicador(ind));
    }
    return output;
  };

  const buildMultiMonthDre = () => {
    const output: React.ReactNode[] = [];
    let lastTipo: string | null = null;
    for (const root of sortedRoots) {
      if (lastTipo && lastTipo !== root.conta.tipo) {
        const ind = INDICADOR_AFTER_TIPO[lastTipo];
        if (ind) output.push(renderIndicador(ind));
      }
      output.push(renderGrupoHeader(root));
      for (const child of root.children) {
        if (child.conta.nivel === 1) {
          output.push(renderSubgrupoRow(child));
          for (const cat of child.children) {
            if (cat.conta.nivel === 2) output.push(renderCategoriaRow(cat));
          }
        } else if (child.conta.nivel === 2) {
          output.push(renderCategoriaRow(child));
        }
      }
      lastTipo = root.conta.tipo;
    }
    if (lastTipo) {
      const ind = INDICADOR_AFTER_TIPO[lastTipo];
      if (ind) output.push(renderIndicador(ind));
    }
    return output;
  };

  // KPI cards (single month only)
  const renderKpiCards = () => {
    if (!kpis) return null;

    const cards: { title: string; value: number | null; refLabel: string; desc: string; formula: string; thresholds: [number, number]; inverted?: boolean; max: number }[] = [
      {
        title: 'MARGEM DE CONTRIBUIÇÃO',
        value: kpis.mcPct,
        refLabel: 'Ref: > 40%',
        desc: 'O quanto sobra do faturamento após os custos variáveis.',
        formula: `${formatCurrency(kpis.mcReceita)} - ${formatCurrency(kpis.mcCustos)}`,
        thresholds: [30, 40],
        max: 80,
      },
      {
        title: 'CMV',
        value: kpis.cmvPct,
        refLabel: 'Ref: < 38%',
        desc: 'Custo da mercadoria sobre o faturamento.',
        formula: '',
        thresholds: [38, 50],
        inverted: true,
        max: 80,
      },
      {
        title: 'CMO',
        value: kpis.cmoPct,
        refLabel: 'Ref: < 25%',
        desc: 'Custo total da mão de obra sobre o faturamento.',
        formula: '',
        thresholds: [25, 35],
        inverted: true,
        max: 60,
      },
      {
        title: 'GERAÇÃO DE CAIXA',
        value: kpis.gcPct,
        refLabel: 'Ref: > 10%',
        desc: 'O que sobra após todas as saídas operacionais e financeiras.',
        formula: kpis.gcVal != null ? formatCurrency(kpis.gcVal) : '',
        thresholds: [5, 10],
        max: 40,
      },
    ];

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginTop: 24 }}>
        {cards.map((card) => {
          const val = card.value ?? 0;
          const color = getKpiColor(val, card.thresholds, card.inverted);
          const refColor = color;
          return (
            <div key={card.title} style={{
              background: '#FFFFFF', borderRadius: 12, border: '1px solid #DDE4F0',
              padding: 20, boxShadow: '0 2px 8px rgba(13,27,53,0.06)',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#8A9BBC', letterSpacing: '0.06em', marginBottom: 8 }}>
                {card.title}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 32, fontWeight: 800, color, fontFamily: 'monospace', lineHeight: 1 }}>
                  {card.value != null ? `${card.value.toFixed(1)}%` : '—'}
                </span>
                <span style={{
                  fontSize: 11, fontWeight: 600, color: refColor,
                  background: `${refColor}1A`, borderRadius: 4, padding: '2px 8px',
                }}>
                  {card.refLabel}
                </span>
              </div>
              <p style={{ fontSize: 12, color: '#4A5E80', margin: '0 0 4px', lineHeight: 1.4 }}>{card.desc}</p>
              {card.formula && (
                <p style={{ fontSize: 11, color: '#8A9BBC', margin: 0, fontFamily: 'monospace' }}>{card.formula}</p>
              )}
              <KpiProgressBar value={val} max={card.max} thresholds={card.thresholds} inverted={card.inverted} color={color} />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Title */}
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: '#8A9BBC', textTransform: 'uppercase' }}>
        DRE GERENCIAL — BASE MENSAL
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label className="text-xs" style={{ color: '#8A9BBC' }}>Ano</label>
          <Select value={ano} onValueChange={(v) => { setAno(v); setMesSelecionado(null); }}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs" style={{ color: '#8A9BBC' }}>Filtrar mês</label>
          <Select value={mesSelecionado || 'todos'} onValueChange={(v) => setMesSelecionado(v === 'todos' ? null : v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os meses</SelectItem>
              {months.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
            </SelectContent>
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

      {hasContas && !hasData && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <FileSpreadsheet className="h-12 w-12" style={{ color: '#8A9BBC', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: '#4A5E80' }}>Nenhum valor importado para {ano}.</p>
        </div>
      )}

      {/* DRE Content */}
      {hasContas && hasData && displayMonths.length === 1 && (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: '#DDE4F0', background: '#FFFFFF' }}>
          {buildSingleMonthDre()}
        </div>
      )}

      {hasContas && hasData && displayMonths.length > 1 && (
        <div className="rounded-xl border overflow-x-auto" style={{ borderColor: '#DDE4F0', background: '#FFFFFF' }}>
          <table className="w-full" style={{ minWidth: 600, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#E8EEF8', borderBottom: '2px solid #DDE4F0' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: '#4A5E80', minWidth: 220 }}>Conta DRE</th>
                {displayMonths.map((m) => (
                  <th key={m.value} style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: '#4A5E80', minWidth: 110 }}>{m.shortLabel}</th>
                ))}
                {displayMonths.length > 1 && <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 700, color: '#0D1B35', minWidth: 110 }}>ACUMULADO</th>}
              </tr>
            </thead>
            <tbody>
              {buildMultiMonthDre()}
            </tbody>
          </table>
        </div>
      )}

      {/* KPI Cards (single month only) */}
      {hasContas && hasData && displayMonths.length === 1 && renderKpiCards()}
    </div>
  );
}
