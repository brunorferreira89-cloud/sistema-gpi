import { useState, useMemo, useEffect, useRef, Fragment, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { BookOpen, FileSpreadsheet, ChevronDown, ChevronRight, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { nomeExibido, formatCnpj } from '@/lib/clientes-utils';
import { TorreMeta, calcProjetado, calcStatus, fmtTorre, mesAnterior as getMesAnterior, mesSeguinte as getMesSeguinte, fmtCompetencia } from '@/lib/torre-utils';
import { SugestaoMetasDrawer, type SugestaoMeta } from './SugestaoMetasDrawer';

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
  meta, contaId, clienteId, competencia, isTotal, onSaved,
}: {
  meta: TorreMeta | null; contaId: string; clienteId: string; competencia: string; isTotal: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [localTipo, setLocalTipo] = useState<'pct' | 'valor'>(meta?.meta_tipo || 'pct');
  const [input, setInput] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing && ref.current) ref.current.focus(); }, [editing]);

  if (isTotal) return <span style={{ color: C.txtMuted, fontFamily: C.mono, fontSize: 12 }}>—</span>;

  const upsert = async (tipo: 'pct' | 'valor', valor: number | null) => {
    const { error } = await supabase.from('torre_metas').upsert(
      { cliente_id: clienteId, conta_id: contaId, competencia, meta_tipo: tipo, meta_valor: valor, updated_at: new Date().toISOString() },
      { onConflict: 'cliente_id,conta_id,competencia' }
    );
    if (error) { toast.error('Erro ao salvar meta'); return; }
    onSaved();
  };

  const commit = () => {
    setEditing(false);
    const cleaned = input.replace(/[^\d.,-]/g, '').replace(',', '.');
    if (cleaned === '') { upsert(localTipo, null); return; }
    const num = parseFloat(cleaned);
    if (!isNaN(num)) upsert(localTipo, num);
  };

  const toggleTipo = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = localTipo === 'pct' ? 'valor' : 'pct';
    setLocalTipo(next);
    if (meta && meta.meta_valor !== null) upsert(next, meta.meta_valor);
  };

  // Editing mode
  if (editing) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <button onClick={toggleTipo} style={{ fontSize: 9, fontWeight: 700, color: C.primary, background: C.pLo, border: `1px solid ${C.pMd}`, borderRadius: 4, padding: '1px 5px', cursor: 'pointer' }}>
          {localTipo === 'pct' ? '%' : 'R$'}
        </button>
        <input
          ref={ref}
          value={input}
          onChange={e => setInput(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
          style={{ width: 70, textAlign: 'right', fontFamily: C.mono, fontSize: 12, border: `1px solid ${C.primary}`, borderRadius: 4, padding: '2px 6px', outline: 'none', background: C.surfaceHi }}
        />
      </span>
    );
  }

  // No meta: show "+ meta"
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

  // Has meta: badge + value
  const display = meta.meta_tipo === 'pct'
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

// ── Tower SVG ───────────────────────────────────────────────────
function TowerSvg() {
  return (
    <svg viewBox="0 0 220 140" style={{ width: 160, height: 100, opacity: 0.13 }}>
      <rect x="90" y="110" width="40" height="20" fill={C.primary} />
      <rect x="98" y="60" width="24" height="52" fill={C.primary} />
      <rect x="82" y="40" width="56" height="28" fill={C.primary} />
      <rect x="88" y="46" width="10" height="10" fill={C.cyan} opacity="0.8" />
      <rect x="102" y="46" width="10" height="10" fill={C.cyan} opacity="0.8" />
      <rect x="116" y="46" width="10" height="10" fill={C.cyan} opacity="0.8" />
      <line x1="110" y1="40" x2="110" y2="10" stroke={C.primary} strokeWidth="2" />
      <circle cx="110" cy="10" r="4" fill={C.cyan} />
      <circle cx="110" cy="10" r="12" stroke={C.cyan} strokeWidth="1" fill="none" opacity="0.5" strokeDasharray="4 3" />
      <circle cx="110" cy="10" r="22" stroke={C.primary} strokeWidth="1" fill="none" opacity="0.35" strokeDasharray="4 3" />
      <circle cx="110" cy="10" r="32" stroke={C.cyan} strokeWidth="1" fill="none" opacity="0.2" strokeDasharray="4 3" />
      <line x1="10" y1="130" x2="210" y2="130" stroke={C.primary} opacity="0.4" strokeWidth="1" />
      {[50, 90, 130, 170].map(x => <line key={x} x1={x} y1="128" x2={x} y2="132" stroke={C.primary} opacity="0.4" strokeWidth="1" />)}
      <g transform="translate(28,85) rotate(-20)">
        <path d="M0,5 L18,0 L18,10 Z" fill={C.cyan} opacity="0.7" />
      </g>
    </svg>
  );
}

