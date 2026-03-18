import { useState, useMemo, useEffect, useRef, Fragment, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { TorreMeta, calcProjetado, calcStatus, fmtTorre, mesSeguinte as getMesSeguinte, fmtCompetencia } from '@/lib/torre-utils';
import { SugestaoMetasDrawer, type SugestaoMeta } from './SugestaoMetasDrawer';
import { ChatAnalistaDrawer } from './ChatAnalistaDrawer';
import { TorreIndicadoresCriacao } from './TorreIndicadoresCriacao';

// ── Types ───────────────────────────────────────────────────────
interface DreNode { conta: ContaRow; children: DreNode[] }

interface Cliente {
  id: string;
  nome_empresa: string;
  razao_social?: string | null;
  cnpj?: string | null;
  segmento: string;
  status: string;
  faturamento_faixa: string;
}

// ── Colors ──────────────────────────────────────────────────────
const C = {
  primary: '#1A3CFF', pLo: 'rgba(26,60,255,0.06)', pMd: 'rgba(26,60,255,0.14)', pHi: 'rgba(26,60,255,0.24)',
  cyan: '#0099E6', cyanLo: 'rgba(0,153,230,0.07)', cyanMd: 'rgba(0,153,230,0.15)', cyanBd: 'rgba(0,153,230,0.25)',
  green: '#00A86B', greenBg: 'rgba(0,168,107,0.07)',
  red: '#DC2626', redBg: 'rgba(220,38,38,0.07)',
  orange: '#D97706', orangeBg: 'rgba(217,119,6,0.07)',
  bg: '#F0F4FA', surface: '#FFFFFF', surfaceHi: '#F6F9FF', border: '#DDE4F0', borderStr: '#C4CFEA',
  txt: '#0D1B35', txtSec: '#4A5E80', txtMuted: '#8A9BBC',
  mono: "'Courier New', monospace",
};

// ── Helpers ─────────────────────────────────────────────────────
function getYearOptions() {
  const now = new Date();
  const years: string[] = [];
  for (let y = now.getFullYear(); y >= now.getFullYear() - 2; y--) years.push(String(y));
  return years;
}

function getMonthsForYear(year: string) {
  const months: { value: string; shortLabel: string }[] = [];
  for (let m = 0; m < 12; m++) {
    const d = new Date(Number(year), m, 1);
    months.push({
      value: `${year}-${String(m + 1).padStart(2, '0')}-01`,
      shortLabel: d.toLocaleDateString('pt-BR', { month: 'long' }).toUpperCase(),
    });
  }
  return months;
}

// ── Tree builder ────────────────────────────────────────────────
function buildDreTree(contas: ContaRow[]): DreNode[] {
  const map = new Map<string, DreNode>();
  const roots: DreNode[] = [];
  for (const c of contas) map.set(c.id, { conta: c, children: [] });
  for (const c of contas) {
    const node = map.get(c.id)!;
    if (c.conta_pai_id && map.has(c.conta_pai_id)) map.get(c.conta_pai_id)!.children.push(node);
    else roots.push(node);
  }
  const sort = (arr: DreNode[]) => { arr.sort((a, b) => a.conta.ordem - b.conta.ordem); arr.forEach(n => sort(n.children)); };
  sort(roots);
  return roots;
}

// ── DRE Sequence ────────────────────────────────────────────────
const SEQUENCIA_DRE: { tipo: string; totalizadorApos: string | null }[] = [
  { tipo: 'receita', totalizadorApos: null },
  { tipo: 'custo_variavel', totalizadorApos: 'MC' },
  { tipo: 'despesa_fixa', totalizadorApos: 'RO' },
  { tipo: 'investimento', totalizadorApos: 'RAI' },
  { tipo: 'financeiro', totalizadorApos: 'GC' },
];

const TOTALIZADOR_CONFIG: Record<string, { nome: string; key: string }> = {
  MC: { nome: '= MARGEM DE CONTRIBUIÇÃO', key: 'MC' },
  RO: { nome: '= RESULTADO OPERACIONAL', key: 'RO' },
  RAI: { nome: '= RESULTADO APÓS INVEST.', key: 'RAI' },
  GC: { nome: '= GERAÇÃO DE CAIXA', key: 'GC' },
};

// ── Calc helpers ────────────────────────────────────────────────
function sumNodeLeafs(node: DreNode, valMap: Record<string, number | null>): number | null {
  if (node.conta.nivel === 2) return valMap[node.conta.id] ?? null;
  let total = 0, hasAny = false;
  for (const child of node.children) {
    const v = sumNodeLeafs(child, valMap);
    if (v != null) { total += v; hasAny = true; }
  }
  return hasAny ? total : null;
}

function sumGrupos(grupos: DreNode[], valMap: Record<string, number | null>): number {
  let total = 0;
  for (const g of grupos) {
    const v = sumNodeLeafs(g, valMap);
    if (v != null) total += v;
  }
  return total;
}

function sumGruposProjetado(grupos: DreNode[], valMap: Record<string, number | null>, mMap: Record<string, TorreMeta>): number {
  let total = 0;
  for (const g of grupos) {
    const v = sumNodeProjetado(g, valMap, mMap);
    if (v != null) total += v;
  }
  return total;
}

function sumNodeProjetado(
  node: DreNode,
  valMap: Record<string, number | null>,
  mMap: Record<string, TorreMeta>,
): number | null {
  if (node.conta.nivel === 2) {
    const real = valMap[node.conta.id] ?? null;
    if (real == null) return null;
    const meta = mMap[node.conta.id] || null;
    const proj = calcProjetado(real, meta);
    return proj ?? real; // no meta → assume same as realized
  }
  let total = 0, hasAny = false;
  for (const child of node.children) {
    const v = sumNodeProjetado(child, valMap, mMap);
    if (v != null) { total += v; hasAny = true; }
  }
  return hasAny ? total : null;
}

// ── Status badge ────────────────────────────────────────────────
function StatusBadge({ status }: { status: 'ok' | 'atencao' | 'critico' | 'neutro' }) {
  const map = {
    ok: { label: 'NO PLANO', color: C.green, bg: C.greenBg, border: 'rgba(0,168,107,0.25)' },
    atencao: { label: 'ATENÇÃO', color: C.orange, bg: C.orangeBg, border: 'rgba(217,119,6,0.25)' },
    critico: { label: 'DESVIO', color: C.red, bg: C.redBg, border: 'rgba(220,38,38,0.25)' },
    neutro: { label: '—', color: C.txtMuted, bg: 'transparent', border: 'transparent' },
  };
  const s = map[status];
  return (
    <span style={{ fontSize: 8, fontWeight: 700, color: s.color, background: s.bg, border: `1px solid ${s.border}`, borderRadius: 4, padding: '2px 6px', letterSpacing: '0.06em' }}>
      {s.label}
    </span>
  );
}

// ── Editable meta cell ──────────────────────────────────────────
function EditableMetaCell({
  meta, contaId, clienteId, competencia, isTotal, onSaved, displayPct,
}: {
  meta: TorreMeta | null; contaId: string; clienteId: string; competencia: string; isTotal: boolean;
  onSaved: (contaId: string, metaTipo: 'pct' | 'valor', metaValor: number | null) => void;
  displayPct?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [localTipo, setLocalTipo] = useState<'pct' | 'valor'>(meta?.meta_tipo || 'pct');
  const [input, setInput] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  if (isTotal) return <span style={{ color: C.txtMuted, fontFamily: C.mono, fontSize: 12 }}>—</span>;

  const upsertAndPropagate = async (tipo: 'pct' | 'valor', valor: number | null) => {
    const { error } = await supabase.from('torre_metas').upsert(
      { cliente_id: clienteId, conta_id: contaId, competencia, meta_tipo: tipo, meta_valor: valor, updated_at: new Date().toISOString() },
      { onConflict: 'cliente_id,conta_id,competencia' }
    );
    if (error) { toast.error('Erro ao salvar meta'); return; }
    onSaved(contaId, tipo, valor);
  };

  const scheduleUpsert = (rawInput: string, tipo: 'pct' | 'valor') => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const cleaned = rawInput.replace(/[^\d.,-]/g, '').replace(',', '.');
      if (cleaned === '') { upsertAndPropagate(tipo, null); return; }
      const num = parseFloat(cleaned);
      if (!isNaN(num)) upsertAndPropagate(tipo, num);
    }, 600);
  };

  const commit = () => {
    clearTimeout(debounceRef.current);
    setEditing(false);
    const cleaned = input.replace(/[^\d.,-]/g, '').replace(',', '.');
    if (cleaned === '') { upsertAndPropagate(localTipo, null); return; }
    const num = parseFloat(cleaned);
    if (!isNaN(num)) upsertAndPropagate(localTipo, num);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    scheduleUpsert(val, localTipo);
  };

  const toggleTipo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = localTipo === 'pct' ? 'valor' : 'pct';
    setLocalTipo(next);
    if (meta && meta.meta_valor !== null) upsertAndPropagate(next, meta.meta_valor);
  };

  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button onClick={toggleTipo} style={{ fontSize: 9, fontWeight: 700, color: C.primary, background: C.pLo, border: `1px solid ${C.pMd}`, borderRadius: 4, padding: '1px 5px', cursor: 'pointer' }}>
          {localTipo === 'pct' ? '%' : 'R$'}
        </button>
        <input
          ref={ref}
          value={input}
          onChange={handleChange}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { clearTimeout(debounceRef.current); setEditing(false); } }}
          style={{ width: 70, textAlign: 'right', fontFamily: C.mono, fontSize: 12, border: `1px solid ${C.primary}`, borderRadius: 4, padding: '2px 6px', outline: 'none', background: C.surfaceHi }}
        />
      </span>
    );
  }

  if (!meta || meta.meta_valor === null) {
    return (
      <span
        onClick={() => { setEditing(true); setInput(''); setLocalTipo('pct'); }}
        style={{ cursor: 'pointer', fontSize: 11, color: C.txtMuted, borderBottom: '1px dashed', borderColor: C.txtMuted, padding: '1px 4px' }}
        onMouseEnter={e => (e.currentTarget.style.background = C.pLo)}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        + meta
      </span>
    );
  }

  const display = displayPct !== undefined
    ? `${displayPct >= 0 ? '+' : ''}${displayPct.toFixed(1)}%`
    : meta.meta_tipo === 'pct'
      ? `${meta.meta_valor! >= 0 ? '+' : ''}${meta.meta_valor}%`
      : fmtTorre(meta.meta_valor);

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} onClick={() => { setEditing(true); setInput(meta.meta_valor != null ? String(meta.meta_valor) : ''); setLocalTipo(meta.meta_tipo); }}>
      <button onClick={toggleTipo} style={{ fontSize: 9, fontWeight: 700, color: C.primary, background: C.pLo, border: `1px solid ${C.pMd}`, borderRadius: 4, padding: '1px 5px', cursor: 'pointer' }}>
        {meta.meta_tipo === 'pct' ? '%' : 'R$'}
      </button>
      <span style={{ fontFamily: C.mono, fontSize: 12, color: C.txt }}>{display}</span>
    </span>
  );
}

// ── Summary cards ───────────────────────────────────────────────
function SummaryCards({ counts, gcProjetado }: { counts: { ok: number; atencao: number; critico: number }; gcProjetado: number | null }) {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { const t = setTimeout(() => setRevealed(true), 1400); return () => clearTimeout(t); }, []);

  const cards = [
    { label: 'NO PLANO', value: String(counts.ok), color: C.green, delay: 0 },
    { label: 'ATENÇÃO', value: String(counts.atencao), color: C.orange, delay: 200 },
    { label: 'DESVIO CRÍTICO', value: String(counts.critico), color: C.red, delay: 400 },
    { label: 'GC PROJETADO', value: gcProjetado != null ? `R$ ${fmtTorre(gcProjetado)}` : '—', color: C.primary, delay: 600, isMono: true },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {cards.map((card, i) => (
        <div key={i} style={{
          background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 16,
          position: 'relative', overflow: 'hidden', minHeight: 80,
          animation: `fadeUp 0.5s ease ${card.delay}ms both`,
        }}>
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${card.color}, transparent)` }} />
          <p style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', color: C.txtMuted, marginBottom: 8, textTransform: 'uppercase' }}>{card.label}</p>
          {!revealed ? (
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 18, height: 18, border: `2px solid ${card.color}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                <AnalyzingDots color={card.color} />
              </div>
              <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: `linear-gradient(90deg, transparent, ${card.color}, transparent)`, animation: 'scanLine 0.7s ease infinite' }} />
            </div>
          ) : (
            <p style={{ fontSize: card.isMono ? 18 : 24, fontWeight: 800, color: card.color, fontFamily: card.isMono ? C.mono : 'inherit', animation: 'fadeUp 0.4s ease' }}>
              {card.value}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function AnalyzingDots({ color }: { color: string }) {
  const [dots, setDots] = useState('.');
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 400);
    return () => clearInterval(t);
  }, []);
  return <span style={{ fontSize: 10, fontWeight: 600, color, letterSpacing: '0.08em' }}>EM ANÁLISE{dots}</span>;
}

