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

// tree node for DRE rendering
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

// tipo ordering for DRE display + indicator insertion
const TIPO_ORDER = ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'];

interface Indicador {
  key: string;
  nome: string;
  tipos: string[]; // sum these tipo leafs (receita positive, rest negative)
}

const INDICADORES: Indicador[] = [
  { key: 'mc', nome: '= MARGEM DE CONTRIBUIÇÃO', tipos: ['receita', 'custo_variavel'] },
  { key: 'ro', nome: '= RESULTADO OPERACIONAL', tipos: ['receita', 'custo_variavel', 'despesa_fixa'] },
  { key: 'gc', nome: '= GERAÇÃO DE CAIXA', tipos: ['receita', 'custo_variavel', 'despesa_fixa', 'investimento'] },
];

// Which indicator appears AFTER which tipo section
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

  // { conta_id: { competencia: valor } }
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

  // Sort root groups by TIPO_ORDER then by ordem
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

  // Build flat val map for a specific month
  const getMonthMap = (comp: string): Record<string, number | null> => {
    const map: Record<string, number | null> = {};
    contas?.forEach((c) => { map[c.id] = valoresMap[c.id]?.[comp] ?? null; });
    return map;
  };

  const leafContas = useMemo(() => (contas ? getLeafContas(contas) : []), [contas]);

  // faturamento per month (for % calc)
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

  // --- rendering helpers ---

  const renderValCell = (val: number | null, comp: string, style?: React.CSSProperties) => (
    <td key={comp} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#0D1B35', padding: '8px 16px', ...style }}>
      {val != null ? formatCurrency(val) : '—'}
    </td>
  );

  const renderIndicadorRow = (ind: Indicador) => {
    let acum = 0;
    let hasAcum = false;
    return (
      <tr key={ind.key} style={{ background: '#1A3CFF0F', borderTop: '2px solid #1A3CFF33', borderBottom: '2px solid #1A3CFF33' }}>
        <td style={{ padding: '12px 16px', fontWeight: 700, fontSize: 13, color: '#0D1B35' }}>{ind.nome}</td>
        {displayMonths.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = calcIndicadorValue(leafContas, monthMap, ind.tipos);
          if (val != null) { acum += val; hasAcum = true; }
          const fat = faturamentoPorMes[m.value] || 0;
          const pct = fat !== 0 && val != null ? ((val / fat) * 100).toFixed(1) : null;
          const color = val == null ? '#8A9BBC' : val > 0 ? '#00A86B' : val < 0 ? '#DC2626' : '#8A9BBC';
          return (
            <td key={m.value} style={{ textAlign: 'right', padding: '12px 16px', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>
              <span style={{ color }}>{val != null ? formatCurrency(val) : '—'}</span>
              {pct && <span style={{ fontSize: 11, color: '#4A5E80', marginLeft: 6 }}>{pct}%</span>}
            </td>
          );
        })}
        {displayMonths.length > 1 && (
          <td style={{ textAlign: 'right', padding: '12px 16px', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>
            <span style={{ color: !hasAcum ? '#8A9BBC' : acum > 0 ? '#00A86B' : acum < 0 ? '#DC2626' : '#8A9BBC' }}>
              {hasAcum ? formatCurrency(acum) : '—'}
            </span>
          </td>
        )}
      </tr>
    );
  };

  const renderCategoriaRow = (node: DreNode) => {
    const nome = node.conta.nome;
    const isPlus = hasPrefixPlus(nome);
    const isMinus = hasPrefixMinus(nome);
    let acum = 0;
    let hasAcum = false;
    return (
      <tr key={node.conta.id} style={{ background: '#FFFFFF', borderBottom: '1px solid #EEF1F6' }}>
        <td style={{ padding: '8px 16px 8px 40px', fontWeight: 400, fontSize: 12, color: '#4A5E80' }}>
          <span className="flex items-center gap-1.5">
            {isPlus && <ArrowUp className="h-3 w-3" style={{ color: '#00A86B' }} />}
            {isMinus && <ArrowDown className="h-3 w-3" style={{ color: '#DC2626' }} />}
            {nome.replace(/^\([+-]\)\s*/, '')}
          </span>
        </td>
        {displayMonths.map((m) => {
          const val = valoresMap[node.conta.id]?.[m.value] ?? null;
          if (val != null) { acum += val; hasAcum = true; }
          return renderValCell(val, m.value);
        })}
        {displayMonths.length > 1 && renderValCell(hasAcum ? acum : null, 'acum', { fontWeight: 700 })}
      </tr>
    );
  };

  const renderSubgrupoRow = (node: DreNode) => {
    let acum = 0;
    let hasAcum = false;
    return (
      <tr key={node.conta.id} style={{ background: '#F6F9FF', borderBottom: '1px solid #DDE4F0' }}>
        <td style={{ padding: '10px 16px 10px 24px', fontWeight: 600, fontSize: 13, color: '#0D1B35' }}>{node.conta.nome}</td>
        {displayMonths.map((m) => {
          const monthMap = getMonthMap(m.value);
          const val = sumLeafsOfNode(node, monthMap);
          if (val != null) { acum += val; hasAcum = true; }
          return (
            <td key={m.value} style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, color: '#0D1B35', padding: '10px 16px' }}>
              {val != null ? formatCurrency(val) : '—'}
            </td>
          );
        })}
        {displayMonths.length > 1 && (
          <td style={{ textAlign: 'right', fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: '#0D1B35', padding: '10px 16px' }}>
            {hasAcum ? formatCurrency(acum) : '—'}
          </td>
        )}
      </tr>
    );
  };

  const renderGrupoBlock = (node: DreNode) => {
    let acum = 0;
    let hasAcum = false;
    const rows: React.ReactNode[] = [];

    // Grupo header row
    rows.push(
      <tr key={node.conta.id} style={{ background: '#E8EEF8' }}>
        <td style={{ padding: '12px 16px', fontWeight: 700, textTransform: 'uppercase', color: '#0D1B35', fontSize: 13 }}>{node.conta.nome}</td>
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

    // Children: subgrupos or direct categories
    for (const child of node.children) {
      if (child.conta.nivel === 1) {
        rows.push(renderSubgrupoRow(child));
        for (const cat of child.children) {
          if (cat.conta.nivel === 2) rows.push(renderCategoriaRow(cat));
        }
      } else if (child.conta.nivel === 2) {
        rows.push(renderCategoriaRow(child));
      }
    }

    return rows;
  };

  // Group roots by tipo for indicator insertion
  const buildDreOutput = () => {
    const output: React.ReactNode[] = [];
    let lastTipo: string | null = null;

    for (const root of sortedRoots) {
      // Insert indicator between tipo sections
      if (lastTipo && lastTipo !== root.conta.tipo) {
        const ind = INDICADOR_AFTER_TIPO[lastTipo];
        if (ind) output.push(renderIndicadorRow(ind));
      }
      output.push(...renderGrupoBlock(root));
      lastTipo = root.conta.tipo;
    }

    // Final indicator after last tipo
    if (lastTipo) {
      const ind = INDICADOR_AFTER_TIPO[lastTipo];
      if (ind) output.push(renderIndicadorRow(ind));
    }

    return output;
  };

  return (
    <div className="space-y-4">
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

      {hasContas && hasData && (
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
              {buildDreOutput()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
