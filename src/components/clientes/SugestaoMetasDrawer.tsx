import { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { fmtTorre, fmtCompetencia } from '@/lib/torre-utils';
import { nomeExibido } from '@/lib/clientes-utils';

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

const nivelBadge = (nivel: number) => {
  if (nivel === 0) return { label: 'GRUPO', bg: 'rgba(13,27,53,0.06)', color: C.txtSec };
  if (nivel === 1) return { label: 'SUBGRUPO', bg: C.pLo, color: C.primary };
  return { label: 'CATEGORIA', bg: C.cyanLo, color: C.cyan };
};

const confiancaBadge = (c: 'alta' | 'media' | 'baixa') => {
  if (c === 'alta') return { label: '● ALTA', bg: C.greenBg, color: C.green };
  if (c === 'media') return { label: '◐ MÉDIA', bg: C.orangeBg, color: C.orange };
  return { label: '○ BAIXA', bg: 'rgba(139,155,188,0.12)', color: C.txtMuted };
};

// ── Component ───────────────────────────────────────────────────
export function SugestaoMetasDrawer({ open, onClose, cliente, competencia, sugestoes, metasExistentes, onAplicar, loading, onRegenerar }: SugestaoMetasDrawerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editedValues, setEditedValues] = useState<Record<string, { tipo: 'pct' | 'valor'; valor: number }>>({});
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  // Initialize selections when sugestoes change
  useMemo(() => {
    const sel = new Set<string>();
    sugestoes.forEach(s => {
      if (s.confianca === 'alta' || s.confianca === 'media') sel.add(s.conta_id);
    });
    setSelected(sel);
    setEditedValues({});
    setExpandedCards(new Set());
  }, [sugestoes]);

  const selectedCount = selected.size;
  const existingCount = sugestoes.filter(s => metasExistentes[s.conta_id]?.meta_valor != null).length;
  const counts = useMemo(() => {
    const c = { alta: 0, media: 0, baixa: 0 };
    sugestoes.forEach(s => c[s.confianca]++);
    return c;
  }, [sugestoes]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const getEdited = (s: SugestaoMeta) => editedValues[s.conta_id] || { tipo: s.meta_tipo, valor: s.meta_valor };

  const handleAplicar = async () => {
    setApplying(true);
    const selecionadas = sugestoes.filter(s => selected.has(s.conta_id)).map(s => {
      const edited = getEdited(s);
      return { ...s, meta_tipo: edited.tipo, meta_valor: edited.valor };
    });
    await onAplicar(selecionadas);
    setApplying(false);
  };

  if (!open) return null;

  const compLabel = competencia ? fmtCompetencia(competencia) : '';

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(13,27,53,0.25)', zIndex: 998 }} />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, width: 520, height: '100vh', zIndex: 999,
        background: C.surface, borderLeft: `1px solid ${C.borderStr}`,
        boxShadow: '-4px 0 32px rgba(13,27,53,0.10)',
        display: 'flex', flexDirection: 'column',
        fontFamily: "'DM Sans', system-ui",
      }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #FFFFFF 0%, #EEF4FF 100%)',
          borderBottom: `1px solid ${C.border}`, padding: '20px 24px', position: 'relative', flexShrink: 0,
        }}>
          <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', cursor: 'pointer', color: C.txtMuted, padding: 4 }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
          {!loading && sugestoes.length > 0 && onRegenerar && (
            <button
              onClick={onRegenerar}
              style={{ position: 'absolute', top: 16, right: 44, background: 'none', border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer', color: C.txtSec, padding: '3px 10px', fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
              onMouseEnter={e => { e.currentTarget.style.background = C.pLo; e.currentTarget.style.color = C.primary; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = C.txtSec; }}
            >
              🔄 Regenerar
            </button>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <span style={{ fontSize: 13 }}>✨</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: C.primary, letterSpacing: '0.18em' }}>SUGESTÃO DE METAS · IA</span>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: C.txt, margin: 0 }}>Análise do Claude</h3>
          <p style={{ fontSize: 11, color: C.txtMuted, margin: '4px 0 0' }}>
            {cliente ? nomeExibido(cliente).toUpperCase() : ''} · {compLabel}
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 40 }}>
            <div style={{ width: 36, height: 36, border: `3px solid ${C.border}`, borderTopColor: C.primary, borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ fontSize: 13, color: C.txtSec, margin: 0 }}>O Claude está analisando os dados financeiros...</p>
            <p style={{ fontSize: 11, color: C.txtMuted, margin: 0 }}>Isso pode levar alguns segundos</p>
          </div>
        )}

        {/* Content */}
        {!loading && sugestoes.length > 0 && (
          <>
            {/* Summary bar */}
            <div style={{ padding: '12px 24px', background: C.pLo, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {counts.alta > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: C.green, background: C.greenBg, padding: '2px 8px', borderRadius: 4 }}>{counts.alta} Alta</span>}
                {counts.media > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: C.orange, background: C.orangeBg, padding: '2px 8px', borderRadius: 4 }}>{counts.media} Média</span>}
                {counts.baixa > 0 && <span style={{ fontSize: 10, fontWeight: 600, color: C.txtMuted, background: 'rgba(139,155,188,0.12)', padding: '2px 8px', borderRadius: 4 }}>{counts.baixa} Baixa</span>}
              </div>
              <span style={{ fontSize: 10, color: C.txtMuted }}>{sugestoes.length} sugestões · {existingCount} já têm meta</span>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sugestoes.map(s => {
                  const isSelected = selected.has(s.conta_id);
                  const isExpanded = expandedCards.has(s.conta_id);
                  const nb = nivelBadge(s.nivel);
                  const cb = confiancaBadge(s.confianca);
                  const edited = getEdited(s);
                  const metaAtual = metasExistentes[s.conta_id];

                  return (
                    <div key={s.conta_id} style={{
                      border: `1px solid ${isSelected ? C.pMd : C.border}`, borderRadius: 8,
                      padding: '12px 14px', background: isSelected ? C.surface : 'rgba(139,155,188,0.04)',
                      opacity: isSelected ? 1 : 0.5, transition: 'all 0.15s',
                    }}>
                      {/* Top row */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 8, fontWeight: 700, background: nb.bg, color: nb.color, padding: '2px 6px', borderRadius: 3, letterSpacing: '0.06em' }}>{nb.label}</span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: C.txt }}>{s.conta_nome}</span>
                        </div>
                        <span style={{ fontSize: 8, fontWeight: 700, background: cb.bg, color: cb.color, padding: '2px 8px', borderRadius: 4 }}>{cb.label}</span>
                      </div>

                      {/* Meta row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 10, color: C.txtMuted, width: 80 }}>Meta sugerida:</span>
                        <button
                          onClick={() => setEditedValues(prev => ({ ...prev, [s.conta_id]: { ...edited, tipo: edited.tipo === 'pct' ? 'valor' : 'pct' } }))}
                          style={{ fontSize: 9, fontWeight: 700, color: C.primary, background: C.pLo, border: `1px solid ${C.pMd}`, borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}
                        >
                          {edited.tipo === 'pct' ? '%' : 'R$'}
                        </button>
                        <input
                          type="text"
                          value={edited.valor}
                          onChange={e => {
                            const cleaned = e.target.value.replace(/[^\d.,-]/g, '').replace(',', '.');
                            const num = parseFloat(cleaned);
                            if (!isNaN(num) || cleaned === '' || cleaned === '-') {
                              setEditedValues(prev => ({ ...prev, [s.conta_id]: { ...edited, valor: isNaN(num) ? 0 : num } }));
                            }
                          }}
                          style={{ width: 80, textAlign: 'right', fontFamily: C.mono, fontSize: 12, border: `1px solid ${C.border}`, borderRadius: 4, padding: '2px 6px', outline: 'none', background: C.surfaceHi }}
                        />
                      </div>
                      {metaAtual?.meta_valor != null && (
                        <div style={{ fontSize: 10, color: C.txtMuted, marginBottom: 6, paddingLeft: 80 }}>
                          Meta atual: {metaAtual.meta_tipo === 'pct' ? `${metaAtual.meta_valor}%` : fmtTorre(metaAtual.meta_valor)}
                        </div>
                      )}

                      {/* Accordion + checkbox */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                        <button onClick={() => toggleExpand(s.conta_id)} style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: C.primary, fontWeight: 500, padding: 0 }}>
                          {isExpanded ? <ChevronDown style={{ width: 12, height: 12 }} /> : <ChevronRight style={{ width: 12, height: 12 }} />}
                          Ver análise do Claude
                        </button>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 10, color: C.txtMuted }}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(s.conta_id)} style={{ accentColor: C.primary }} />
                          Aplicar
                        </label>
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
                          {s.parametros.length > 0 && (
                            <div style={{ marginBottom: 8 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: C.txtSec }}>Parâmetros:</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                                {s.parametros.map((p, i) => (
                                  <span key={i} style={{ fontSize: 9, background: C.pLo, color: C.primary, padding: '2px 6px', borderRadius: 3 }}>{p}</span>
                                ))}
                              </div>
                            </div>
                          )}
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: C.txtSec }}>Motivo: </span>
                            <span style={{ fontSize: 12, color: C.txtSec }}>{s.motivo}</span>
                          </div>
                          <div style={{ marginBottom: 6 }}>
                            <span style={{ fontSize: 10, fontWeight: 700, color: C.txtSec }}>Objetivo: </span>
                            <span style={{ fontSize: 12, color: C.txtSec }}>{s.objetivo}</span>
                          </div>
                          {s.impacto_gc && (
                            <div>
                              <span style={{ fontSize: 10, fontWeight: 700, color: C.txtSec }}>Impacto na GC: </span>
                              <span style={{ fontSize: 12, color: C.primary, fontWeight: 600 }}>{s.impacto_gc}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
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
    </>
  );
}