// ── Keyframes style tag ─────────────────────────────────────────
const keyframesCSS = `
@keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
@keyframes spin     { to{transform:rotate(360deg)} }
@keyframes scanLine { 0%{top:0;opacity:0} 20%{opacity:1} 80%{opacity:1} 100%{top:100%;opacity:0} }
@keyframes fadeUp   { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
@keyframes radarSweep { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
@keyframes dataPulse { 0%,100%{opacity:0.05} 50%{opacity:0.15} }
@keyframes scanHorizontal { 0%{left:-30%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{left:110%;opacity:0} }
@keyframes scanHorizontal2 { 0%{left:-20%;opacity:0} 15%{opacity:0.6} 85%{opacity:0.6} 100%{left:115%;opacity:0} }
@keyframes floatUp { 0%{transform:translateY(0) scale(1);opacity:0} 8%{opacity:0.85} 70%{opacity:0.5} 100%{transform:translateY(-150px) scale(0.7);opacity:0} }
@keyframes floatDrift { 0%{transform:translate(0,0) scale(1);opacity:0} 10%{opacity:0.8} 75%{opacity:0.4} 100%{transform:translate(35px,-130px) scale(0.6);opacity:0} }
@keyframes glowPulse { 0%,100%{opacity:0.5;filter:drop-shadow(0 0 2px rgba(0,153,230,0.3))} 50%{opacity:1;filter:drop-shadow(0 0 8px rgba(0,153,230,0.8))} }
@keyframes signalWave { 0%{r:8;opacity:0.6} 100%{r:28;opacity:0} }
@keyframes propagateBorder { 0%{border-left-color:rgba(0,153,230,0.9)} 100%{border-left-color:transparent} }
@keyframes propagateLabel { 0%{opacity:1} 70%{opacity:1} 100%{opacity:0} }
`;

const DATA_PARTICLES = [
  { text: '3.2M', left: '12%', delay: '0s', dur: '3s', anim: 'floatUp' },
  { text: '+12%', left: '25%', delay: '0.8s', dur: '3.4s', anim: 'floatDrift' },
  { text: '847K', left: '38%', delay: '1.8s', dur: '2.8s', anim: 'floatUp' },
  { text: '−5.3%', left: '52%', delay: '0.4s', dur: '3.6s', anim: 'floatDrift' },
  { text: '1.4M', left: '65%', delay: '2.5s', dur: '2.9s', anim: 'floatUp' },
  { text: '+8.7%', left: '78%', delay: '1.2s', dur: '3.2s', anim: 'floatDrift' },
  { text: '92K', left: '45%', delay: '2.8s', dur: '3.5s', anim: 'floatUp' },
  { text: '◈', left: '88%', delay: '1.5s', dur: '4s', anim: 'floatDrift' },
  { text: '2.1M', left: '8%', delay: '2.2s', dur: '3.1s', anim: 'floatDrift' },
  { text: '+24%', left: '70%', delay: '0.2s', dur: '3.8s', anim: 'floatUp' },
  { text: '560K', left: '18%', delay: '1.6s', dur: '3.3s', anim: 'floatUp' },
  { text: '−2.1%', left: '58%', delay: '3s', dur: '3s', anim: 'floatDrift' },
  { text: '4.8M', left: '82%', delay: '0.5s', dur: '3.7s', anim: 'floatUp' },
];

// ══════════════════════════════════════════════════════════════════
interface Props { clienteId: string }

export function TorreControleTab({ clienteId }: Props) {
  const qc = useQueryClient();
  const years = getYearOptions();
  const [ano, setAno] = useState(years[0]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [modoMeta, setModoMeta] = useState(false);
  const [modoAnaliseMeta, setModoAnaliseMeta] = useState(false);
  const [mesSelecionado, setMesSelecionado] = useState<string | null>(null);
  const [showAV, setShowAV] = useState(false);
  const [showAH, setShowAH] = useState(false);
  const [drawerSugestaoOpen, setDrawerSugestaoOpen] = useState(false);
  const [sugestoes, setSugestoes] = useState<SugestaoMeta[]>([]);
  const [loadingSugestao, setLoadingSugestao] = useState(false);
  const [sugestaoGeradaEm, setSugestaoGeradaEm] = useState<string | null>(null);
  const [sugestaoFromCache, setSugestaoFromCache] = useState(false);
  const [narrativa, setNarrativa] = useState<string | null>(null);
  const [diretrizSalva, setDiretrizSalva] = useState<string | null>(null);
  const [propagatedCells, setPropagatedCells] = useState<Set<string>>(new Set());
  const [chatOpen, setChatOpen] = useState(false);
  const [showCreationAV, setShowCreationAV] = useState(false);
  const [showCreationAH, setShowCreationAH] = useState(false);
  const propagateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const months = useMemo(() => getMonthsForYear(ano), [ano]);

  // ── Fetch cliente ─────────────────────────────────────────────
  const { data: cliente } = useQuery({
    queryKey: ['cliente-torre', clienteId],
    queryFn: async () => {
      const { data } = await supabase.from('clientes').select('id, nome_empresa, razao_social, cnpj, segmento, status, faturamento_faixa').eq('id', clienteId).single();
      return data as Cliente | null;
    },
  });

  // ── Data queries ──────────────────────────────────────────────
  const { data: contas, isLoading: loadingContas } = useQuery({
    queryKey: ['plano-contas-torre', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const contaIds = useMemo(() => contas?.map(c => c.id) || [], [contas]);

  // Fetch ALL months of the year (like DRE)
  const { data: valoresAnuais, isLoading: loadingValores } = useQuery({
    queryKey: ['valores-mensais-torre-anual', clienteId, ano, contaIds.length],
    enabled: !!clienteId && contaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('valores_mensais').select('conta_id, competencia, valor_realizado').in('conta_id', contaIds).gte('competencia', `${ano}-01-01`).lte('competencia', `${ano}-12-31`);
      return data || [];
    },
  });

  // Values map: contaId -> competencia -> value
  const valoresMap = useMemo(() => {
    const map: Record<string, Record<string, number | null>> = {};
    valoresAnuais?.forEach(v => {
      if (!map[v.conta_id]) map[v.conta_id] = {};
      map[v.conta_id][v.competencia] = v.valor_realizado;
    });
    return map;
  }, [valoresAnuais]);

  // Months with data
  const monthsWithData = useMemo(() => {
    return months.filter(m => valoresAnuais?.some(v => v.competencia === m.value && v.valor_realizado != null));
  }, [months, valoresAnuais]);

  // Effective selected month
  const mesEfetivo = useMemo(() => {
    if (mesSelecionado && monthsWithData.some(m => m.value === mesSelecionado)) return mesSelecionado;
    return monthsWithData.length > 0 ? monthsWithData[monthsWithData.length - 1].value : null;
  }, [mesSelecionado, monthsWithData]);

  const mesSeg = useMemo(() => mesEfetivo ? getMesSeguinte(mesEfetivo) : '', [mesEfetivo]);

  // Metas for mesSeg (next month after selected)
  const { data: metas, isLoading: loadingMetas } = useQuery({
    queryKey: ['torre-metas', clienteId, mesSeg],
    enabled: !!clienteId && !!mesSeg && (modoMeta || modoAnaliseMeta),
    queryFn: async () => {
      const { data } = await supabase.from('torre_metas').select('conta_id, meta_tipo, meta_valor').eq('cliente_id', clienteId).eq('competencia', mesSeg);
      return (data || []) as TorreMeta[];
    },
  });

  const invalidateMetas = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['torre-metas', clienteId, mesSeg] });
  }, [qc, clienteId, mesSeg]);

  const metaMap = useMemo(() => {
    const map: Record<string, TorreMeta> = {};
    metas?.forEach(m => { map[m.conta_id] = m; });
    return map;
  }, [metas]);

  // ── All-year metas (for TODOS mode) ──────────────────────────
  const { data: metasAno } = useQuery({
    queryKey: ['torre-metas-ano', clienteId, ano],
    enabled: !!clienteId && (modoMeta || modoAnaliseMeta),
    queryFn: async () => {
      const { data } = await supabase.from('torre_metas').select('conta_id, meta_tipo, meta_valor, competencia')
        .eq('cliente_id', clienteId)
        .gte('competencia', `${ano}-01-01`)
        .lte('competencia', `${ano}-12-31`);
      return (data || []) as (TorreMeta & { competencia: string })[];
    },
  });

  const metaMapByComp = useMemo(() => {
    const map: Record<string, Record<string, TorreMeta>> = {};
    (metasAno || []).forEach(m => {
      if (!map[m.competencia]) map[m.competencia] = {};
      map[m.competencia][m.conta_id] = m;
    });
    return map;
  }, [metasAno]);

  const monthsWithMetas = useMemo(() => new Set(Object.keys(metaMapByComp)), [metaMapByComp]);

  // Reference months for CRIAÇÃO DE METAS filtered mode (all months with data before selected)
  const refMonths = useMemo(() => {
    if (!modoMeta || !mesEfetivo || mesSelecionado === null) return [] as { value: string; shortLabel: string }[];
    return monthsWithData.filter(m => m.value < mesEfetivo);
  }, [modoMeta, mesEfetivo, mesSelecionado, monthsWithData]);

  // ── Tree ──────────────────────────────────────────────────────
  const tree = useMemo(() => contas ? buildDreTree(contas) : [], [contas]);

  const gruposPorTipo = useMemo(() => {
    const map: Record<string, DreNode[]> = {};
    for (const node of tree) {
      const tipo = node.conta.tipo;
      if (!map[tipo]) map[tipo] = [];
      map[tipo].push(node);
    }
    return map;
  }, [tree]);

  // Get month map for a given competencia
  const getMonthMap = useCallback((comp: string): Record<string, number | null> => {
    const map: Record<string, number | null> = {};
    contas?.forEach(c => { map[c.id] = valoresMap[c.id]?.[comp] ?? null; });
    return map;
  }, [contas, valoresMap]);

  // Realized map for selected month (for meta calculations)
  const realizadoMapSel = useMemo(() => mesEfetivo ? getMonthMap(mesEfetivo) : {}, [mesEfetivo, getMonthMap]);

  // AV% helper: get faturamento for a given month map
  const getFatForMap = useCallback((valMap: Record<string, number | null>): number => {
    return sumGrupos(gruposPorTipo['receita'] || [], valMap);
  }, [gruposPorTipo]);

  // AV% formatter
  const fmtAv = (val: number | null, fat: number): string | null => {
    if (val == null || fat === 0) return null;
    return ((Math.abs(val) / Math.abs(fat)) * 100).toFixed(1) + '%';
  };

  // AV% semantic color for row cells
  const avColor = (tipo: string): string => tipo === 'receita' ? '#0D1B35' : '#DC2626';
  // AV% semantic color for totalizador cells
  const avTotColor = (v: number): string => v < 0 ? '#FF6B6B' : '#00E68A';

  // AH% (Horizontal Analysis) helpers
  const fmtAh = (valAtual: number | null, valAnterior: number | null): string | null => {
    if (valAtual == null || valAnterior == null || valAnterior === 0) return null;
    return (((valAtual - valAnterior) / Math.abs(valAnterior)) * 100).toFixed(1) + '%';
  };
  const ahColor = (valAtual: number | null, valAnterior: number | null, tipo: string): string => {
    if (valAtual == null || valAnterior == null) return C.txtMuted;
    const diff = valAtual - valAnterior;
    if (diff === 0) return C.txtMuted;
    const isReceita = tipo === 'receita';
    if (isReceita) return diff > 0 ? '#00A86B' : '#DC2626';
    return diff < 0 ? '#00A86B' : '#DC2626';
  };
  const ahTotColor = (valAtual: number, valAnterior: number): string => {
    const diff = valAtual - valAnterior;
    if (diff === 0) return C.txtMuted;
    return diff > 0 ? '#00E68A' : '#FF6B6B';
  };

  // Direction arrow for META columns: compares meta vs realized
  const getMetaArrow = (metaVal: number | null, realVal: number | null, tipo: string): { arrow: string; color: string } | null => {
    if (metaVal == null || realVal == null) return null;
    if (tipo === 'financeiro') return null;
    const isReceita = tipo === 'receita';
    if (metaVal === realVal) return { arrow: '→', color: '#8A9BBC' };
    if (isReceita) {
      return metaVal > realVal ? { arrow: '↑', color: '#00A86B' } : { arrow: '↓', color: '#DC2626' };
    }
    // custo_variavel, despesa_fixa, investimento: lower is better
    return metaVal < realVal ? { arrow: '↓', color: '#00A86B' } : { arrow: '↑', color: '#DC2626' };
  };
  // Direction arrow for totalizador META: higher is always better
  const getTotArrow = (metaVal: number, realVal: number): { arrow: string; color: string } | null => {
    if (metaVal === realVal) return { arrow: '→', color: '#8A9BBC' };
    return metaVal > realVal ? { arrow: '↑', color: '#00A86B' } : { arrow: '↓', color: '#DC2626' };
  };

  // ── Propagation handler ───────────────────────────────────────
  const handleMetaSaved = useCallback(async (contaId: string, metaTipo: 'pct' | 'valor', metaValor: number | null) => {
    if (!contas || !clienteId || !mesSeg) { invalidateMetas(); return; }
    const conta = contas.find(c => c.id === contaId);
    if (!conta || metaValor === null) { invalidateMetas(); return; }

    const newPropagated = new Set<string>();
    const updatedMetaMap: Record<string, TorreMeta> = { ...metaMap, [contaId]: { conta_id: contaId, meta_tipo: metaTipo, meta_valor: metaValor } };

    if (conta.nivel === 2) {
      // ── BOTTOM-UP: category → subgroup → group ──
      const parent = contas.find(c => c.id === conta.conta_pai_id);
      if (parent) {
        const siblings = contas.filter(c => c.conta_pai_id === parent.id);
        let sumMeta = 0, sumReal = 0;
        for (const sib of siblings) {
          const real = realizadoMapSel[sib.id] ?? 0;
          sumReal += real;
          const m = updatedMetaMap[sib.id] || null;
          const proj = m ? calcProjetado(real, m) : null;
          sumMeta += proj ?? real;
        }
        const pctParent = sumReal !== 0 ? Math.round(((sumMeta / sumReal) - 1) * 10000) / 100 : 0;
        await supabase.from('torre_metas').upsert({
          cliente_id: clienteId, conta_id: parent.id, competencia: mesSeg,
          meta_tipo: 'pct', meta_valor: pctParent, updated_at: new Date().toISOString(),
        }, { onConflict: 'cliente_id,conta_id,competencia' });
        newPropagated.add(parent.id);
        updatedMetaMap[parent.id] = { conta_id: parent.id, meta_tipo: 'pct', meta_valor: pctParent };

        const grandparent = contas.find(c => c.id === parent.conta_pai_id);
        if (grandparent) {
          const uncles = contas.filter(c => c.conta_pai_id === grandparent.id);
          let sumMetaGP = 0, sumRealGP = 0;
          for (const uncle of uncles) {
            const nephews = contas.filter(c => c.conta_pai_id === uncle.id);
            for (const neph of nephews) {
              const r = realizadoMapSel[neph.id] ?? 0;
              sumRealGP += r;
              const m = updatedMetaMap[neph.id] || null;
              const proj = m ? calcProjetado(r, m) : null;
              sumMetaGP += proj ?? r;
            }
          }
          const pctGP = sumRealGP !== 0 ? Math.round(((sumMetaGP / sumRealGP) - 1) * 10000) / 100 : 0;
          await supabase.from('torre_metas').upsert({
            cliente_id: clienteId, conta_id: grandparent.id, competencia: mesSeg,
            meta_tipo: 'pct', meta_valor: pctGP, updated_at: new Date().toISOString(),
          }, { onConflict: 'cliente_id,conta_id,competencia' });
          newPropagated.add(grandparent.id);
        }
      }
    } else {
      // ── TOP-DOWN: group/subgroup → children (+ grandchildren if grupo) ──
      let pctToApply: number;
      if (metaTipo === 'pct') {
        pctToApply = metaValor;
      } else {
        const findNode = (nodes: DreNode[], id: string): DreNode | null => {
          for (const n of nodes) { if (n.conta.id === id) return n; const f = findNode(n.children, id); if (f) return f; } return null;
        };
        const node = findNode(tree, contaId);
        const nodeReal = node ? sumNodeLeafs(node, realizadoMapSel) : null;
        if (nodeReal && nodeReal !== 0) {
          const proj = calcProjetado(nodeReal, { conta_id: contaId, meta_tipo: 'valor', meta_valor: metaValor });
          pctToApply = proj != null ? Math.round(((proj / nodeReal) - 1) * 10000) / 100 : 0;
        } else {
          pctToApply = 0;
        }
      }

      const children = contas.filter(c => c.conta_pai_id === contaId);
      const upserts: { cliente_id: string; conta_id: string; competencia: string; meta_tipo: string; meta_valor: number; updated_at: string }[] = [];
      for (const child of children) {
        upserts.push({ cliente_id: clienteId, conta_id: child.id, competencia: mesSeg, meta_tipo: 'pct', meta_valor: pctToApply, updated_at: new Date().toISOString() });
        newPropagated.add(child.id);
        if (conta.nivel === 0) {
          const grandchildren = contas.filter(c => c.conta_pai_id === child.id);
          for (const gc of grandchildren) {
            upserts.push({ cliente_id: clienteId, conta_id: gc.id, competencia: mesSeg, meta_tipo: 'pct', meta_valor: pctToApply, updated_at: new Date().toISOString() });
            newPropagated.add(gc.id);
          }
        }
      }
      if (upserts.length > 0) {
        await supabase.from('torre_metas').upsert(upserts, { onConflict: 'cliente_id,conta_id,competencia' });
      }
    }

    if (newPropagated.size > 0) {
      setPropagatedCells(newPropagated);
      if (propagateTimerRef.current) clearTimeout(propagateTimerRef.current);
      propagateTimerRef.current = setTimeout(() => setPropagatedCells(new Set()), 1500);
    }
    invalidateMetas();
  }, [contas, clienteId, mesSeg, realizadoMapSel, metaMap, tree, invalidateMetas]);

  const calcTotaisForMap = useCallback((valMap: Record<string, number | null>) => {
    const fat = sumGrupos(gruposPorTipo['receita'] || [], valMap);
    const custos = sumGrupos(gruposPorTipo['custo_variavel'] || [], valMap);
    const mc = fat + custos;
    const despesas = sumGrupos(gruposPorTipo['despesa_fixa'] || [], valMap);
    const ro = mc + despesas;
    const invest = sumGrupos(gruposPorTipo['investimento'] || [], valMap);
    const rai = ro + invest;
    const financ = sumGrupos(gruposPorTipo['financeiro'] || [], valMap);
    const gc = rai + financ;
    return { fat, MC: mc, RO: ro, RAI: rai, GC: gc };
  }, [gruposPorTipo]);

  // ── Totalizador projetado calc ────────────────────────────────
  const calcTotaisProjetado = useCallback(() => {
    const fat = sumGruposProjetado(gruposPorTipo['receita'] || [], realizadoMapSel, metaMap);
    const custos = sumGruposProjetado(gruposPorTipo['custo_variavel'] || [], realizadoMapSel, metaMap);
    const mc = fat + custos;
    const despesas = sumGruposProjetado(gruposPorTipo['despesa_fixa'] || [], realizadoMapSel, metaMap);
    const ro = mc + despesas;
    const invest = sumGruposProjetado(gruposPorTipo['investimento'] || [], realizadoMapSel, metaMap);
    const rai = ro + invest;
    const financ = sumGruposProjetado(gruposPorTipo['financeiro'] || [], realizadoMapSel, metaMap);
    const gc = rai + financ;
    return { fat, MC: mc, RO: ro, RAI: rai, GC: gc };
  }, [gruposPorTipo, realizadoMapSel, metaMap]);

  // ── Status counts (based on selected month) ──────────────────
  const statusCounts = useMemo(() => {
    const counts = { ok: 0, atencao: 0, critico: 0 };
    if (!contas || !(modoMeta || modoAnaliseMeta)) return counts;
    for (const c of contas) {
      if (c.nivel !== 2 || c.is_total) continue;
      const meta = metaMap[c.id] || null;
      const base = realizadoMapSel[c.id];
      if (!meta || meta.meta_valor === null || base == null) continue;
      const projetado = calcProjetado(base, meta);
      const isReceita = c.tipo === 'receita';
      const s = calcStatus(base, projetado, isReceita);
      if (s === 'ok' || s === 'atencao' || s === 'critico') counts[s]++;
    }
    return counts;
  }, [contas, metaMap, realizadoMapSel, modoMeta, modoAnaliseMeta]);

  // ── GC projetado ──────────────────────────────────────────────
  const gcProjetado = useMemo(() => {
    if (!contas || !(modoMeta || modoAnaliseMeta)) return null;
    let total = 0;
    let hasAny = false;
    for (const c of contas) {
      if (c.nivel !== 2 || c.is_total) continue;
      const base = realizadoMapSel[c.id];
      if (base == null) continue;
      const meta = metaMap[c.id] || null;
      const proj = meta ? calcProjetado(base, meta) : base;
      if (proj != null) { total += proj; hasAny = true; }
    }
    return hasAny ? total : null;
  }, [contas, metaMap, realizadoMapSel, modoMeta, modoAnaliseMeta]);

