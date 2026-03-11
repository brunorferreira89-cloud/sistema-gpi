import { useState, useMemo, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { fmtTorre, fmtCompetencia, mesSeguinte } from '@/lib/torre-utils';
import { nomeExibido } from '@/lib/clientes-utils';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// ── Types ───────────────────────────────────────────────────────
export interface SugestaoMeta {
  conta_id: string;
  conta_nome: string;
  nivel: number;
  meta_tipo: 'pct' | 'valor';
  meta_valor: number;
  confianca: 'alta' | 'media' | 'baixa';
  parametros: string[];
  motivo: string;
  objetivo: string;
  impacto_gc: string;
}

interface Cliente {
  id: string;
  nome_empresa: string;
  razao_social?: string | null;
  cnpj?: string | null;
  segmento: string;
  status: string;
  faturamento_faixa: string;
}

interface DreNode { conta: ContaRow; children: DreNode[] }

interface SugestaoMetasDrawerProps {
  open: boolean;
  onClose: () => void;
  cliente: Cliente | null;
  competencia: string;
  sugestoes: SugestaoMeta[];
  metasExistentes: Record<string, { meta_tipo: string; meta_valor: number | null }>;
  onAplicar: (selecionadas: SugestaoMeta[]) => Promise<void>;
  loading: boolean;
  onRegenerar?: () => void;
  geradoEm?: string | null;
  fromCache?: boolean;
  contas?: ContaRow[];
  realizadoMap?: Record<string, number | null>;
  narrativa?: string | null;
}

// ── Colors ───────────────────────────────────────────────────────
const C = {
  primary: '#1A3CFF', pLo: 'rgba(26,60,255,0.06)', pMd: 'rgba(26,60,255,0.14)',
  cyan: '#0099E6', cyanLo: 'rgba(0,153,230,0.07)',
  green: '#00A86B', greenBg: 'rgba(0,168,107,0.08)',
  red: '#DC2626',
  orange: '#D97706', orangeBg: 'rgba(217,119,6,0.08)',
  bg: '#F0F4FA', surface: '#FFFFFF', surfaceHi: '#F6F9FF',
  border: '#DDE4F0', borderStr: '#C4CFEA',
  txt: '#0D1B35', txtSec: '#4A5E80', txtMuted: '#8A9BBC',
  mono: "'Courier New', monospace",
};

// ── DRE Sequence ────────────────────────────────────────────────
const SEQUENCIA_DRE: { tipo: string; totalizadorApos: string | null }[] = [
  { tipo: 'receita', totalizadorApos: null },
  { tipo: 'custo_variavel', totalizadorApos: 'MC' },
  { tipo: 'despesa_fixa', totalizadorApos: 'RO' },
  { tipo: 'investimento', totalizadorApos: 'RAI' },
  { tipo: 'financeiro', totalizadorApos: 'GC' },
];

const TOTALIZADOR_NOMES: Record<string, string> = {
  MC: '= MARGEM DE CONTRIBUIÇÃO',
  RO: '= RESULTADO OPERACIONAL',
  RAI: '= RESULTADO APÓS INVEST.',
  GC: '= GERAÇÃO DE CAIXA',
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

// ── Calc helpers ────────────────────────────────────────────────
function calcDelta(realizado: number, metaTipo: string, metaValor: number): number {
  if (metaTipo === 'pct') return realizado * (metaValor / 100);
  return metaValor - realizado;
}

function fmtVal(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const s = abs >= 1 ? abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '0';
  return v < 0 ? `(${s})` : s;
}

function fmtDelta(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1 ? abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : '0';
  return v >= 0 ? `+ ${s}` : `− ${s}`;
}

// ── Confiança dot color ─────────────────────────────────────────
function confiancaColor(c: 'alta' | 'media' | 'baixa') {
  if (c === 'alta') return C.green;
  if (c === 'media') return C.orange;
  return C.txtMuted;
}

function confiancaLabel(c: 'alta' | 'media' | 'baixa') {
  if (c === 'alta') return 'ALTA CONFIANÇA';
  if (c === 'media') return 'MÉDIA CONFIANÇA';
  return 'BAIXA CONFIANÇA';
}

// ── Meta IA Cell Popover ────────────────────────────────────────
interface ManualMeta { meta_tipo: 'pct' | 'valor'; meta_valor: number }

function MetaIACell({ sugestao, isReceita, isSelected, onToggle, manualMeta, onManualApply, onManualClear }: {
  sugestao: SugestaoMeta; isReceita: boolean; isSelected: boolean; onToggle: () => void;
  manualMeta?: ManualMeta | null;
  onManualApply: (m: ManualMeta) => void;
  onManualClear: () => void;
}) {
  const [popoverState, setPopoverState] = useState<'ia' | 'manual'>(manualMeta ? 'manual' : 'ia');
  const [manualTipo, setManualTipo] = useState<'pct' | 'valor'>(manualMeta?.meta_tipo ?? 'pct');
  const [manualValor, setManualValor] = useState<string>(manualMeta ? String(manualMeta.meta_valor) : '');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when popover opens
  const handleOpenChange = (open: boolean) => {
    setPopoverOpen(open);
    if (open) {
      if (manualMeta) {
        setPopoverState('manual');
        setManualTipo(manualMeta.meta_tipo);
        setManualValor(String(manualMeta.meta_valor));
      } else {
        setPopoverState('ia');
      }
    }
  };

  // Focus input when switching to manual state
  useEffect(() => {
    if (popoverState === 'manual' && popoverOpen) {
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [popoverState, popoverOpen]);

  const handleIgnorar = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isSelected) onToggle();
    setPopoverState('manual');
    setManualValor('');
  };

  const handleAplicarManual = () => {
    const val = parseFloat(manualValor);
    if (isNaN(val) || manualValor.trim() === '') return;
    onManualApply({ meta_tipo: manualTipo, meta_valor: val });
    setPopoverOpen(false);
  };

  const handlePular = () => {
    onManualClear();
    setPopoverOpen(false);
  };

  // Display logic for trigger
  const hasManual = !!manualMeta;
  const metaPositiva = hasManual
    ? manualMeta!.meta_valor > 0
    : sugestao.meta_valor > 0;
  const dirIcon = metaPositiva ? '▲' : '▼';
  const isGood = isReceita ? metaPositiva : !metaPositiva;
  const dirColor = isGood ? C.green : C.red;
  const dotColor = hasManual ? C.primary : confiancaColor(sugestao.confianca);

  const displayLabel = hasManual
    ? (manualMeta!.meta_tipo === 'pct'
      ? `${manualMeta!.meta_valor > 0 ? '+' : ''}${manualMeta!.meta_valor}%`
      : `R$ ${fmtVal(manualMeta!.meta_valor)}`)
    : (sugestao.meta_tipo === 'pct'
      ? `${sugestao.meta_valor > 0 ? '+' : ''}${sugestao.meta_valor}%`
      : `R$ ${fmtVal(sugestao.meta_valor)}`);

  return (
    <Popover open={popoverOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: C.mono, fontSize: 11, padding: '2px 4px', borderRadius: 4,
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(26,60,255,0.06)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          {hasManual ? (
            <>
              <span style={{ fontSize: 10 }}>✏️</span>
              <span style={{ color: C.txt, fontWeight: 500 }}>{displayLabel}</span>
            </>
          ) : (
            <>
              <span style={{ color: dirColor, fontWeight: 700 }}>{dirIcon}</span>
              <span style={{ color: C.txt, fontWeight: 500 }}>{displayLabel}</span>
              <span style={{ color: dotColor, fontSize: 8 }}>●</span>
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="z-[100] p-0 border-0 shadow-none bg-transparent"
        style={{ width: 280 }}
      >
        <div style={{
          background: '#FFFFFF',
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          boxShadow: '0 8px 32px rgba(13,27,53,0.14)',
          padding: '14px 16px',
          fontFamily: "'DM Sans', system-ui",
          position: 'relative', overflow: 'hidden',
        }}>
          {/* STATE 1 — IA Suggestion */}
          <div style={{
            opacity: popoverState === 'ia' ? 1 : 0,
            position: popoverState === 'ia' ? 'relative' : 'absolute',
            top: 0, left: 0, right: 0,
            transition: 'opacity 150ms ease',
            pointerEvents: popoverState === 'ia' ? 'auto' : 'none',
          }}>
            {/* Confiança badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <span style={{ color: confiancaColor(sugestao.confianca), fontSize: 10 }}>●</span>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: confiancaColor(sugestao.confianca) }}>
                {confiancaLabel(sugestao.confianca)}
              </span>
            </div>
            <div style={{ height: 1, background: C.border, margin: '0 0 10px' }} />

            {sugestao.motivo && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.08em', marginBottom: 3 }}>MOTIVO</div>
                <div style={{ fontSize: 12, color: C.txtSec, lineHeight: 1.5 }}>{sugestao.motivo}</div>
              </div>
            )}
            {sugestao.objetivo && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.08em', marginBottom: 3 }}>OBJETIVO</div>
                <div style={{ fontSize: 12, color: C.txtSec, lineHeight: 1.5 }}>{sugestao.objetivo}</div>
              </div>
            )}
            {sugestao.impacto_gc && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: C.txtMuted, letterSpacing: '0.08em', marginBottom: 3 }}>IMPACTO NA GC</div>
                <div style={{ fontSize: 12, color: C.primary, fontWeight: 600, lineHeight: 1.5 }}>{sugestao.impacto_gc}</div>
              </div>
            )}
            {(sugestao.parametros?.length ?? 0) > 0 && (
              <>
                <div style={{ height: 1, background: C.border, margin: '8px 0' }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  <span style={{ fontSize: 9, color: C.txtMuted, marginRight: 4 }}>Parâmetros:</span>
                  {sugestao.parametros.map((p, i) => (
                    <span key={i} style={{ fontSize: 9, background: C.pLo, color: C.primary, padding: '2px 6px', borderRadius: 3 }}>{p}</span>
                  ))}
                </div>
              </>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={(e) => { e.stopPropagation(); if (!isSelected) onToggle(); }}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: isSelected ? `1px solid ${C.green}` : `1px solid ${C.border}`,
                  background: isSelected ? C.greenBg : 'transparent',
                  color: isSelected ? C.green : C.txtSec,
                  cursor: 'pointer', fontFamily: "'DM Sans', system-ui",
                }}
              >
                ✓ Incluir
              </button>
              <button
                onClick={handleIgnorar}
                style={{
                  flex: 1, padding: '6px 0', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: !isSelected ? `1px solid ${C.red}` : `1px solid ${C.border}`,
                  background: !isSelected ? 'rgba(220,38,38,0.06)' : 'transparent',
                  color: !isSelected ? C.red : C.txtSec,
                  cursor: 'pointer', fontFamily: "'DM Sans', system-ui",
                }}
              >
                ✗ Ignorar
              </button>
            </div>
          </div>

          {/* STATE 2 — Manual Input */}
          <div style={{
            opacity: popoverState === 'manual' ? 1 : 0,
            position: popoverState === 'manual' ? 'relative' : 'absolute',
            top: 0, left: 0, right: 0,
            transition: 'opacity 150ms ease',
            pointerEvents: popoverState === 'manual' ? 'auto' : 'none',
          }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: C.txtSec, letterSpacing: '0.15em', marginBottom: 6 }}>
              📝 META MANUAL
            </div>
            <div style={{ fontSize: 11, color: C.txtMuted, marginBottom: 12 }}>
              Sugestão IA ignorada. Defina um valor:
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              {/* Badge %/R$ */}
              <button
                onClick={() => setManualTipo(prev => prev === 'pct' ? 'valor' : 'pct')}
                style={{
                  padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${C.borderStr}`, background: C.bg,
                  color: C.txtSec, cursor: 'pointer', fontFamily: "'DM Sans', system-ui",
                  minWidth: 36, textAlign: 'center',
                }}
              >
                {manualTipo === 'pct' ? '%' : 'R$'}
              </button>

              {/* Input */}
              <input
                ref={inputRef}
                type="number"
                value={manualValor}
                onChange={e => setManualValor(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleAplicarManual();
                  if (e.key === 'Escape') handlePular();
                }}
                placeholder="0"
                style={{
                  width: 90, height: 32, borderRadius: 6,
                  border: `1px solid ${C.borderStr}`,
                  fontFamily: C.mono, fontSize: 12, textAlign: 'right',
                  padding: '0 8px', outline: 'none',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => e.currentTarget.style.borderColor = C.primary}
                onBlur={e => e.currentTarget.style.borderColor = C.borderStr}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                onClick={handleAplicarManual}
                style={{
                  padding: '5px 14px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: 'none', background: C.primary, color: '#FFFFFF',
                  cursor: 'pointer', fontFamily: "'DM Sans', system-ui",
                }}
              >
                ✓ Aplicar
              </button>
              <button
                onClick={handlePular}
                style={{
                  background: 'none', border: 'none', fontSize: 11, color: C.txtMuted,
                  cursor: 'pointer', fontFamily: "'DM Sans', system-ui",
                }}
              >
                Pular →
              </button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Narrativa Comandante GPI ─────────────────────────────────────
const iconesSecao: Record<string, string> = {
  'Leitura dos Instrumentos':       '🎛️',
  'Destino e Altitude Alvo':        '✈️',
  'Por que estes ajustes nos controles': '🕹️',
  'Turbulências no caminho':        '⛈️',
  'Checklist antes da decolagem':   '✅',
};

function NarrativaComandante({ texto }: { texto: string }) {
  const [expanded, setExpanded] = useState(false);

  // Parse sections: split by **Title**
  const sections = useMemo(() => {
    const parts: { titulo: string; corpo: string }[] = [];
    const regex = /\*\*(.+?)\*\*/g;
    let match;
    const matches: { titulo: string; start: number; end: number }[] = [];
    while ((match = regex.exec(texto)) !== null) {
      matches.push({ titulo: match[1], start: match.index, end: match.index + match[0].length });
    }
    for (let i = 0; i < matches.length; i++) {
      const bodyStart = matches[i].end;
      const bodyEnd = i + 1 < matches.length ? matches[i + 1].start : texto.length;
      parts.push({ titulo: matches[i].titulo, corpo: texto.substring(bodyStart, bodyEnd).trim() });
    }
    return parts;
  }, [texto]);

  if (!texto) return null;

  return (
    <div style={{
      margin: '0', borderBottom: `1px solid ${C.border}`,
      background: 'linear-gradient(135deg, rgba(26,60,255,0.02), rgba(0,153,230,0.02))',
    }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 24px', background: 'none', border: 'none',
          cursor: 'pointer', fontFamily: "'DM Sans', system-ui",
        }}
      >
        <span style={{ fontSize: 14 }}>🧑‍✈️</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: C.primary, letterSpacing: '0.08em' }}>
          RELATÓRIO DO COMANDANTE GPI
        </span>
        <span style={{ fontSize: 10, color: C.txtMuted, marginLeft: 'auto' }}>
          {expanded ? '▲ Recolher' : '▼ Expandir'}
        </span>
      </button>
      {expanded && (
        <div style={{ padding: '0 24px 16px', animation: 'modalEnter 0.2s ease forwards' }}>
          {sections.map((sec, i) => {
            const icon = iconesSecao[sec.titulo] || '📋';
            return (
              <div key={i} style={{ marginBottom: 14 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
                }}>
                  <span style={{ fontSize: 13 }}>{icon}</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: C.txt,
                    letterSpacing: '0.03em',
                  }}>{sec.titulo}</span>
                </div>
                <p style={{
                  fontSize: 12, color: C.txtSec, lineHeight: 1.65,
                  margin: 0, paddingLeft: 22,
                  whiteSpace: 'pre-wrap',
                }}>{sec.corpo}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────
export function SugestaoMetasDrawer({
  open, onClose, cliente, competencia, sugestoes, metasExistentes,
  onAplicar, loading, onRegenerar, geradoEm, fromCache,
  contas = [], realizadoMap = {}, narrativa,
}: SugestaoMetasDrawerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [manualMetas, setManualMetas] = useState<Record<string, ManualMeta>>({});

  // Initialize selections when sugestoes change
  useMemo(() => {
    const sel = new Set<string>();
    sugestoes.forEach(s => {
      if (s.confianca === 'alta' || s.confianca === 'media') sel.add(s.conta_id);
    });
    setSelected(sel);
  }, [sugestoes]);

  const sugestaoMap = useMemo(() => {
    const m = new Map<string, SugestaoMeta>();
    sugestoes.forEach(s => m.set(s.conta_id, s));
    return m;
  }, [sugestoes]);

  const tree = useMemo(() => buildDreTree(contas), [contas]);

  const gruposPorTipo = useMemo(() => {
    const map: Record<string, DreNode[]> = {};
    for (const node of tree) {
      const tipo = node.conta.tipo;
      if (!map[tipo]) map[tipo] = [];
      map[tipo].push(node);
    }
    return map;
  }, [tree]);

  // ── Projected values (accounts with selected suggestions get delta applied) ──
  const projetadoMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of contas) {
      if (c.nivel !== 2 || c.is_total) continue;
      const real = realizadoMap[c.id] ?? 0;
      const sug = sugestaoMap.get(c.id);
      if (sug && selected.has(c.id)) {
        const delta = calcDelta(real, sug.meta_tipo, sug.meta_valor);
        m[c.id] = real + delta;
      } else {
        m[c.id] = real;
      }
    }
    return m;
  }, [contas, realizadoMap, sugestaoMap, selected]);

  // Sum projected for node
  function sumProj(node: DreNode): number {
    if (node.conta.nivel === 2) return projetadoMap[node.conta.id] ?? 0;
    let t = 0;
    for (const ch of node.children) t += sumProj(ch);
    return t;
  }

  function sumReal(node: DreNode): number {
    if (node.conta.nivel === 2) return realizadoMap[node.conta.id] ?? 0;
    let t = 0;
    for (const ch of node.children) t += sumReal(ch);
    return t;
  }

  // Check if a node or its children have any suggestion
  function hasAnySugestao(node: DreNode): boolean {
    if (sugestaoMap.has(node.conta.id)) return true;
    return node.children.some(ch => hasAnySugestao(ch));
  }

  // ── Totalizador calculations ──
  function calcTotais(valFn: (grupos: DreNode[]) => number) {
    const fat = valFn(gruposPorTipo['receita'] || []);
    const custos = valFn(gruposPorTipo['custo_variavel'] || []);
    const mc = fat + custos;
    const despesas = valFn(gruposPorTipo['despesa_fixa'] || []);
    const ro = mc + despesas;
    const invest = valFn(gruposPorTipo['investimento'] || []);
    const rai = ro + invest;
    const financ = valFn(gruposPorTipo['financeiro'] || []);
    const gc = rai + financ;
    return { MC: mc, RO: ro, RAI: rai, GC: gc };
  }

  const totaisReal = useMemo(() => calcTotais((grupos) => {
    let t = 0; grupos.forEach(g => t += sumReal(g)); return t;
  }), [gruposPorTipo, realizadoMap]);

  const totaisProj = useMemo(() => calcTotais((grupos) => {
    let t = 0; grupos.forEach(g => t += sumProj(g)); return t;
  }), [gruposPorTipo, projetadoMap]);

  // ── Counts ──
  const counts = useMemo(() => {
    const c = { alta: 0, media: 0, baixa: 0 };
    sugestoes.forEach(s => c[s.confianca]++);
    return c;
  }, [sugestoes]);

  const existingCount = sugestoes.filter(s => metasExistentes[s.conta_id]?.meta_valor != null).length;
  const selectedCount = selected.size;

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleAplicar = async () => {
    setApplying(true);
    const selecionadas = sugestoes.filter(s => selected.has(s.conta_id));
    await onAplicar(selecionadas);
    setApplying(false);
  };

  if (!open) return null;

  const compLabel = competencia ? fmtCompetencia(competencia) : '';
  const nextCompLabel = competencia ? fmtCompetencia(mesSeguinte(competencia)) : '';

  // ── Should show category? ──
  function shouldShowCat(conta: ContaRow): boolean {
    const real = realizadoMap[conta.id];
    if (real != null && real !== 0) return true;
    if (sugestaoMap.has(conta.id)) return true;
    return false;
  }

  // ── Render rows ──
  function renderRows() {
    const rows: React.ReactNode[] = [];

    for (const seq of SEQUENCIA_DRE) {
      const grupos = gruposPorTipo[seq.tipo] || [];

      for (const grupo of grupos) {
        const grupoReal = sumReal(grupo);
        const grupoProj = sumProj(grupo);
        const grupoHasSug = hasAnySugestao(grupo);

        // Grupo row (nivel=0)
        rows.push(
          <tr key={`g-${grupo.conta.id}`} style={{
            background: 'rgba(26,60,255,0.02)',
            borderTop: `1px solid ${C.border}`,
          }}>
            <td style={{ fontSize: 11, fontWeight: 700, color: C.txt, letterSpacing: '0.04em', textTransform: 'uppercase', padding: '10px 12px' }}>
              {grupo.conta.nome}
            </td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 700, color: C.txt, padding: '10px 12px', width: 110 }}>
              {fmtVal(grupoReal)}
            </td>
            <td style={{ textAlign: 'center', padding: '10px 12px', width: 100, color: C.txtMuted }}>—</td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, color: C.txtMuted, padding: '10px 12px', width: 90 }}>
              {grupoHasSug ? fmtDelta(grupoProj - grupoReal) : '—'}
            </td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 700, color: C.txt, padding: '10px 12px', width: 110 }}>
              {fmtVal(grupoProj)}
              {grupoHasSug && renderArrow(grupoReal, grupoProj, seq.tipo === 'receita')}
            </td>
          </tr>
        );

        // Subgrupos and categories
        for (const sub of grupo.children) {
          if (sub.conta.nivel === 1) {
            const subReal = sumReal(sub);
            const subProj = sumProj(sub);
            const subHasSug = hasAnySugestao(sub);

            rows.push(
              <tr key={`s-${sub.conta.id}`} style={{
                background: '#FFFFFF',
                borderBottom: `1px solid rgba(221,228,240,0.5)`,
              }}>
                <td style={{ fontSize: 12, fontWeight: 600, color: C.txt, padding: '8px 12px 8px 20px' }}>
                  {sub.conta.nome}
                </td>
                <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 600, color: C.txt, padding: '8px 12px', width: 110 }}>
                  {fmtVal(subReal)}
                </td>
                <td style={{ textAlign: 'center', padding: '8px 12px', width: 100, color: C.txtMuted }}>—</td>
                <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, color: C.txtMuted, padding: '8px 12px', width: 90 }}>
                  {subHasSug ? fmtDelta(subProj - subReal) : '—'}
                </td>
                <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 600, color: C.txt, padding: '8px 12px', width: 110 }}>
                  {fmtVal(subProj)}
                  {subHasSug && renderArrow(subReal, subProj, seq.tipo === 'receita')}
                </td>
              </tr>
            );

            // Categories under subgrupo
            for (const cat of sub.children) {
              if (!shouldShowCat(cat.conta)) continue;
              renderCatRow(rows, cat, seq.tipo === 'receita');
            }
          } else if (sub.conta.nivel === 2) {
            // Direct category under group
            if (!shouldShowCat(sub.conta)) continue;
            renderCatRow(rows, sub, seq.tipo === 'receita');
          }
        }
      }

      // Totalizador
      if (seq.totalizadorApos) {
        const key = seq.totalizadorApos;
        const realVal = totaisReal[key as keyof typeof totaisReal];
        const projVal = totaisProj[key as keyof typeof totaisProj];
        rows.push(
          <tr key={`t-${key}`} style={{
            background: 'rgba(26,60,255,0.04)',
            borderTop: '2px solid rgba(26,60,255,0.15)',
          }}>
            <td style={{ fontSize: 12, fontWeight: 800, color: C.primary, padding: '10px 12px' }}>
              {TOTALIZADOR_NOMES[key]}
            </td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: C.primary, padding: '10px 12px', width: 110 }}>
              {fmtVal(realVal)}
            </td>
            <td style={{ textAlign: 'center', padding: '10px 12px', width: 100, color: C.txtMuted }}>—</td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 700, color: C.txtMuted, padding: '10px 12px', width: 90 }}>
              {fmtDelta(projVal - realVal)}
            </td>
            <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 12, fontWeight: 800, color: C.primary, padding: '10px 12px', width: 110 }}>
              {fmtVal(projVal)}
              {renderArrow(realVal, projVal, true)}
            </td>
          </tr>
        );
      }
    }

    return rows;
  }

  function renderCatRow(rows: React.ReactNode[], node: DreNode, isReceita: boolean) {
    const conta = node.conta;
    const real = realizadoMap[conta.id] ?? 0;
    const sug = sugestaoMap.get(conta.id);
    const hasSug = !!sug;
    const isSel = selected.has(conta.id);
    const proj = projetadoMap[conta.id] ?? real;
    const delta = proj - real;

    rows.push(
      <tr key={`c-${conta.id}`} style={{
        background: hasSug ? '#FFFFFF' : '#FAFCFF',
        borderLeft: hasSug ? `3px solid ${isSel ? C.primary : 'rgba(26,60,255,0.2)'}` : 'none',
      }}>
        <td style={{
          fontSize: 11,
          fontWeight: hasSug ? 500 : 400,
          color: hasSug ? C.txt : C.txtSec,
          padding: '6px 12px 6px 32px',
        }}>
          {conta.nome}
        </td>
        <td style={{ textAlign: 'right', fontFamily: C.mono, fontSize: 11, fontWeight: 400, color: C.txtSec, padding: '6px 12px', width: 110 }}>
          {fmtVal(real)}
        </td>
        <td style={{ textAlign: 'center', padding: '6px 12px', width: 100, position: 'relative' }}>
          {hasSug ? (
            <MetaIACell
              sugestao={sug!}
              isReceita={isReceita}
              isSelected={isSel}
              onToggle={() => toggleSelect(conta.id)}
            />
          ) : (
            <span style={{ color: C.txtMuted }}>—</span>
          )}
        </td>
        <td style={{
          textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '6px 12px', width: 90,
          color: hasSug ? (deltaColor(delta, isReceita)) : C.txtMuted,
        }}>
          {hasSug ? fmtDelta(delta) : '—'}
        </td>
        <td style={{
          textAlign: 'right', fontFamily: C.mono, fontSize: 11, padding: '6px 12px', width: 110,
          fontWeight: hasSug ? 500 : 400,
          color: hasSug ? C.txt : C.txtSec,
        }}>
          {fmtVal(proj)}
          {hasSug ? renderArrow(real, proj, isReceita) : <span style={{ color: C.txtMuted, marginLeft: 4, fontSize: 10 }}>→</span>}
        </td>
      </tr>
    );
  }

  function deltaColor(delta: number, isReceita: boolean): string {
    if (delta === 0) return C.txtMuted;
    const improving = isReceita ? delta > 0 : delta < 0;
    return improving ? C.green : C.red;
  }

  function renderArrow(real: number, proj: number, isReceita: boolean) {
    if (Math.abs(proj - real) < 0.5) return <span style={{ color: C.txtMuted, marginLeft: 4, fontSize: 10 }}>→</span>;
    const up = proj > real;
    const improving = isReceita ? up : !up;
    const color = improving ? C.green : C.red;
    return <span style={{ color, marginLeft: 4, fontSize: 10 }}>{up ? '↑' : '↓'}</span>;
  }

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(13,27,53,0.45)', zIndex: 50 }} />

      {/* Modal container */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, pointerEvents: 'none',
      }}>
      {/* Modal box */}
      <div style={{
        background: '#FFFFFF', borderRadius: 16,
        width: '100%', maxWidth: 860, maxHeight: '90vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 24px 80px rgba(13,27,53,0.18), 0 0 0 1px rgba(196,207,234,0.5)',
        overflow: 'hidden',
        fontFamily: "'DM Sans', system-ui",
        pointerEvents: 'auto',
        animation: 'modalEnter 0.22s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #FFFFFF 0%, #EEF4FF 100%)',
          borderBottom: `1px solid ${C.border}`, padding: '20px 24px', position: 'relative', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: C.txtMuted, padding: 4 }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>✨</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.primary, letterSpacing: '0.18em' }}>SUGESTÃO DE METAS · IA</span>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: 0 }}>Projeção DRE Comparativa</h3>
          <p style={{ fontSize: 11, color: C.txtMuted, margin: '4px 0 0' }}>
            {cliente ? nomeExibido(cliente).toUpperCase() : ''} · {compLabel}
          </p>
          {geradoEm && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              {fromCache ? (
                <>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#00A86B',
                    background: 'rgba(0,168,107,0.08)', border: '1px solid rgba(0,168,107,0.2)',
                    padding: '2px 7px', borderRadius: 4,
                  }}>✓ CACHE</span>
                  <span style={{ fontSize: 10, color: C.txtMuted }}>
                    Gerado em {new Date(geradoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } as any)}
                  </span>
                </>
              ) : (
                <>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: C.primary,
                    background: 'rgba(26,60,255,0.08)', border: '1px solid rgba(26,60,255,0.18)',
                    padding: '2px 7px', borderRadius: 4,
                  }}>✨ NOVO</span>
                  <span style={{ fontSize: 10, color: C.txtMuted }}>Acabou de ser gerado</span>
                </>
              )}
              {onRegenerar && (
                <button
                  onClick={onRegenerar} disabled={loading}
                  style={{
                    marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 10px', borderRadius: 5, border: `1px solid ${C.borderStr}`,
                    background: 'transparent', color: C.txtSec, fontSize: 10, fontWeight: 600,
                    cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1,
                    fontFamily: "'DM Sans', system-ui", transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { if (!loading) { e.currentTarget.style.borderColor = C.primary; e.currentTarget.style.color = C.primary; } }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = C.borderStr; e.currentTarget.style.color = C.txtSec; }}
                  title="Apaga o cache e gera uma nova análise"
                >🔄 Regenerar</button>
              )}
            </div>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 }}>
            <div style={{ width: 36, height: 36, border: `3px solid ${C.border}`, borderTopColor: C.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 13, color: C.txtSec, margin: 0 }}>A IA está analisando os dados financeiros...</p>
            <p style={{ fontSize: 11, color: C.txtMuted, margin: 0 }}>Isso pode levar alguns segundos</p>
          </div>
        )}

        {/* Content */}
        {!loading && sugestoes.length > 0 && (
          <>
            {/* Summary bar */}
            <div style={{ padding: '10px 24px', background: C.pLo, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {counts.alta > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: C.green, background: C.greenBg, padding: '2px 8px', borderRadius: 4 }}>{counts.alta} Alta</span>}
                {counts.media > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: C.orange, background: C.orangeBg, padding: '2px 8px', borderRadius: 4 }}>{counts.media} Média</span>}
                {counts.baixa > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: C.txtMuted, background: 'rgba(139,155,188,0.12)', padding: '2px 8px', borderRadius: 4 }}>{counts.baixa} Baixa</span>}
              </div>
              <span style={{ fontSize: 10, color: C.txtMuted }}>{sugestoes.length} sugestões · {existingCount} já têm meta</span>
            </div>

            {/* Narrativa Comandante GPI */}
            {narrativa && <NarrativaComandante texto={narrativa} />}

            {/* Table */}
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                {/* Sticky header */}
                <thead>
                  <tr style={{
                    background: 'linear-gradient(135deg, rgba(26,60,255,0.05), rgba(0,153,230,0.03))',
                    borderBottom: `2px solid ${C.border}`,
                    position: 'sticky', top: 0, zIndex: 10,
                  }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: C.txtMuted, textTransform: 'uppercase' }}>
                      Conta DRE
                    </th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: C.txtMuted, textTransform: 'uppercase', width: 110 }}>
                      Realizado<br /><span style={{ fontSize: 8, fontWeight: 600 }}>{compLabel}</span>
                    </th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: C.txtMuted, textTransform: 'uppercase', width: 100 }}>
                      Meta IA
                    </th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: C.txtMuted, textTransform: 'uppercase', width: 90 }}>
                      Δ
                    </th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', fontSize: 9, fontWeight: 800, letterSpacing: '0.14em', color: C.txtMuted, textTransform: 'uppercase', width: 110 }}>
                      Projeção<br /><span style={{ fontSize: 8, fontWeight: 600 }}>{nextCompLabel}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {renderRows()}
                </tbody>
              </table>
            </div>

            {/* Footer */}
            <div style={{
              padding: '16px 24px', borderTop: `1px solid ${C.border}`, background: C.surface, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 11, color: C.txtMuted }}>{selectedCount} de {sugestoes.length} selecionadas</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={onClose} style={{ padding: '8px 16px', borderRadius: 6, border: `1px solid ${C.border}`, background: 'transparent', color: C.txtSec, fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button
                  onClick={handleAplicar}
                  disabled={selectedCount === 0 || applying}
                  style={{
                    padding: '8px 18px', borderRadius: 6, border: 'none', background: C.primary, color: '#FFFFFF',
                    fontSize: 12, fontWeight: 700, cursor: selectedCount === 0 || applying ? 'not-allowed' : 'pointer',
                    opacity: selectedCount === 0 || applying ? 0.5 : 1, display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {applying && <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
                  {applying ? 'Salvando...' : 'Aplicar selecionadas'}
                </button>
              </div>
            </div>
          </>
        )}

        {/* No suggestions */}
        {!loading && sugestoes.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 }}>
            <p style={{ fontSize: 13, color: C.txtSec }}>Nenhuma sugestão disponível.</p>
            <p style={{ fontSize: 11, color: C.txtMuted }}>Verifique se há dados importados para este período.</p>
          </div>
        )}
      </div>
      </div>

      <style>{`
        @keyframes modalEnter {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </>
  );
}