// ── Keyframes style tag ─────────────────────────────────────────
const keyframesCSS = `
@keyframes pulse    { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
@keyframes spin     { to{transform:rotate(360deg)} }
@keyframes scanLine { 0%{top:0;opacity:0} 20%{opacity:1} 80%{opacity:1} 100%{top:100%;opacity:0} }
@keyframes fadeUp   { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
`;

// ══════════════════════════════════════════════════════════════════
interface Props { clienteId: string }

export function TorreControleTab({ clienteId }: Props) {
  const qc = useQueryClient();
  const [competencia, setCompetencia] = useState('');
  const [modo, setModo] = useState<'analise' | 'projecao'>('analise');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drawerSugestaoOpen, setDrawerSugestaoOpen] = useState(false);
  const [sugestoes, setSugestoes] = useState<SugestaoMeta[]>([]);
  const [loadingSugestao, setLoadingSugestao] = useState(false);

  const mesAnt = useMemo(() => competencia ? getMesAnterior(competencia) : '', [competencia]);
  const mesSeg = useMemo(() => competencia ? getMesSeguinte(competencia) : '', [competencia]);

  // ── Fetch cliente ─────────────────────────────────────────────
  const { data: cliente } = useQuery({
    queryKey: ['cliente-torre', clienteId],
    queryFn: async () => {
      const { data } = await supabase.from('clientes').select('id, nome_empresa, razao_social, cnpj, segmento, status, faturamento_faixa').eq('id', clienteId).single();
      return data as Cliente | null;
    },
  });

  // ── Competências com importação ───────────────────────────────
  const { data: importacoes } = useQuery({
    queryKey: ['importacoes-nibo-competencias', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('importacoes_nibo').select('competencia').eq('cliente_id', clienteId).order('competencia', { ascending: false });
      return data || [];
    },
  });

  const competenciaOptions = useMemo(() => {
    if (!importacoes) return [];
    const unique = [...new Set(importacoes.map(i => i.competencia))];
    unique.sort((a, b) => b.localeCompare(a));
    return unique;
  }, [importacoes]);

  useEffect(() => {
    if (competenciaOptions.length && !competencia) setCompetencia(competenciaOptions[0]);
  }, [competenciaOptions, competencia]);

  const navMes = (dir: -1 | 1) => {
    const idx = competenciaOptions.indexOf(competencia);
    const next = idx + dir;
    if (next >= 0 && next < competenciaOptions.length) setCompetencia(competenciaOptions[next]);
  };

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

  const { data: valores, isLoading: loadingValores } = useQuery({
    queryKey: ['valores-mensais-torre', clienteId, competencia],
    enabled: !!clienteId && !!competencia && contaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('valores_mensais').select('*').in('conta_id', contaIds).eq('competencia', competencia);
      return data || [];
    },
  });

  const { data: valoresAnterior } = useQuery({
    queryKey: ['valores-mensais-torre-ant', clienteId, mesAnt],
    enabled: !!clienteId && !!mesAnt && contaIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from('valores_mensais').select('conta_id, valor_realizado').in('conta_id', contaIds).eq('competencia', mesAnt);
      return data || [];
    },
  });

  const { data: metas, isLoading: loadingMetas } = useQuery({
    queryKey: ['torre-metas', clienteId, mesSeg],
    enabled: !!clienteId && !!mesSeg,
    queryFn: async () => {
      const { data } = await supabase.from('torre_metas').select('conta_id, meta_tipo, meta_valor').eq('cliente_id', clienteId).eq('competencia', mesSeg);
      return (data || []) as TorreMeta[];
    },
  });

  const invalidateMetas = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['torre-metas', clienteId, mesSeg] });
  }, [qc, clienteId, mesSeg]);

  // ── Maps ──────────────────────────────────────────────────────
  const realizadoMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valores?.forEach(v => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valores]);

  const anteriorMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valoresAnterior?.forEach(v => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valoresAnterior]);

  const metaMap = useMemo(() => {
    const map: Record<string, TorreMeta> = {};
    metas?.forEach(m => { map[m.conta_id] = m; });
    return map;
  }, [metas]);

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

  // ── Totalizador values ────────────────────────────────────────
  const calcTotais = useCallback((valMap: Record<string, number | null>) => {
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

  const totais = useMemo(() => calcTotais(realizadoMap), [calcTotais, realizadoMap]);
  const totaisAnt = useMemo(() => calcTotais(anteriorMap), [calcTotais, anteriorMap]);
  const faturamento = totais.fat;

  // ── Status counts ─────────────────────────────────────────────
  const statusCounts = useMemo(() => {
    const counts = { ok: 0, atencao: 0, critico: 0 };
    if (!contas) return counts;
    for (const c of contas) {
      if (c.nivel !== 2 || c.is_total) continue;
      const meta = metaMap[c.id] || null;
      const base = realizadoMap[c.id];
      if (!meta || meta.meta_valor === null || base == null) continue;
      const projetado = calcProjetado(base, meta);
      const isReceita = c.tipo === 'receita';
      const s = calcStatus(base, projetado, isReceita);
      if (s === 'ok' || s === 'atencao' || s === 'critico') counts[s]++;
    }
    return counts;
  }, [contas, metaMap, realizadoMap]);

  // ── GC projetado ──────────────────────────────────────────────
  const gcProjetado = useMemo(() => {
    if (!contas) return null;
    let total = 0;
    let hasAny = false;
    for (const c of contas) {
      if (c.nivel !== 2 || c.is_total) continue;
      const meta = metaMap[c.id] || null;
      const base = realizadoMap[c.id];
      const proj = (base != null && meta) ? calcProjetado(base, meta) : null;
      if (proj != null) { total += (c.tipo === 'receita' ? proj : -proj); hasAny = true; }
    }
    return hasAny ? total : null;
  }, [contas, metaMap, realizadoMap]);

  const handleSugerirMetas = async () => {
    if (!cliente) return;
    setLoadingSugestao(true);
    setDrawerSugestaoOpen(true);
    setSugestoes([]);
    try {
      const { data, error } = await supabase.functions.invoke('sugerir-metas', {
        body: { cliente_id: cliente.id, competencia, competencia_anterior: mesAnt },
      });
      if (error) throw error;
      setSugestoes(data?.sugestoes || []);
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
    invalidateMetas();
  };

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some(v => v.valor_realizado != null);
  const isLoading = loadingContas || loadingValores || loadingMetas;

  const compLabel = competencia ? fmtCompetencia(competencia) : '';
  const mesAntLabel = mesAnt ? fmtCompetencia(mesAnt) : '';
  const mesSegLabel = mesSeg ? fmtCompetencia(mesSeg) : '';

  // ── Render row helpers ────────────────────────────────────────
  const renderRow = (node: DreNode, depth: number) => {
    const conta = node.conta;
    const isGrupo = conta.nivel === 0;
    const isSubgrupo = conta.nivel === 1;
    const isCat = conta.nivel === 2;
    const isTotal = !!conta.is_total;
    const hasChildren = node.children.length > 0;
    const isCollapsedItem = collapsed.has(conta.id);

    // Values
    let displayReal: number | null = null;
    let displayAnt: number | null = null;
    if (isCat) {
      displayReal = realizadoMap[conta.id] ?? null;
      displayAnt = anteriorMap[conta.id] ?? null;
    } else {
      displayReal = sumNodeLeafs(node, realizadoMap);
      displayAnt = sumNodeLeafs(node, anteriorMap);
    }

    const meta = metaMap[conta.id] || null;
    const projetado = displayReal != null ? calcProjetado(displayReal, meta) : null;
    const isReceita = conta.tipo === 'receita' || conta.nome.trim().startsWith('(+)');
    const status = displayReal != null ? calcStatus(displayReal, projetado, isReceita) : 'neutro';

    const hasMeta = meta && meta.meta_valor !== null;
    const paddingLeft = isGrupo ? 12 : isSubgrupo ? 24 : 48;

    // Styles
    let rowBg = C.surface;
    let fontWeight = 400;
    let fontSize = 12;
    let textColor = C.txtSec;
    let borderLeft = 'none';

    if (isTotal) {
      rowBg = `linear-gradient(90deg, ${C.pLo}, ${C.cyanLo})`;
      fontWeight = 800;
      fontSize = 13;
      textColor = C.primary;
      borderLeft = `3px solid transparent`;
      // Use gradient border via box-shadow trick
    } else if (isGrupo) {
      rowBg = hasMeta ? C.pLo : C.surface;
      fontWeight = 700;
      fontSize = 12;
      textColor = C.txt;
      borderLeft = hasMeta ? `3px solid ${C.primary}` : 'none';
    } else if (isSubgrupo) {
      rowBg = C.surfaceHi;
      fontWeight = 600;
      textColor = C.txt;
      borderLeft = hasMeta ? `3px solid rgba(0,153,230,0.33)` : 'none';
    } else {
      borderLeft = hasMeta ? `3px solid rgba(0,153,230,0.33)` : 'none';
    }

    return (
      <Fragment key={conta.id}>
        <tr style={{
          background: isTotal ? undefined : rowBg,
          backgroundImage: isTotal ? `linear-gradient(90deg, ${C.pLo}, ${C.cyanLo})` : undefined,
          borderBottom: `1px solid ${isGrupo ? C.borderStr : C.border}`,
          borderLeft,
        }}>
          {/* Expand */}
          <td style={{ width: 24, padding: '0 4px', textAlign: 'center' }}>
            {hasChildren && !isTotal && (isGrupo || isSubgrupo) ? (
              <button onClick={() => toggleCollapse(conta.id)} style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 2, lineHeight: 0, color: C.txtMuted }}>
                {isCollapsedItem ? <ChevronRight style={{ width: 14, height: 14 }} /> : <ChevronDown style={{ width: 14, height: 14 }} />}
              </button>
            ) : null}
          </td>
          {/* Nome */}
          <td style={{ padding: `8px 8px 8px ${paddingLeft}px`, fontWeight, fontSize, color: textColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 360 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isTotal && <span style={{ color: C.cyan, fontSize: 13 }}>◈</span>}
              {hasMeta && !isTotal && !isSubgrupo && !isCat && <span style={{ color: C.primary, fontSize: 6 }}>●</span>}
              {isGrupo && !isTotal ? conta.nome.toUpperCase() : conta.nome}
            </span>
          </td>
          {/* Mês anterior */}
          <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: isTotal ? 13 : 12, fontWeight: isTotal ? 800 : 400, color: displayAnt != null ? (displayAnt < 0 ? C.red : C.txt) : C.txtMuted, padding: '8px 10px', width: 110, borderLeft: isSubgrupo || isCat ? `1px solid ${C.borderStr}` : 'none' }}>
            {fmtTorre(displayAnt)}
          </td>
          {/* Realizado */}
          <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: isTotal ? 13 : 12, fontWeight: isTotal ? 800 : (isGrupo ? 700 : 400), color: displayReal != null ? (displayReal < 0 ? C.red : C.txt) : C.txtMuted, padding: '8px 10px', width: 120 }}>
            {fmtTorre(displayReal)}
          </td>
          {/* Meta */}
          <td style={{ textAlign: 'right', padding: '8px 10px', width: 130 }}>
            <EditableMetaCell
              meta={meta}
              contaId={conta.id}
              clienteId={clienteId}
              competencia={mesSeg}
              isTotal={isTotal}
              onSaved={invalidateMetas}
            />
          </td>
          {/* Projetado */}
          <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: isTotal ? 13 : 12, fontWeight: isTotal ? 800 : 400, color: projetado != null ? C.txtSec : C.txtMuted, padding: '8px 10px', width: 120 }}>
            {fmtTorre(projetado)}
          </td>
          {/* Status */}
          <td style={{ textAlign: 'center', padding: '8px 6px', width: 96 }}>
            {isCat && !isTotal ? <StatusBadge status={status} /> : null}
          </td>
        </tr>
        {!isCollapsedItem && !isTotal && node.children.map(child => renderRow(child, depth + 1))}
      </Fragment>
    );
  };

  const renderTotalizador = (key: string) => {
    const config = TOTALIZADOR_CONFIG[key];
    const realVal = totais[key as keyof typeof totais];
    const antVal = totaisAnt[key as keyof typeof totaisAnt];

    return (
      <tr key={key} style={{ backgroundImage: `linear-gradient(90deg, ${C.pLo}, ${C.cyanLo})`, borderBottom: `2px solid ${C.borderStr}`, borderLeft: `3px solid ${C.primary}` }}>
        <td style={{ width: 24 }} />
        <td style={{ padding: '10px 8px 10px 12px', fontWeight: 800, fontSize: 13, color: C.primary }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: C.cyan, fontSize: 13 }}>◈</span>
            {config.nome}
          </span>
        </td>
        <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 13, fontWeight: 800, color: antVal < 0 ? C.red : C.green, padding: '10px 10px', width: 110 }}>
          {fmtTorre(antVal)}
        </td>
        <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 13, fontWeight: 800, color: realVal < 0 ? C.red : C.green, padding: '10px 10px', width: 120 }}>
          {fmtTorre(realVal)}
        </td>
        <td style={{ textAlign: 'right', padding: '10px 10px', width: 130, color: C.txtMuted, fontFamily: C.mono, fontSize: 12 }}>—</td>
        <td style={{ textAlign: 'right', padding: '10px 10px', width: 120, color: C.txtMuted, fontFamily: C.mono, fontSize: 12 }}>—</td>
        <td style={{ width: 96 }} />
      </tr>
    );
  };

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
        {/* Header card */}
        <div style={{
          background: 'linear-gradient(135deg, #FFFFFF 0%, #EEF4FF 60%, #E6F0FF 100%)',
          border: `1px solid ${C.borderStr}`, borderRadius: 14, padding: '20px 24px',
          boxShadow: '0 2px 20px rgba(26,60,255,0.06)', position: 'relative', overflow: 'hidden',
        }}>
          {/* Internal glow */}
          <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 80% 50%, rgba(0,153,230,0.06), transparent 60%)', pointerEvents: 'none' }} />
          {/* Tower SVG */}
          <div style={{ position: 'absolute', bottom: 8, right: 16, pointerEvents: 'none' }}><TowerSvg /></div>

          <div style={{ position: 'relative', zIndex: 1 }}>
            {/* Eyebrow */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.cyan, animation: 'pulse 2s infinite' }} />
                <span style={{ fontSize: 9, fontWeight: 700, color: C.cyan, letterSpacing: '0.22em' }}>TORRE DE CONTROLE · GPI INTELIGÊNCIA FINANCEIRA</span>
              </div>
              <span style={{ fontSize: 10, fontWeight: 600, color: C.green, background: C.cyanLo, border: `1px solid ${C.cyanBd}`, borderRadius: 6, padding: '3px 10px', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: C.green, animation: 'pulse 2s infinite' }} />
                OPERACIONAL
              </span>
            </div>

            {/* Nome & CNPJ */}
            <div style={{ marginBottom: 12 }}>
              <h2 style={{ fontSize: 22, fontWeight: 700, color: C.txt, margin: 0 }}>{cliente ? nomeExibido(cliente) : ''}</h2>
              {cliente?.cnpj && <p style={{ fontSize: 11, color: C.txtMuted, margin: '2px 0 0' }}>{formatCnpj(cliente.cnpj)}</p>}
            </div>

            {/* Mode switcher + nav */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(8px)', borderRadius: 8, border: `1px solid ${C.border}`, overflow: 'hidden' }}>
                <button
                  onClick={() => { setModo('analise'); }}
                  style={{ padding: '6px 14px', fontSize: 11, fontWeight: modo === 'analise' ? 700 : 500, color: modo === 'analise' ? C.primary : C.txtSec, background: modo === 'analise' ? C.pLo : 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' }}
                >
                  ◀ ANALISAR {compLabel}
                </button>
                <button
                  onClick={() => { setModo('projecao'); }}
                  style={{ padding: '6px 14px', fontSize: 11, fontWeight: modo === 'projecao' ? 700 : 500, color: modo === 'projecao' ? C.primary : C.txtSec, background: modo === 'projecao' ? C.pLo : 'transparent', border: 'none', cursor: 'pointer', letterSpacing: '0.04em' }}
                >
                  PROJETAR {mesSegLabel} ▶
                </button>
              </div>

              {/* Month nav */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <button onClick={() => navMes(1)} disabled={competenciaOptions.indexOf(competencia) >= competenciaOptions.length - 1} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: C.txtSec, opacity: competenciaOptions.indexOf(competencia) >= competenciaOptions.length - 1 ? 0.3 : 1 }}>
                  <ChevronLeft style={{ width: 14, height: 14 }} />
                </button>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.txt, minWidth: 90, textAlign: 'center' }}>{compLabel}</span>
                <button onClick={() => navMes(-1)} disabled={competenciaOptions.indexOf(competencia) <= 0} style={{ background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: C.txtSec, opacity: competenciaOptions.indexOf(competencia) <= 0 ? 0.3 : 1 }}>
                  <ChevronRight style={{ width: 14, height: 14 }} />
                </button>
              </div>
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
        {hasContas && !hasValores && !isLoading && competencia && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, padding: '40px 0', textAlign: 'center' }}>
            <FileSpreadsheet style={{ width: 48, height: 48, color: C.txtMuted, opacity: 0.4 }} />
            <p style={{ fontSize: 14, color: C.txtSec }}>Nenhum valor importado para {compLabel}</p>
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
            <div style={{ width: 32, height: 32, border: `3px solid ${C.border}`, borderTopColor: C.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          </div>
        )}

        {/* Main content */}
        {hasContas && hasValores && !isLoading && (
          <>
            {/* Summary cards */}
            <SummaryCards counts={statusCounts} gcProjetado={gcProjetado} />

            {/* Table */}
            <div style={{ borderRadius: 12, border: `1px solid ${C.border}`, overflow: 'hidden', background: C.surface }}>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 800 }}>
                  <thead>
                    <tr style={{ backgroundImage: `linear-gradient(90deg, ${C.pLo}, ${C.cyanLo})` }}>
                      <th style={{ width: 24 }} />
                      <th style={{ textAlign: 'left', padding: '10px 8px', fontSize: 8, fontWeight: 700, color: C.primary, letterSpacing: '0.14em', textTransform: 'uppercase' }}>CONTA DRE</th>
                      <th style={{ textAlign: 'right', padding: '10px 10px', fontSize: 8, fontWeight: 700, color: C.primary, letterSpacing: '0.14em', width: 110 }}>{mesAntLabel || 'MÊS ANT.'}</th>
                      <th style={{ textAlign: 'right', padding: '10px 10px', fontSize: 8, fontWeight: 700, color: C.primary, letterSpacing: '0.14em', width: 120 }}>REALIZADO</th>
                      <th style={{ textAlign: 'right', padding: '10px 10px', fontSize: 8, fontWeight: 700, color: C.primary, letterSpacing: '0.14em', width: 130 }}>META</th>
                      <th style={{ textAlign: 'right', padding: '10px 10px', fontSize: 8, fontWeight: 700, color: C.primary, letterSpacing: '0.14em', width: 120 }}>PROJETADO {mesSegLabel}</th>
                      <th style={{ textAlign: 'center', padding: '10px 6px', fontSize: 8, fontWeight: 700, color: C.primary, letterSpacing: '0.14em', width: 96 }}>STATUS</th>
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
            </div>
          </>
        )}
      </div>
    </div>
  );
}