// ── Ajuste% dinâmico para N0/N1 ─────────────────────────────
  const calcAjustePctNode = useCallback((node: DreNode): number => {
    const sumReal = (n: DreNode): number => {
      if (n.conta.nivel === 2) return realizadoMapSel[n.conta.id] ?? 0;
      return n.children.reduce((acc, c) => acc + sumReal(c), 0);
    };
    const real = sumReal(node);
    const proj = sumNodeProjetado(node, realizadoMapSel, metaMap);
    if (real === 0 || proj == null) return 0;
    return ((proj - real) / Math.abs(real)) * 100;
  }, [realizadoMapSel, metaMap]);

  // ── Variation (R$) helper ─────────────────────────────────────
  const calcVariacao = useCallback((node: DreNode): number | null => {
    const conta = node.conta;
    if (conta.nivel === 2) {
      const meta = metaMap[conta.id] || null;
      const real = realizadoMapSel[conta.id] ?? null;
      if (!meta || meta.meta_valor === null || real == null) return null;
      const proj = calcProjetado(real, meta);
      if (proj == null) return null;
      return proj - real;
    }
    let total = 0;
    let hasAny = false;
    for (const child of node.children) {
      const v = calcVariacao(child);
      if (v != null) { total += v; hasAny = true; }
    }
    return hasAny ? total : null;
  }, [metaMap, realizadoMapSel]);

  // ── Sugestão metas handler ────────────────────────────────────
  const handleSugerirMetas = async (forcarRegeneracao = false, diretriz?: string) => {
    if (!cliente || !mesEfetivo) return;
    setLoadingSugestao(true);
    setDrawerSugestaoOpen(true);
    if (forcarRegeneracao) setSugestoes([]);
    try {
      const mesAnt = (() => { const d = new Date(mesEfetivo + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`; })();
      const body: any = {
        cliente_id: cliente.id,
        competencia: mesEfetivo,
        competencia_anterior: mesAnt,
        force: forcarRegeneracao,
      };
      if (diretriz) body.diretriz = diretriz;
      const { data, error } = await supabase.functions.invoke('sugerir-metas', { body });
      if (error) throw error;
      const contaMap = new Map((contas || []).map(c => [c.id, c]));
      const enriched: SugestaoMeta[] = (data?.sugestoes || []).map((s: any) => ({
        ...s,
        conta_nome: s.conta_nome || contaMap.get(s.conta_id)?.nome || '',
        nivel: s.nivel ?? (contaMap.get(s.conta_id)?.nivel ?? 2),
        motivo: s.motivo || s.justificativa || '',
        objetivo: s.objetivo || '',
        parametros: s.parametros || [],
        impacto_gc: s.impacto_gc || '',
        confianca: (s.confianca === 'média' ? 'media' : s.confianca) as SugestaoMeta['confianca'],
      }));
      setSugestoes(enriched);
      setNarrativa(data?.narrativa || null);
      setSugestaoGeradaEm(data?.gerado_em || null);
      setSugestaoFromCache(data?.cached || false);
      setDiretrizSalva(data?.diretriz || null);
    } catch (err) {
      console.error('Erro ao sugerir metas:', err);
      toast.error('Erro ao obter sugestões de metas');
      setSugestoes([]);
    } finally {
      setLoadingSugestao(false);
    }
  };

  const handleAplicarSugestoes = async (selecionadas: SugestaoMeta[]) => {
    if (!cliente) return;
    const upserts = selecionadas.map(s => ({
      cliente_id: cliente.id,
      conta_id: s.conta_id,
      competencia: mesSeg,
      meta_tipo: s.meta_tipo,
      meta_valor: s.meta_valor,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase.from('torre_metas').upsert(upserts, { onConflict: 'cliente_id,conta_id,competencia' });
    if (error) {
      toast.error('Erro ao salvar metas');
      return;
    }
    toast.success(`${selecionadas.length} metas aplicadas com sucesso`);
    setDrawerSugestaoOpen(false);

    // Run bottom-up propagation for all N2 (category) metas applied
    const categoriasAplicadas = selecionadas.filter(s => s.nivel === 2);
    for (const cat of categoriasAplicadas) {
      await handleMetaSaved(cat.conta_id, cat.meta_tipo, cat.meta_valor);
    }

    invalidateMetas();
  };

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const hasContas = contas && contas.length > 0;
  const hasAnyData = useMemo(() => valoresAnuais?.some(v => v.valor_realizado != null) ?? false, [valoresAnuais]);
  const isLoading = loadingContas || loadingValores;

  // Month nav for selector
  const navMesSel = (dir: -1 | 1) => {
    const idx = monthsWithData.findIndex(m => m.value === mesEfetivo);
    const next = idx + dir;
    if (next >= 0 && next < monthsWithData.length) setMesSelecionado(monthsWithData[next].value);
  };

  const mesSegShort = useMemo(() => {
    if (!mesSeg) return '';
    const d = new Date(mesSeg + 'T12:00:00Z');
    return d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
  }, [mesSeg]);
  const mesSegLabel = mesSeg ? fmtCompetencia(mesSeg) : '';

  // ── Column layout ─────────────────────────────────────────────
  const valColW = 80;
  const nameColW = 280;
  const metaColW = 90;
  const rsColW = 90;
  const metaProjetadoColW = 110;
  const avColW = 72;

  const isModoAtivo = modoMeta || modoAnaliseMeta;
  const isTodosMode = mesSelecionado === null;
  const isMonthFiltered = isModoAtivo && !isTodosMode;
  const displayMonths = isMonthFiltered ? months.filter(m => m.value === mesEfetivo) : months;

  const getPrevMonth = (comp: string): string => {
    const d = new Date(comp + 'T12:00:00Z');
    d.setUTCMonth(d.getUTCMonth() - 1);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  };

  // Sticky cell style
  const stickyTd = (bg: string, extra?: React.CSSProperties): React.CSSProperties => ({
    position: 'sticky',
    left: 0,
    zIndex: 10,
    background: bg,
    borderRight: '1px solid #DDE4F0',
    minWidth: nameColW,
    maxWidth: 320,
    ...extra,
  });

  const isSelectedMonth = (comp: string) => comp === mesEfetivo;

  // ── Render row helpers ────────────────────────────────────────
  const renderRow = (node: DreNode, depth: number) => {
    const conta = node.conta;
    const isGrupo = conta.nivel === 0;
    const isSubgrupo = conta.nivel === 1;
    const isCat = conta.nivel === 2;
    const isTotal = !!conta.is_total;
    const hasChildren = node.children.length > 0;
    const isCollapsedItem = collapsed.has(conta.id);

    // Rule 1: Hide zeroed N2 categories in meta modes
    if (isModoAtivo && isCat && !isTotal) {
      if (!isTodosMode) {
        const val = realizadoMapSel[conta.id];
        if (val == null || val === 0) return null;
      } else {
        const hasAnyVal = months.some(m => {
          const v = valoresMap[conta.id]?.[m.value];
          return v != null && v !== 0;
        });
        if (!hasAnyVal) return null;
      }
    }

    const paddingLeft = isGrupo ? 12 : isSubgrupo ? 24 : 48;

    // Row styling
    let rowBg = '#FAFCFF';
    let fontWeight = 400;
    let fontSize = 12;
    let textColor = '#4A5E80';
    let borderTop = 'none';
    let borderBottom = '1px solid #F8F9FB';
    let letterSpacing: string | undefined = undefined;
    let textTransform: 'uppercase' | 'none' = 'none';

    if (isTotal) {
      rowBg = '#0D1B35'; fontWeight = 700; fontSize = 12; textColor = '#FFFFFF'; borderTop = 'none'; borderBottom = 'none';
    } else if (isGrupo) {
      rowBg = '#F0F4FA'; fontWeight = 700; fontSize = 12; textColor = '#0D1B35'; borderTop = '1px solid #C4CFEA'; borderBottom = '1px solid #C4CFEA'; letterSpacing = '0.04em'; textTransform = 'uppercase';
    } else if (isSubgrupo) {
      rowBg = '#FFFFFF'; fontWeight = 600; fontSize = 12; textColor = '#0D1B35'; borderBottom = '1px solid #F0F4FA';
    }

    // Meta info for selected month
    const meta = metaMap[conta.id] || null;
    const hasMeta = meta && meta.meta_valor !== null;
    const realSel = realizadoMapSel[conta.id] ?? (isCat ? null : sumNodeLeafs(node, realizadoMapSel));
    const projetado = isCat
      ? (realSel != null ? calcProjetado(realSel, meta) : null)
      : sumNodeProjetado(node, realizadoMapSel, metaMap);
    const isReceita = conta.tipo === 'receita' || conta.nome.trim().startsWith('(+)');
    const status = realSel != null ? calcStatus(realSel, projetado, isReceita) : 'neutro';

    // Análise meta: compare realized vs meta (saved in torre_metas for this month = mesSeg, but we compare against selected month realizado)
    // The meta stored is for mesSeg (projetado). For ANÁLISE META we need the meta that was set for the selected month.
    // Actually let's re-read: ANÁLISE META shows meta column and colors the realized cell.

    const isPropagated = propagatedCells.has(conta.id);

    return (
      <Fragment key={conta.id}>
        <tr
          style={{
            background: rowBg, borderTop, borderBottom, transition: 'background 0.1s ease',
            borderLeft: isPropagated ? '2px solid #0099E6' : '2px solid transparent',
            animation: isPropagated ? 'propagateBorder 1.2s ease-out forwards' : undefined,
            position: 'relative',
          }}
          onMouseEnter={e => { if (!isTotal) e.currentTarget.style.background = '#F6F9FF'; }}
          onMouseLeave={e => { e.currentTarget.style.background = rowBg; }}
        >
          {/* Expand + Name (sticky) */}
          <td style={{
            ...stickyTd(rowBg, { padding: `8px 8px 8px ${paddingLeft}px`, fontWeight, fontSize, color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {hasChildren && !isTotal && (isGrupo || isSubgrupo) ? (
                <button onClick={() => toggleCollapse(conta.id)} style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 2, lineHeight: 0, color: C.txtMuted, flexShrink: 0 }}>
                  {isCollapsedItem ? <ChevronRight style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
                </button>
              ) : <span style={{ width: 18 }} />}
              {isTotal && <span style={{ color: C.cyan, fontSize: 13 }}>◈</span>}
              <span style={{ letterSpacing, textTransform: isGrupo && !isTotal ? textTransform : undefined }}>{conta.nome}</span>
              {isPropagated && (
                <span style={{ fontSize: 8, color: '#0099E6', fontWeight: 700, marginLeft: 6, animation: 'propagateLabel 1.5s ease-out forwards', letterSpacing: '0.04em' }}>
                  ↑ propagado
                </span>
              )}
            </span>
          </td>

          {/* Month columns */}
          {displayMonths.map(m => {
            const monthMap = getMonthMap(m.value);
            let val: number | null = null;
            if (isCat) {
              val = monthMap[conta.id] ?? null;
            } else {
              val = sumNodeLeafs(node, monthMap);
            }

            const isSel = isSelectedMonth(m.value);
            const selBg = isSel && isModoAtivo && !isTodosMode ? (isTotal ? '#0D1B35' : 'rgba(26,60,255,0.06)') : undefined;

            // Análise meta coloring
            let cellColor = val != null ? (val < 0 ? '#DC2626' : (isTotal ? '#FFFFFF' : '#0D1B35')) : (isTotal ? '#8A9BBC' : C.txtMuted);
            let cellBg = selBg;
            if (modoAnaliseMeta && isSel && !isTodosMode && isCat && !isTotal && val != null && projetado != null) {
              const metaAtingida = isReceita ? val >= projetado : Math.abs(val) <= Math.abs(projetado);
              if (metaAtingida) {
                cellColor = '#00A86B';
                cellBg = 'rgba(0,168,107,0.06)';
              } else {
                cellColor = '#DC2626';
                cellBg = 'rgba(220,38,38,0.04)';
              }
            }

            // TODOS mode: META column for this month
            const hasMetaForMonth = isTodosMode && isModoAtivo && monthsWithMetas.has(m.value);
            const metaMapForMonth = hasMetaForMonth ? metaMapByComp[m.value] : null;

            return (
              <Fragment key={m.value}>
                <td style={{
                  textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                  fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400),
                  color: cellColor,
                  padding: '8px 10px',
                  background: cellBg,
                }}>
                  {fmtTorre(val)}
                </td>

                {/* AV% after realized in TODOS mode */}
                {showAV && isTodosMode && (() => {
                  const monthMap = getMonthMap(m.value);
                  const fat = getFatForMap(monthMap);
                  const avStr = fmtAv(val, fat);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color: avColor(conta.tipo), width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? '#0D1B35' : 'rgba(26,60,255,0.06)' }}>
                      {avStr || '—'}
                    </td>
                  );
                })()}

                {/* AV% after realized in ANÁLISE META (filtered month) */}
                {showAV && modoAnaliseMeta && isSel && !isTodosMode && (() => {
                  const monthMap = getMonthMap(m.value);
                  const fat = getFatForMap(monthMap);
                  const avStr = fmtAv(val, fat);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color: avColor(conta.tipo), width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? '#0D1B35' : 'rgba(26,60,255,0.06)' }}>
                      {avStr || '—'}
                    </td>
                  );
                })()}

                {/* ANÁLISE META: META column after selected month (specific month only) */}
                {modoAnaliseMeta && isSel && !isTodosMode && (
                  <td style={{
                    textAlign: 'right', fontFamily: C.mono, fontSize: 12,
                    fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400),
                    color: projetado != null ? (projetado < 0 ? '#DC2626' : (isTotal ? '#FFFFFF' : '#0D1B35')) : (isTotal ? '#8A9BBC' : C.txtMuted),
                    padding: '8px 10px',
                    background: isTotal ? 'rgba(26,60,255,0.18)' : 'rgba(26,60,255,0.03)',
                    borderLeft: isTotal ? undefined : '1px solid rgba(26,60,255,0.10)',
                  }}>
                    {(() => {
                      const ar = getMetaArrow(projetado, val, conta.tipo);
                      if (ar) return <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{fmtTorre(projetado)}</>;
                      return fmtTorre(projetado);
                    })()}
                  </td>
                )}

                {/* AV% after META in ANÁLISE META (filtered month) */}
                {showAV && modoAnaliseMeta && isSel && !isTodosMode && (() => {
                  const projTotais = calcTotaisProjetado();
                  const fatMeta = projTotais.fat;
                  const avStr = fmtAv(projetado, fatMeta);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color: avColor(conta.tipo), width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? '#0D1B35' : undefined }}>
                      {(() => {
                        const ar = getMetaArrow(projetado, val, conta.tipo);
                        if (ar && avStr) return <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{avStr}</>;
                        return avStr || '—';
                      })()}
                    </td>
                  );
                })()}

                {/* AV% after realized in CRIAÇÃO DE METAS (filtered month) */}
                {showAV && modoMeta && isSel && !isTodosMode && (() => {
                  const monthMap = getMonthMap(m.value);
                  const fat = getFatForMap(monthMap);
                  const avStr = fmtAv(val, fat);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color: avColor(conta.tipo), width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? '#0D1B35' : 'rgba(26,60,255,0.06)' }}>
                      {avStr || '—'}
                    </td>
                  );
                })()}

                {/* AH% after realized in CRIAÇÃO DE METAS (filtered month) */}
                {showAH && modoMeta && isSel && !isTodosMode && (() => {
                  const prevComp = getPrevMonth(m.value);
                  const prevMap = getMonthMap(prevComp);
                  const prevVal = isCat ? (prevMap[conta.id] ?? null) : sumNodeLeafs(node, prevMap);
                  const ahStr = fmtAh(val, prevVal);
                  const color = isTotal ? (val != null && prevVal != null ? ahTotColor(val, prevVal) : C.txtMuted) : ahColor(val, prevVal, conta.tipo);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color, width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? '#0D1B35' : 'rgba(26,60,255,0.06)' }}>
                      {ahStr || '—'}
                    </td>
                  );
                })()}

                {/* META mode: AJUSTE + R$ + META columns after selected month (specific month only) */}
                {modoMeta && isSel && !isTodosMode && (
                  <>
                    {/* AJUSTE */}
                    <td style={{ textAlign: 'right', padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined }}>
                      <EditableMetaCell
                        meta={meta}
                        contaId={conta.id}
                        clienteId={clienteId}
                        competencia={mesSeg}
                        isTotal={isTotal}
                        onSaved={handleMetaSaved}
                        displayPct={(isGrupo || isSubgrupo) && !isTotal ? calcAjustePctNode(node) : undefined}
                      />
                    </td>
                    {/* R$ */}
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, padding: '8px 10px', background: isTotal ? '#0D1B35' : undefined }}>
                      {(() => {
                        const variacao = calcVariacao(node);
                        if (variacao == null) return <span style={{ color: C.txtMuted }}>—</span>;
                        const positive = variacao >= 0;
                        const abs = Math.abs(variacao);
                        const formatted = abs >= 1000 ? abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : abs.toFixed(0);
                        return <span style={{ color: positive ? '#00A86B' : '#DC2626', fontWeight: isTotal ? 800 : 400 }}>{positive ? '+' : '−'} {formatted}</span>;
                      })()}
                    </td>
                    {/* META (projetado) */}
                    <td style={{
                      textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                      fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400),
                      color: projetado != null ? (projetado < 0 ? '#DC2626' : (isTotal ? '#FFFFFF' : '#0D1B35')) : (isTotal ? '#8A9BBC' : C.txtMuted),
                      padding: '8px 10px',
                      background: isTotal ? 'rgba(26,60,255,0.18)' : 'rgba(26,60,255,0.03)',
                      borderLeft: isTotal ? undefined : '1px solid rgba(26,60,255,0.10)',
                    }}>
                      {(() => {
                        const ar = getMetaArrow(projetado, val, conta.tipo);
                        if (ar) return <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{fmtTorre(projetado)}</>;
                        return fmtTorre(projetado);
                      })()}
                    </td>
                  </>
                )}

                {/* AV% after META in CRIAÇÃO DE METAS (filtered month) */}
                {showAV && modoMeta && isSel && !isTodosMode && (() => {
                  const projTotais = calcTotaisProjetado();
                  const fatMeta = projTotais.fat;
                  const avStr = fmtAv(projetado, fatMeta);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color: avColor(conta.tipo), width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? '#0D1B35' : undefined }}>
                      {(() => {
                        const ar = getMetaArrow(projetado, val, conta.tipo);
                        if (ar && avStr) return <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{avStr}</>;
                        return avStr || '—';
                      })()}
                    </td>
                  );
                })()}

                {/* AH% after META in CRIAÇÃO DE METAS (filtered month) */}
                {showAH && modoMeta && isSel && !isTodosMode && (() => {
                  const ahStr = fmtAh(projetado, val);
                  const color = isTotal ? (projetado != null && val != null ? ahTotColor(projetado, val) : C.txtMuted) : ahColor(projetado, val, conta.tipo);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color, width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? '#0D1B35' : undefined }}>
                      {ahStr || '—'}
                    </td>
                  );
                })()}

                {/* AV% after realized when no mode is active and month is filtered */}
                {showAV && !isModoAtivo && !isTodosMode && (() => {
                  const monthMap = getMonthMap(m.value);
                  const fat = getFatForMap(monthMap);
                  const avStr = fmtAv(val, fat);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color: avColor(conta.tipo), width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? '#0D1B35' : 'rgba(26,60,255,0.06)' }}>
                      {avStr || '—'}
                    </td>
                  );
                })()}

                {/* TODOS mode: META column for months that have metas */}
                {hasMetaForMonth && (() => {
                  const prevComp = getPrevMonth(m.value);
                  const prevMap = getMonthMap(prevComp);
                  let projVal: number | null = null;
                  if (isCat) {
                    const prevReal = prevMap[conta.id] ?? null;
                    const mf = metaMapForMonth?.[conta.id] || null;
                    projVal = prevReal != null && mf ? calcProjetado(prevReal, mf) : null;
                  } else {
                    projVal = sumNodeProjetado(node, prevMap, metaMapForMonth || {});
                  }
                  return (
                    <td style={{
                      textAlign: 'right', fontFamily: C.mono, fontSize: 12,
                      fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400),
                      color: projVal != null ? (projVal < 0 ? '#DC2626' : (isTotal ? '#FFFFFF' : '#0D1B35')) : (isTotal ? '#8A9BBC' : C.txtMuted),
                      padding: '8px 10px',
                      background: isTotal ? 'rgba(26,60,255,0.18)' : 'rgba(26,60,255,0.03)',
                      borderLeft: isTotal ? undefined : '1px solid rgba(26,60,255,0.10)',
                    }}>
                      {(() => {
                        const ar = getMetaArrow(projVal, val, conta.tipo);
                        if (ar) return <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{fmtTorre(projVal)}</>;
                        return fmtTorre(projVal);
                      })()}
                    </td>
                  );
                })()}

                {/* AV% after META in TODOS mode */}
                {showAV && isTodosMode && hasMetaForMonth && (() => {
                  const prevComp = getPrevMonth(m.value);
                  const prevMap = getMonthMap(prevComp);
                  const fatMeta = sumGruposProjetado(gruposPorTipo['receita'] || [], prevMap, metaMapForMonth || {});
                  let projVal: number | null = null;
                  if (isCat) {
                    const prevReal = prevMap[conta.id] ?? null;
                    const mf = metaMapForMonth?.[conta.id] || null;
                    projVal = prevReal != null && mf ? calcProjetado(prevReal, mf) : null;
                  } else {
                    projVal = sumNodeProjetado(node, prevMap, metaMapForMonth || {});
                  }
                  const avStr = fmtAv(projVal, fatMeta);
                  return (
                    <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '8px 6px', color: avColor(conta.tipo), width: avColW, minWidth: avColW, fontWeight: isTotal ? 700 : (isGrupo || isSubgrupo ? 600 : 400), background: isTotal ? 'rgba(26,60,255,0.18)' : 'rgba(26,60,255,0.03)' }}>
                      {(() => {
                        const ar = getMetaArrow(projVal, val, conta.tipo);
                        if (ar && avStr) return <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{avStr}</>;
                        return avStr || '—';
                      })()}
                    </td>
                  );
                })()}
              </Fragment>
            );
          })}

          {/* Year total */}
          {showYearCol && (
          <td style={{
            textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
            fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400),
            padding: '8px 10px',
            borderLeft: '1px solid #DDE4F0',
            background: isTotal ? '#0D1B35' : '#F6F9FF',
            color: (() => {
              let yearTotal = 0;
              let has = false;
              for (const m of months) {
                const mmap = getMonthMap(m.value);
                const v = isCat ? (mmap[conta.id] ?? null) : sumNodeLeafs(node, mmap);
                if (v != null) { yearTotal += v; has = true; }
              }
              if (!has) return isTotal ? '#8A9BBC' : C.txtMuted;
              return yearTotal < 0 ? '#DC2626' : (isTotal ? '#FFFFFF' : '#0D1B35');
            })(),
          }}>
            {(() => {
              let yearTotal = 0;
              let has = false;
              for (const m of months) {
                const mmap = getMonthMap(m.value);
                const v = isCat ? (mmap[conta.id] ?? null) : sumNodeLeafs(node, mmap);
                if (v != null) { yearTotal += v; has = true; }
              }
              return has ? fmtTorre(yearTotal) : '—';
            })()}
          </td>
          )}
          {/* META annual cell */}
          {showMetaAnualCol && (() => {
            // Sum realized across all months with data
            let yearRealized = 0;
            let has = false;
            for (const m of months) {
              const mmap = getMonthMap(m.value);
              const v = isCat ? (mmap[conta.id] ?? null) : sumNodeLeafs(node, mmap);
              if (v != null) { yearRealized += v; has = true; }
            }
            // Add projected value for next month (mesSeg)
            const projVal = isCat
              ? (metaAnualProjMap[conta.id] ?? null)
              : sumNodeProjetado(node, realizadoMapSel, metaMap);
            const metaAnual = (has ? yearRealized : 0) + (projVal ?? 0);
            const hasValue = has || projVal != null;
            return (
              <td style={{
                textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                fontWeight: isTotal ? 800 : (isGrupo || isSubgrupo ? 600 : 400),
                padding: '8px 10px',
                borderLeft: '1px solid #DDE4F0',
                background: isTotal ? 'rgba(26,60,255,0.12)' : 'rgba(26,60,255,0.03)',
                color: !hasValue ? (isTotal ? '#8A9BBC' : C.txtMuted) : metaAnual < 0 ? '#DC2626' : (isTotal ? '#1A3CFF' : '#0D1B35'),
              }}>
                {hasValue ? fmtTorre(metaAnual) : '—'}
              </td>
            );
          })()}
        </tr>
        {!isCollapsedItem && !isTotal && node.children.map(child => renderRow(child, depth + 1))}
      </Fragment>
    );
  };

  const renderTotalizador = (key: string) => {
    const config = TOTALIZADOR_CONFIG[key];

    return (
      <tr key={key} style={{ background: '#0D1B35' }}>
        <td style={{ ...stickyTd('#0D1B35', { padding: '11px 8px 11px 12px', fontWeight: 700, fontSize: 12, color: '#FFFFFF' }) }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 18 }} />
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0099E6', flexShrink: 0, display: 'inline-block' }} />
            {config.nome}
          </span>
        </td>
        {displayMonths.map(m => {
          const monthMap = getMonthMap(m.value);
          const totals = calcTotaisForMap(monthMap);
          const val = totals[key as keyof typeof totals];
          const isSel = isSelectedMonth(m.value);

          // TODOS mode: META column for this month
          const hasMetaForMonth = isTodosMode && isModoAtivo && monthsWithMetas.has(m.value);
          const metaMapForMonth = hasMetaForMonth ? metaMapByComp[m.value] : null;

          return (
            <Fragment key={m.value}>
              <td style={{
                textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 800,
                color: val < 0 ? '#FF6B6B' : '#00E68A', padding: '11px 10px',
                background: isSel && isModoAtivo && !isTodosMode ? '#0D1B35' : undefined,
              }}>
                {fmtTorre(val)}
              </td>

              {/* AV% after realized in TODOS mode (totalizador) */}
              {showAV && isTodosMode && (() => {
                const fat = totals.fat;
                const avStr = fmtAv(val, fat);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: avTotColor(val), width: avColW, minWidth: avColW, fontWeight: 700, background: '#0D1B35' }}>
                    {avStr || '—'}
                  </td>
                );
              })()}

              {/* AV% after realized in ANÁLISE META (filtered, totalizador) */}
              {showAV && modoAnaliseMeta && isSel && !isTodosMode && (() => {
                const fat = totals.fat;
                const avStr = fmtAv(val, fat);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: avTotColor(val), width: avColW, minWidth: avColW, fontWeight: 700, background: '#0D1B35' }}>
                    {avStr || '—'}
                  </td>
                );
              })()}

              {modoAnaliseMeta && isSel && !isTodosMode && (() => {
                const projTotais = calcTotaisProjetado();
                const projVal = projTotais[key as keyof typeof projTotais];
                const avPct = projTotais.fat !== 0 ? (Math.abs(projVal) / Math.abs(projTotais.fat)) * 100 : 0;
                return (
                  <td style={{ textAlign: 'right', padding: '11px 10px', fontFamily: 'monospace', fontSize: 13, fontWeight: 800, background: 'rgba(26,60,255,0.18)',
                    color: projVal < 0 ? '#FF6B6B' : '#00E68A',
                  }}>
                    {(() => { const ar = getTotArrow(projVal, val); return ar ? <span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span> : null; })()}{fmtTorre(projVal)} <span style={{ fontSize: 10, color: '#8A9BBC', fontWeight: 400 }}>({avPct.toFixed(1)}%)</span>
                  </td>
                );
              })()}

              {/* AV% after META in ANÁLISE META (filtered, totalizador) */}
              {showAV && modoAnaliseMeta && isSel && !isTodosMode && (() => {
                const projTotais = calcTotaisProjetado();
                const projVal = projTotais[key as keyof typeof projTotais];
                const fatMeta = projTotais.fat;
                const avStr = fmtAv(projVal, fatMeta);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: avTotColor(projVal), width: avColW, minWidth: avColW, fontWeight: 700, background: '#0D1B35' }}>
                    {(() => { const ar = getTotArrow(projVal, val); return ar && avStr ? <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{avStr}</> : (avStr || '—'); })()}
                  </td>
                );
              })()}

              {/* AV% after realized in CRIAÇÃO DE METAS (filtered, totalizador) */}
              {showAV && modoMeta && isSel && !isTodosMode && (() => {
                const fat = totals.fat;
                const avStr = fmtAv(val, fat);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: avTotColor(val), width: avColW, minWidth: avColW, fontWeight: 700, background: '#0D1B35' }}>
                    {avStr || '—'}
                  </td>
                );
              })()}

              {/* AH% after realized in CRIAÇÃO DE METAS (filtered, totalizador) */}
              {showAH && modoMeta && isSel && !isTodosMode && (() => {
                const prevComp = getPrevMonth(m.value);
                const prevMap = getMonthMap(prevComp);
                const prevTotals = calcTotaisForMap(prevMap);
                const prevVal = prevTotals[key as keyof typeof prevTotals];
                const ahStr = fmtAh(val, prevVal);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: ahTotColor(val, prevVal), width: avColW, minWidth: avColW, fontWeight: 700, background: '#0D1B35' }}>
                    {ahStr || '—'}
                  </td>
                );
              })()}

              {modoMeta && isSel && !isTodosMode && (() => {
                const projTotais = calcTotaisProjetado();
                const projVal = projTotais[key as keyof typeof projTotais];
                const variacao = projVal - val;
                return (
                  <>
                    <td style={{ textAlign: 'right', padding: '11px 10px', color: '#8A9BBC', fontFamily: 'monospace', fontSize: 12, background: '#0D1B35' }}>—</td>
                    <td style={{ textAlign: 'right', padding: '11px 10px', fontFamily: 'monospace', fontSize: 12, background: '#0D1B35',
                      color: variacao >= 0 ? '#00E68A' : '#FF6B6B',
                    }}>
                      {variacao >= 0 ? '+' : '−'} {fmtTorre(Math.abs(variacao))}
                    </td>
                    <td style={{ textAlign: 'right', padding: '11px 10px', fontFamily: 'monospace', fontSize: 13, fontWeight: 800, background: 'rgba(26,60,255,0.18)',
                      color: projVal < 0 ? '#FF6B6B' : '#00E68A',
                    }}>
                      {(() => { const ar = getTotArrow(projVal, val); return ar ? <span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span> : null; })()}{fmtTorre(projVal)} <span style={{ fontSize: 10, color: '#8A9BBC', fontWeight: 400 }}>({(projTotais.fat !== 0 ? (Math.abs(projVal) / Math.abs(projTotais.fat)) * 100 : 0).toFixed(1)}%)</span>
                    </td>
                  </>
                );
              })()}

              {/* AV% after META in CRIAÇÃO DE METAS (filtered, totalizador) */}
              {showAV && modoMeta && isSel && !isTodosMode && (() => {
                const projTotais = calcTotaisProjetado();
                const projVal = projTotais[key as keyof typeof projTotais];
                const fatMeta = projTotais.fat;
                const avStr = fmtAv(projVal, fatMeta);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: avTotColor(projVal), width: avColW, minWidth: avColW, fontWeight: 700, background: '#0D1B35' }}>
                    {(() => { const ar = getTotArrow(projVal, val); return ar && avStr ? <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{avStr}</> : (avStr || '—'); })()}
                  </td>
                );
              })()}

              {/* AH% after META in CRIAÇÃO DE METAS (filtered, totalizador) */}
              {showAH && modoMeta && isSel && !isTodosMode && (() => {
                const projTotais = calcTotaisProjetado();
                const projVal = projTotais[key as keyof typeof projTotais];
                const ahStr = fmtAh(projVal, val);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: ahTotColor(projVal, val), width: avColW, minWidth: avColW, fontWeight: 700, background: '#0D1B35' }}>
                    {ahStr || '—'}
                  </td>
                );
              })()}

              {/* AV% when no mode active and filtered (totalizador) */}
              {showAV && !isModoAtivo && !isTodosMode && (() => {
                const fat = totals.fat;
                const avStr = fmtAv(val, fat);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: avTotColor(val), width: avColW, minWidth: avColW, fontWeight: 700, background: '#0D1B35' }}>
                    {avStr || '—'}
                  </td>
                );
              })()}

              {/* TODOS mode: META column for totalizador */}
              {hasMetaForMonth && (() => {
                const prevComp = getPrevMonth(m.value);
                const prevMap = getMonthMap(prevComp);
                const calcTotaisProj = () => {
                  const fat = sumGruposProjetado(gruposPorTipo['receita'] || [], prevMap, metaMapForMonth || {});
                  const custos = sumGruposProjetado(gruposPorTipo['custo_variavel'] || [], prevMap, metaMapForMonth || {});
                  const mc = fat + custos;
                  const despesas = sumGruposProjetado(gruposPorTipo['despesa_fixa'] || [], prevMap, metaMapForMonth || {});
                  const ro = mc + despesas;
                  const invest = sumGruposProjetado(gruposPorTipo['investimento'] || [], prevMap, metaMapForMonth || {});
                  const rai = ro + invest;
                  const financ = sumGruposProjetado(gruposPorTipo['financeiro'] || [], prevMap, metaMapForMonth || {});
                  const gc = rai + financ;
                  return { fat, MC: mc, RO: ro, RAI: rai, GC: gc };
                };
                const projTotais = calcTotaisProj();
                const projVal = projTotais[key as keyof typeof projTotais];
                return (
                  <td style={{
                    textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 800,
                    padding: '11px 10px', background: 'rgba(26,60,255,0.18)',
                    color: projVal < 0 ? '#FF6B6B' : '#00E68A',
                  }}>
                    {(() => { const ar = getTotArrow(projVal, val); return ar ? <span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span> : null; })()}{fmtTorre(projVal)} <span style={{ fontSize: 10, color: '#8A9BBC', fontWeight: 400 }}>({(projTotais.fat !== 0 ? (Math.abs(projVal) / Math.abs(projTotais.fat)) * 100 : 0).toFixed(1)}%)</span>
                  </td>
                );
              })()}

              {/* AV% after META in TODOS mode (totalizador) */}
              {showAV && isTodosMode && hasMetaForMonth && (() => {
                const prevComp = getPrevMonth(m.value);
                const prevMap = getMonthMap(prevComp);
                const fatMeta = sumGruposProjetado(gruposPorTipo['receita'] || [], prevMap, metaMapForMonth || {});
                const calcTotaisProj2 = () => {
                  const custos = sumGruposProjetado(gruposPorTipo['custo_variavel'] || [], prevMap, metaMapForMonth || {});
                  const mc = fatMeta + custos;
                  const despesas = sumGruposProjetado(gruposPorTipo['despesa_fixa'] || [], prevMap, metaMapForMonth || {});
                  const ro = mc + despesas;
                  const invest = sumGruposProjetado(gruposPorTipo['investimento'] || [], prevMap, metaMapForMonth || {});
                  const rai = ro + invest;
                  const financ = sumGruposProjetado(gruposPorTipo['financeiro'] || [], prevMap, metaMapForMonth || {});
                  const gc = rai + financ;
                  return { fat: fatMeta, MC: mc, RO: ro, RAI: rai, GC: gc };
                };
                const projTotais = calcTotaisProj2();
                const projVal = projTotais[key as keyof typeof projTotais];
                const avStr = fmtAv(projVal, fatMeta);
                return (
                  <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '11px 6px', color: avTotColor(projVal), width: avColW, minWidth: avColW, fontWeight: 700, background: 'rgba(26,60,255,0.18)' }}>
                    {(() => { const ar = getTotArrow(projVal, val); return ar && avStr ? <><span style={{ fontSize: 14, fontWeight: 700, color: ar.color, marginRight: 4 }}>{ar.arrow}</span>{avStr}</> : (avStr || '—'); })()}
                  </td>
                );
              })()}
            </Fragment>
          );
        })}
        {/* Year total */}
        {showYearCol && (
        <td style={{
          textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 800,
          padding: '11px 10px', borderLeft: '1px solid #DDE4F0', background: '#0D1B35',
          color: (() => {
            let total = 0;
            for (const m of months) {
              const monthMap = getMonthMap(m.value);
              const t = calcTotaisForMap(monthMap);
              total += t[key as keyof typeof t];
            }
            return total < 0 ? '#FF6B6B' : '#00E68A';
          })(),
        }}>
          {(() => {
            let total = 0;
            for (const m of months) {
              const monthMap = getMonthMap(m.value);
              const t = calcTotaisForMap(monthMap);
              total += t[key as keyof typeof t];
            }
            return fmtTorre(total);
          })()}
        </td>
        )}
        {/* META annual totalizador cell */}
        {showMetaAnualCol && (() => {
          // Year realized total
          let yearRealized = 0;
          for (const m of months) {
            const monthMap = getMonthMap(m.value);
            const t = calcTotaisForMap(monthMap);
            yearRealized += t[key as keyof typeof t];
          }
          // Projected next month
          const projTotais = calcTotaisProjetado();
          const projVal = projTotais[key as keyof typeof projTotais];
          const metaAnual = yearRealized + projVal;
          // AV%: for fat use absolute, others relative to fat
          const fatYearRealized = (() => {
            let f = 0;
            for (const m of months) { const mm = getMonthMap(m.value); const t = calcTotaisForMap(mm); f += t.fat; }
            return f;
          })();
          const fatProj = calcTotaisProjetado().fat;
          const fatMetaAnual = fatYearRealized + fatProj;
          const avPct = fatMetaAnual !== 0 ? (Math.abs(metaAnual) / Math.abs(fatMetaAnual)) * 100 : 0;
          return (
            <td style={{
              textAlign: 'right', fontFamily: 'monospace', fontSize: 13, fontWeight: 800,
              padding: '11px 10px', borderLeft: '1px solid #DDE4F0',
              background: 'rgba(26,60,255,0.12)',
              color: metaAnual < 0 ? '#FF6B6B' : '#00E68A',
            }}>
              {fmtTorre(metaAnual)} <span style={{ fontSize: 10, color: '#8A9BBC', fontWeight: 400 }}>({avPct.toFixed(1)}%)</span>
            </td>
          );
        })()}
      </tr>
    );
  };

  // ── META annual column (TODOS + meta modes) ────────────────────
  const showMetaAnualCol = isTodosMode && isModoAtivo;

  // Pre-compute META annual projected map for mesSeg (next month)
  const metaAnualProjMap = useMemo(() => {
    if (!showMetaAnualCol || !contas) return {} as Record<string, number | null>;
    const map: Record<string, number | null> = {};
    contas.forEach(c => {
      const real = realizadoMapSel[c.id] ?? null;
      if (real == null) { map[c.id] = null; return; }
      const meta = metaMap[c.id] || null;
      if (meta && meta.meta_valor != null) {
        const proj = calcProjetado(real, meta);
        map[c.id] = proj ?? real;
      } else {
        map[c.id] = real;
      }
    });
    return map;
  }, [showMetaAnualCol, contas, realizadoMapSel, metaMap]);

  // ── Table min width calculation ───────────────────────────────
  const todosMetaColsCount = isTodosMode && isModoAtivo ? monthsWithMetas.size : 0;
  const extraColsWidth = (!isTodosMode && modoMeta) ? (metaColW + rsColW + metaProjetadoColW) : (!isTodosMode && modoAnaliseMeta ? metaColW : 0);
  const showYearCol = isTodosMode || !isModoAtivo;
  const metaAnualColW = 130;
  // AV% column count: in month-filtered mode with AV on, 1 AV col after META; in TODOS mode, 1 per displayed month + 1 per meta month
  const avColsCount = showAV ? (isTodosMode ? displayMonths.length + todosMetaColsCount : 1) : 0;
  const avExtraForMeta = showAV && !isTodosMode && isModoAtivo ? avColW : 0; // AV% after META in filtered mode
  const ahExtraForRealizado = showAH && !isTodosMode && modoMeta ? avColW : 0; // AH% after realized in CRIAÇÃO
  const ahExtraForMeta = showAH && !isTodosMode && modoMeta ? avColW : 0; // AH% after META in CRIAÇÃO
  const tableMinWidth = nameColW + displayMonths.length * (valColW + (showAV && isTodosMode ? avColW : 0)) + (showYearCol ? valColW : 0) + extraColsWidth + avExtraForMeta + ahExtraForRealizado + ahExtraForMeta + todosMetaColsCount * (metaProjetadoColW + (showAV && isTodosMode ? avColW : 0)) + (showMetaAnualCol ? metaAnualColW : 0);

  // ══════════════════════════════════════════════════════════════
  return (
    <div style={{ position: 'relative' }}>
      <style>{keyframesCSS}</style>

      {/* Grid background */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: -1, opacity: 0.35, pointerEvents: 'none',
        backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`,
        backgroundSize: '52px 52px',
      }} />
      <div style={{
        position: 'fixed', top: 0, left: '50%', transform: 'translateX(-50%)', width: 700, height: 380, zIndex: -1, pointerEvents: 'none',
        background: `radial-gradient(ellipse at 50% 0%, rgba(26,60,255,0.07), rgba(0,153,230,0.03) 45%, transparent 70%)`,
      }} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Header banner — cockpit theme */}
        <div style={{
          width: '100%', height: 170, position: 'relative', overflow: 'hidden',
          borderRadius: 12, marginBottom: 0,
          background: 'linear-gradient(135deg, #0A1628 0%, #0D1B35 50%, #0A1628 100%)',
        }}>
          {/* Layer 1 — HUD grid */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.08, pointerEvents: 'none' }}>
            <svg width="100%" height="100%">
              <defs><pattern id="hud-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <line x1="0" y1="0" x2="40" y2="0" stroke="#1A3CFF" strokeWidth="0.5" />
                <line x1="0" y1="0" x2="0" y2="40" stroke="#1A3CFF" strokeWidth="0.5" />
              </pattern></defs>
              <rect width="100%" height="100%" fill="url(#hud-grid)" />
            </svg>
          </div>
          {/* Layer 2 — blue glow */}
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse 60% 80% at 30% 50%, rgba(26,60,255,0.18) 0%, rgba(0,153,230,0.08) 40%, transparent 70%)', pointerEvents: 'none' }} />

          {/* Layer — scanning beam effect */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', top: 0, bottom: 0, width: '30%',
              background: 'linear-gradient(90deg, transparent, rgba(26,60,255,0.08), rgba(0,153,230,0.12), rgba(26,60,255,0.08), transparent)',
              animation: 'scanHorizontal 3s ease-in-out infinite',
            }} />
          </div>

          {/* Layer — floating data particles */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            {DATA_PARTICLES.map((p, i) => (
              <span key={i} style={{
                position: 'absolute', bottom: 8, left: p.left,
                fontFamily: C.mono, fontSize: 10, fontWeight: 600,
                color: p.text.startsWith('+') ? 'rgba(0,168,107,0.5)' : p.text.startsWith('−') ? 'rgba(220,38,38,0.4)' : 'rgba(0,153,230,0.4)',
                animation: `${p.anim} ${p.dur} ease-in-out ${p.delay} infinite`,
                letterSpacing: '0.04em',
              }}>
                {p.text}
              </span>
            ))}
          </div>

          {/* Layer — radar pulse circles */}
          <div style={{ position: 'absolute', right: 100, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}>
            <div style={{ position: 'relative', width: 80, height: 80 }}>
              <div style={{ position: 'absolute', inset: 0, border: '1px solid rgba(0,153,230,0.15)', borderRadius: '50%', animation: 'dataPulse 2s ease infinite' }} />
              <div style={{ position: 'absolute', inset: 10, border: '1px solid rgba(26,60,255,0.2)', borderRadius: '50%', animation: 'dataPulse 2s ease 0.4s infinite' }} />
              <div style={{ position: 'absolute', inset: 20, border: '1px solid rgba(0,153,230,0.25)', borderRadius: '50%', animation: 'dataPulse 2s ease 0.8s infinite' }} />
              <div style={{ position: 'absolute', inset: 0, borderTop: '2px solid rgba(0,153,230,0.4)', borderRadius: '50%', animation: 'radarSweep 3s linear infinite' }} />
            </div>
          </div>

          {/* Layer — second scan beam (slower, subtler) */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
            <div style={{ position: 'absolute', width: '25%', height: '100%', background: 'linear-gradient(90deg, transparent, rgba(0,153,230,0.04), transparent)', animation: 'scanHorizontal2 12s linear infinite' }} />
          </div>

          {/* Layer 3 — detailed tower SVG with enhanced glow */}
          <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', opacity: 0.75, filter: 'drop-shadow(0 0 24px rgba(26,60,255,0.7)) drop-shadow(0 0 50px rgba(0,153,230,0.4)) drop-shadow(0 0 80px rgba(0,212,255,0.15))' }}>
            <svg viewBox="0 0 220 150" style={{ width: 280, height: 175 }}>
              {/* Ground glow */}
              <ellipse cx="110" cy="142" rx="80" ry="6" fill="#1A3CFF" opacity="0.3" style={{ animation: 'glowPulse 3s ease infinite' }} />
              {/* Base — trapezoidal with gradient */}
              <defs>
                <linearGradient id="tower-body-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#1A3CFF" stopOpacity="0.9" />
                  <stop offset="100%" stopColor="#0D1B35" stopOpacity="0.95" />
                </linearGradient>
                <linearGradient id="cabin-glass-grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00D4FF" stopOpacity="0.85" />
                  <stop offset="100%" stopColor="#0099E6" stopOpacity="0.5" />
                </linearGradient>
                <radialGradient id="antenna-glow" cx="50%" cy="50%" r="50%">
                  <stop offset="0%" stopColor="#00D4FF" stopOpacity="1" />
                  <stop offset="60%" stopColor="#0099E6" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#0099E6" stopOpacity="0" />
                </radialGradient>
                <filter id="glass-glow">
                  <feGaussianBlur stdDeviation="2" result="blur" />
                  <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <polygon points="60,140 160,140 145,122 75,122" fill="url(#tower-body-grad)" />
              {/* Body — tapered */}
              <polygon points="80,122 140,122 132,60 88,60" fill="url(#tower-body-grad)" />
              {/* Horizontal body lines (structure details) */}
              <line x1="82" y1="80" x2="138" y2="80" stroke="#0099E6" strokeWidth="0.5" opacity="0.25" />
              <line x1="83" y1="95" x2="137" y2="95" stroke="#0099E6" strokeWidth="0.5" opacity="0.2" />
              <line x1="84" y1="110" x2="136" y2="110" stroke="#0099E6" strokeWidth="0.5" opacity="0.15" />
              {/* Support struts */}
              <line x1="85" y1="122" x2="70" y2="140" stroke="#0099E6" strokeWidth="1.2" opacity="0.35" />
              <line x1="135" y1="122" x2="150" y2="140" stroke="#0099E6" strokeWidth="1.2" opacity="0.35" />
              <line x1="90" y1="90" x2="78" y2="122" stroke="#0099E6" strokeWidth="0.6" opacity="0.2" />
              <line x1="130" y1="90" x2="142" y2="122" stroke="#0099E6" strokeWidth="0.6" opacity="0.2" />
              {/* Cabin — panoramic glass with glow filter */}
              <rect x="72" y="36" width="76" height="26" rx="5" fill="#0D1B35" stroke="#1A3CFF" strokeWidth="2" />
              <rect x="72" y="36" width="76" height="26" rx="5" fill="none" stroke="#0099E6" strokeWidth="0.5" opacity="0.4" />
              {/* Glass panels with enhanced glow */}
              <g filter="url(#glass-glow)">
                <rect x="78" y="40" width="14" height="18" rx="2" fill="url(#cabin-glass-grad)" style={{ animation: 'glowPulse 2s ease infinite' }} />
                <rect x="96" y="40" width="14" height="18" rx="2" fill="url(#cabin-glass-grad)" style={{ animation: 'glowPulse 2s ease 0.4s infinite' }} />
                <rect x="114" y="40" width="14" height="18" rx="2" fill="url(#cabin-glass-grad)" style={{ animation: 'glowPulse 2s ease 0.8s infinite' }} />
              </g>
              {/* Glass reflection highlights */}
              <rect x="80" y="41" width="4" height="8" rx="1" fill="#FFFFFF" opacity="0.15" />
              <rect x="98" y="41" width="4" height="8" rx="1" fill="#FFFFFF" opacity="0.15" />
              <rect x="116" y="41" width="4" height="8" rx="1" fill="#FFFFFF" opacity="0.15" />
              {/* Cabin roof */}
              <polygon points="68,36 152,36 144,26 76,26" fill="#1A3CFF" opacity="0.7" />
              <line x1="68" y1="36" x2="152" y2="36" stroke="#0099E6" strokeWidth="1" opacity="0.6" />
              {/* Antenna mast */}
              <line x1="110" y1="26" x2="110" y2="4" stroke="#1A3CFF" strokeWidth="2.5" />
              <line x1="110" y1="4" x2="110" y2="26" stroke="#0099E6" strokeWidth="0.8" opacity="0.4" />
              {/* Antenna cross-arms */}
              <line x1="110" y1="12" x2="100" y2="20" stroke="#0099E6" strokeWidth="1" opacity="0.5" />
              <line x1="110" y1="12" x2="120" y2="20" stroke="#0099E6" strokeWidth="1" opacity="0.5" />
              <line x1="110" y1="8" x2="104" y2="14" stroke="#0099E6" strokeWidth="0.6" opacity="0.3" />
              <line x1="110" y1="8" x2="116" y2="14" stroke="#0099E6" strokeWidth="0.6" opacity="0.3" />
              {/* Antenna tip with radial glow */}
              <circle cx="110" cy="4" r="5" fill="url(#antenna-glow)" style={{ animation: 'glowPulse 1.2s ease infinite' }} />
              <circle cx="110" cy="4" r="2" fill="#FFFFFF" opacity="0.9" style={{ animation: 'glowPulse 1.2s ease infinite' }} />
              {/* Signal waves — 4 rings */}
              <circle cx="110" cy="4" r="10" stroke="#00D4FF" strokeWidth="1" fill="none" opacity="0.5" style={{ animation: 'signalWave 2s ease-out infinite' }} />
              <circle cx="110" cy="4" r="10" stroke="#0099E6" strokeWidth="0.8" fill="none" opacity="0.4" style={{ animation: 'signalWave 2s ease-out 0.5s infinite' }} />
              <circle cx="110" cy="4" r="10" stroke="#0099E6" strokeWidth="0.6" fill="none" opacity="0.3" style={{ animation: 'signalWave 2s ease-out 1s infinite' }} />
              <circle cx="110" cy="4" r="10" stroke="#1A3CFF" strokeWidth="0.5" fill="none" opacity="0.2" style={{ animation: 'signalWave 2s ease-out 1.5s infinite' }} />
              {/* Small lights on body */}
              <circle cx="100" cy="75" r="2" fill="#00FF88" opacity="0.8" style={{ animation: 'glowPulse 3s ease infinite' }} />
              <circle cx="120" cy="85" r="2" fill="#FF4444" opacity="0.8" style={{ animation: 'glowPulse 3s ease 1s infinite' }} />
              <circle cx="100" cy="100" r="2" fill="#00FF88" opacity="0.8" style={{ animation: 'glowPulse 3s ease 2s infinite' }} />
              <circle cx="120" cy="105" r="1.5" fill="#FFD700" opacity="0.7" style={{ animation: 'glowPulse 2.5s ease 0.5s infinite' }} />
              {/* Cabin side lights */}
              <circle cx="70" cy="49" r="2" fill="#FF4444" opacity="0.7" style={{ animation: 'glowPulse 1.8s ease infinite' }} />
              <circle cx="150" cy="49" r="2" fill="#00FF88" opacity="0.7" style={{ animation: 'glowPulse 1.8s ease 0.9s infinite' }} />
            </svg>
          </div>

          {/* Content */}
          <div style={{ position: 'relative', zIndex: 1, height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '14px 24px 12px' }}>
            {/* Top row: eyebrow + badge */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: '#0099E6', fontSize: 14 }}>◈</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: '#0099E6', letterSpacing: '0.22em' }}>GPI INTELIGÊNCIA FINANCEIRA</span>
              </div>
              <span style={{ fontSize: 9, fontWeight: 600, color: '#00A86B', background: 'rgba(0,168,107,0.12)', border: '1px solid rgba(0,168,107,0.25)', borderRadius: 6, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00A86B', animation: 'pulse 2s infinite', boxShadow: '0 0 6px rgba(0,168,107,0.8)' }} />
                OPERACIONAL
              </span>
            </div>

            {/* Middle row: title + subtitle */}
            <div>
              <h2 style={{ fontSize: 40, fontWeight: 800, color: '#FFFFFF', margin: 0, letterSpacing: '-0.02em', lineHeight: 1.1, textShadow: '0 0 20px rgba(26,60,255,0.5), 0 0 40px rgba(26,60,255,0.2)' }}>Torre de Controle</h2>
              <p style={{ fontSize: 11, color: 'rgba(138,155,188,0.7)', margin: '4px 0 0', letterSpacing: '0.06em' }}>Monitoramento · Metas · Projeções</p>
            </div>

            {/* Bottom row: controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Toggle: CRIAÇÃO DE METAS */}
              <button
                onClick={() => { setModoMeta(v => { if (!v) setModoAnaliseMeta(false); return !v; }); }}
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: modoMeta ? 700 : 500, cursor: 'pointer',
                  background: modoMeta ? 'rgba(26,60,255,0.6)' : 'transparent',
                  border: `1px solid ${modoMeta ? '#1A3CFF' : 'rgba(255,255,255,0.15)'}`,
                  color: modoMeta ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
                  transition: 'all 0.15s',
                }}
              >
                CRIAÇÃO DE METAS
              </button>
              {/* Toggle: ANÁLISE META */}
              <button
                onClick={() => { setModoAnaliseMeta(v => { if (!v) setModoMeta(false); return !v; }); }}
                style={{
                  padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: modoAnaliseMeta ? 700 : 500, cursor: 'pointer',
                  background: modoAnaliseMeta ? 'rgba(26,60,255,0.6)' : 'transparent',
                  border: `1px solid ${modoAnaliseMeta ? '#1A3CFF' : 'rgba(255,255,255,0.15)'}`,
                  color: modoAnaliseMeta ? '#FFFFFF' : 'rgba(255,255,255,0.5)',
                  transition: 'all 0.15s',
                }}
              >
                ANÁLISE META
              </button>

              {/* Separator */}
              <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

              {/* Year selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'rgba(26,60,255,0.08)', borderRadius: 6, padding: '2px 3px', border: '1px solid rgba(26,60,255,0.15)' }}>
                {years.map(y => (
                  <button
                    key={y}
                    onClick={() => { setAno(y); setMesSelecionado(null); }}
                    style={{
                      padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: ano === y ? 700 : 500,
                      color: ano === y ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
                      background: ano === y ? 'rgba(26,60,255,0.5)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer', transition: 'all 0.15s',
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>

              {/* Separator */}
              <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

              {/* Month selector as buttons */}
              {monthsWithData.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  {/* TODOS chip */}
                  {(() => {
                    const isAllActive = mesSelecionado === null;
                    return (
                      <button
                        onClick={() => setMesSelecionado(null)}
                        style={{
                          padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: isAllActive ? 700 : 500,
                          color: isAllActive ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
                          background: isAllActive ? 'rgba(26,60,255,0.5)' : 'transparent',
                          border: `1px solid ${isAllActive ? 'rgba(26,60,255,0.6)' : 'rgba(255,255,255,0.08)'}`,
                          cursor: 'pointer', transition: 'all 0.15s',
                          letterSpacing: '0.02em',
                        }}
                        onMouseEnter={e => { if (!isAllActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; } }}
                        onMouseLeave={e => { if (!isAllActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; } }}
                      >
                        TODOS
                      </button>
                    );
                  })()}
                  {monthsWithData.map(m => {
                    const isActive = m.value === mesEfetivo;
                    return (
                      <button
                        key={m.value}
                        onClick={() => setMesSelecionado(m.value)}
                        style={{
                          padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: isActive ? 700 : 500,
                          color: isActive ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
                          background: isActive ? 'rgba(0,153,230,0.5)' : 'transparent',
                          border: `1px solid ${isActive ? 'rgba(0,153,230,0.6)' : 'rgba(255,255,255,0.08)'}`,
                          cursor: 'pointer', transition: 'all 0.15s',
                          letterSpacing: '0.02em',
                        }}
                        onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'; } }}
                        onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; } }}
                      >
                        {m.shortLabel}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Separator */}
              <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />

              {/* Comandante GPI */}
              <button
                onClick={() => handleSugerirMetas()}
                disabled={loadingSugestao}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 12px', borderRadius: 6, cursor: loadingSugestao ? 'wait' : 'pointer',
                  background: 'rgba(26,60,255,0.15)', border: '1px solid rgba(26,60,255,0.3)',
                  color: '#7B9AFF', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                  transition: 'all 0.15s',
                }}
              >
                👨🏻‍✈️ Comandante GPI
              </button>

              {/* Chat Analista */}
              <button
                onClick={() => setChatOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '4px 12px', borderRadius: 6, cursor: 'pointer',
                  background: 'rgba(0,153,230,0.15)', border: '1px solid rgba(0,153,230,0.3)',
                  color: '#7BC8FF', fontSize: 11, fontWeight: 700, letterSpacing: '0.04em',
                  transition: 'all 0.15s',
                }}
              >
                💬 Chat Analista
              </button>

            </div>
          </div>
        </div>

        {/* Empty states */}
        {!hasContas && !isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 0', textAlign: 'center' }}>
            <BookOpen style={{ width: 48, height: 48, color: C.txtMuted, opacity: 0.4 }} />
            <p style={{ fontSize: 14, color: C.txtSec }}>Plano de contas não configurado.</p>
          </div>
        )}
        {hasContas && !hasAnyData && !isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 0', textAlign: 'center' }}>
            <FileSpreadsheet style={{ width: 48, height: 48, color: C.txtMuted, opacity: 0.4 }} />
            <p style={{ fontSize: 14, color: C.txtSec }}>Nenhum valor importado para {ano}.</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}

        {/* Main content */}
        {hasContas && hasAnyData && !isLoading && (
          <>
            {/* AV% toggle above table */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
              <button
                onClick={() => setShowAV(v => !v)}
                style={{
                  background: showAV ? '#1A3CFF' : '#F0F4FA',
                  color: showAV ? '#FFFFFF' : '#8A9BBC',
                  border: `1px solid ${showAV ? '#1A3CFF' : '#DDE4F0'}`,
                  borderRadius: 6,
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!showAV) (e.currentTarget.style.background = '#E8EEF8'); }}
                onMouseLeave={e => { if (!showAV) (e.currentTarget.style.background = '#F0F4FA'); }}
              >
                AV%
              </button>
              <button
                onClick={() => setShowAH(v => !v)}
                style={{
                  background: showAH ? '#1A3CFF' : '#F0F4FA',
                  color: showAH ? '#FFFFFF' : '#8A9BBC',
                  border: `1px solid ${showAH ? '#1A3CFF' : '#DDE4F0'}`,
                  borderRadius: 6,
                  padding: '4px 12px',
                  fontSize: 12,
                  fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { if (!showAH) (e.currentTarget.style.background = '#E8EEF8'); }}
                onMouseLeave={e => { if (!showAH) (e.currentTarget.style.background = '#F0F4FA'); }}
              >
                AH%
              </button>
            </div>

            {/* Instrumentos de Criação de Metas — logo abaixo do banner */}
            {modoMeta && mesEfetivo && cliente && (
              <TorreIndicadoresCriacao
                cliente={cliente}
                competencia={mesEfetivo}
                mesProximo={(() => {
                  const d = new Date(mesEfetivo + 'T00:00:00');
                  d.setMonth(d.getMonth() + 1);
                  return d.toISOString().slice(0, 7) + '-01';
                })()}
                valoresMensais={valoresAnuais || []}
                torreMetas={metas || []}
                planoDeContas={contas || []}
                modoTodos={isTodosMode}
                metasAno={metasAno || []}
                monthsWithData={monthsWithData.map(m => m.value)}
                ano={ano}
              />
            )}

            {/* Summary cards (only when ANÁLISE META mode is on) */}
            {modoAnaliseMeta && <SummaryCards counts={statusCounts} gcProjetado={gcProjetado} />}

            {/* Table */}
            <div className="rounded-xl border overflow-x-auto" style={{ borderColor: '#DDE4F0', background: '#FAFCFF' }}>
              <table style={{ borderCollapse: 'collapse', minWidth: tableMinWidth }}>
                <thead>
                  <tr style={{ background: '#F0F4FA', borderBottom: '2px solid #DDE4F0' }}>
                    <th style={{
                      ...stickyTd('#F0F4FA', {
                        padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                        color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em',
                      }),
                      width: nameColW,
                    }}>
                      CONTA DRE
                    </th>
                    {displayMonths.map(m => {
                      const isSel = isSelectedMonth(m.value);
                      const selHeaderBg = isSel && isModoAtivo && !isTodosMode ? 'rgba(26,60,255,0.1)' : undefined;
                      const hasMetaForMonth = isTodosMode && isModoAtivo && monthsWithMetas.has(m.value);

                      return (
                        <Fragment key={m.value}>
                          <th style={{
                            padding: '10px 12px', textAlign: 'right', fontSize: 11,
                            fontWeight: isSel && isModoAtivo && !isTodosMode ? 700 : 600,
                            color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em',
                            width: valColW, minWidth: valColW, whiteSpace: 'nowrap',
                            background: selHeaderBg,
                            borderBottom: isSel && isModoAtivo && !isTodosMode ? '2px solid #1A3CFF' : undefined,
                          }}>
                            {m.shortLabel}
                          </th>
                          {/* AV% header in TODOS mode after realized */}
                          {showAV && isTodosMode && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW }}>
                              AV%
                            </th>
                          )}
                          {/* AV% header after realized in ANÁLISE META (filtered) */}
                          {showAV && modoAnaliseMeta && isSel && !isTodosMode && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW, background: 'rgba(26,60,255,0.06)' }}>
                              AV%
                            </th>
                          )}
                          {modoAnaliseMeta && isSel && !isTodosMode && (
                            <th style={{
                              padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600,
                              color: '#1A3CFF', textTransform: 'uppercase', letterSpacing: '0.06em',
                              width: metaColW, minWidth: metaColW,
                              background: 'rgba(26,60,255,0.06)', borderBottom: '2px solid rgba(26,60,255,0.18)',
                            }}>
                              META
                            </th>
                          )}
                          {/* AV% header after META in ANÁLISE META (filtered) */}
                          {showAV && modoAnaliseMeta && isSel && !isTodosMode && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW }}>
                              AV%
                            </th>
                          )}
                          {/* AV% header after realized in CRIAÇÃO DE METAS (filtered) */}
                          {showAV && modoMeta && isSel && !isTodosMode && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW, background: 'rgba(26,60,255,0.06)' }}>
                              AV%
                            </th>
                          )}
                          {/* AH% header after realized in CRIAÇÃO DE METAS (filtered) */}
                          {showAH && modoMeta && isSel && !isTodosMode && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW, background: 'rgba(26,60,255,0.06)' }}>
                              AH%
                            </th>
                          )}
                          {modoMeta && isSel && !isTodosMode && (
                            <>
                              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em', width: metaColW, minWidth: metaColW }}>
                                AJUSTE
                              </th>
                              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em', width: rsColW, minWidth: rsColW }}>
                                R$
                              </th>
                              <th style={{ padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#1A3CFF', textTransform: 'uppercase', letterSpacing: '0.06em', width: metaProjetadoColW, minWidth: metaProjetadoColW, whiteSpace: 'nowrap', background: 'rgba(26,60,255,0.06)', borderBottom: '2px solid rgba(26,60,255,0.18)' }}>
                                META {mesSegShort}
                              </th>
                            </>
                          )}
                          {/* AV% header after META in CRIAÇÃO DE METAS (filtered) */}
                          {showAV && modoMeta && isSel && !isTodosMode && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW }}>
                              AV%
                            </th>
                          )}
                          {/* AH% header after META in CRIAÇÃO DE METAS (filtered) */}
                          {showAH && modoMeta && isSel && !isTodosMode && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW }}>
                              AH%
                            </th>
                          )}
                          {/* AV% header when no mode active and filtered */}
                          {showAV && !isModoAtivo && !isTodosMode && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW, background: 'rgba(26,60,255,0.06)' }}>
                              AV%
                            </th>
                          )}
                          {/* TODOS mode: META column header for months with metas */}
                          {hasMetaForMonth && (
                            <th style={{
                              padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 600,
                              color: '#1A3CFF', textTransform: 'uppercase', letterSpacing: '0.06em',
                              width: metaProjetadoColW, minWidth: metaProjetadoColW, whiteSpace: 'nowrap',
                              background: 'rgba(26,60,255,0.06)', borderBottom: '2px solid rgba(26,60,255,0.18)',
                            }}>
                              META {m.shortLabel}
                            </th>
                          )}
                          {/* AV% header after META in TODOS mode */}
                          {showAV && isTodosMode && hasMetaForMonth && (
                            <th style={{ padding: '10px 6px', textAlign: 'right', fontSize: 11, fontWeight: 600, color: C.txtMuted, width: avColW, minWidth: avColW }}>
                              AV%
                            </th>
                          )}
                        </Fragment>
                      );
                    })}
                    {/* Year total header */}
                    {showYearCol && (
                    <th style={{
                      padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700,
                      color: '#4A5E80', textTransform: 'uppercase', letterSpacing: '0.06em',
                      width: valColW, minWidth: valColW, borderLeft: '1px solid #DDE4F0',
                      background: '#F6F9FF',
                    }}>
                      {ano}
                    </th>
                    )}
                    {/* META annual header */}
                    {showMetaAnualCol && (
                    <th style={{
                      padding: '10px 12px', textAlign: 'right', fontSize: 11, fontWeight: 700,
                      color: '#1A3CFF', textTransform: 'uppercase', letterSpacing: '0.06em',
                      width: metaAnualColW, minWidth: metaAnualColW, borderLeft: '1px solid #DDE4F0',
                      background: 'rgba(26,60,255,0.06)',
                    }}>
                      META {ano}
                    </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {SEQUENCIA_DRE.map(({ tipo, totalizadorApos }) => (
                    <Fragment key={tipo}>
                      {(gruposPorTipo[tipo] || []).map(grupo => renderRow(grupo, 0))}
                      {totalizadorApos && renderTotalizador(totalizadorApos)}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <SugestaoMetasDrawer
        open={drawerSugestaoOpen}
        onClose={() => setDrawerSugestaoOpen(false)}
        cliente={cliente || null}
        competencia={mesEfetivo || ''}
        sugestoes={sugestoes}
        metasExistentes={metaMap}
        onAplicar={handleAplicarSugestoes}
        loading={loadingSugestao}
        onRegenerar={(dir?: string) => handleSugerirMetas(true, dir)}
        geradoEm={sugestaoGeradaEm}
        fromCache={sugestaoFromCache}
        contas={contas || []}
        realizadoMap={realizadoMapSel}
        narrativa={narrativa}
        diretrizSalva={diretrizSalva}
      />

      {cliente && mesEfetivo && mesSeg && (
        <ChatAnalistaDrawer
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          clienteId={clienteId}
          clienteNome={cliente.razao_social || cliente.nome_empresa}
          clienteSegmento={cliente.segmento}
          contas={contas || []}
          realizadoMap={realizadoMapSel}
          metaMap={metaMap}
          mesBase={mesEfetivo}
          mesProximo={mesSeg}
          onMetaAtualizada={invalidateMetas}
        />
      )}
    </div>
  );
}
