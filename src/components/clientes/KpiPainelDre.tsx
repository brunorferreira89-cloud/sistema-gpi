import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { KpiDetalheModal } from './KpiDetalheModal';
import { NcgDetalheModal } from './NcgDetalheModal';
import { type ContaRow } from '@/lib/plano-contas-utils';
import {
  fetchMergedIndicadores,
  calcularIndicadores,
  calcScore,
  type IndicadorCalculado,
} from '@/lib/kpi-indicadores-utils';
import { calcNCG, calcNCGPct, calcNCGStatus, calcGapNCG, calcGapStatus } from '@/lib/torre-utils';

const STATUS_CONFIG = {
  verde: { bg: '#00A86B1A', color: '#00A86B', label: '✓' },
  ambar: { bg: '#D977061A', color: '#D97706', label: '⚠' },
  vermelho: { bg: '#DC26261A', color: '#DC2626', label: '✗' },
};

const GAP_STATUS_CONFIG: Record<string, { badge: string; badgeBg: string; badgeText: string }> = {
  ok:      { badge: '● COBERTO', badgeBg: 'rgba(0,168,107,0.30)', badgeText: '#6ee7b7' },
  atencao: { badge: '● ATENÇÃO', badgeBg: 'rgba(217,119,6,0.35)', badgeText: '#fcd34d' },
  critico: { badge: '● CRÍTICO', badgeBg: 'rgba(220,38,38,0.35)', badgeText: '#fca5a5' },
};

const NCG_STATUS_MAP: Record<string, string> = {
  ok: '#00A86B',
  atencao: '#D97706',
  critico: '#DC2626',
};

interface Props {
  clienteId: string;
  competencia: string;
  faturamento?: number;
  cmv?: number;
}

export function KpiPainelDre({ clienteId, competencia, faturamento, cmv }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedKpi, setSelectedKpi] = useState<IndicadorCalculado | null>(null);
  const [ncgModalOpen, setNcgModalOpen] = useState(false);

  const { data: indicadores } = useQuery({
    queryKey: ['kpi-indicadores', clienteId],
    queryFn: () => fetchMergedIndicadores(clienteId),
    enabled: !!clienteId,
  });

  const { data: contas } = useQuery({
    queryKey: ['plano-contas-kpis', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  const { data: valoresData } = useQuery({
    queryKey: ['valores-kpis', clienteId, competencia],
    enabled: !!clienteId && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map(c => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, valor_realizado').in('conta_id', contaIds).eq('competencia', competencia);
      return data || [];
    },
  });

  const { data: cicloData } = useQuery({
    queryKey: ['kpi-ciclo-financeiro', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('kpi_ciclo_financeiro').select('*').eq('cliente_id', clienteId).maybeSingle();
      return data;
    },
  });

  // Fetch caixa disponível from saldos_contas
  const { data: caixaDisponivel } = useQuery({
    queryKey: ['caixa-disponivel', clienteId, competencia],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('saldos_contas')
        .select('saldo_final')
        .eq('cliente_id', clienteId)
        .eq('competencia', competencia);
      if (!data || data.length === 0) return 0;
      return data.reduce((sum, r) => sum + (r.saldo_final ?? 0), 0);
    },
  });

  const valoresMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valoresData?.forEach(v => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valoresData]);

  const calculados = useMemo(() => {
    if (!indicadores || !contas) return [];
    return calcularIndicadores(indicadores, contas, valoresMap);
  }, [indicadores, contas, valoresMap]);

  const ativos = calculados.filter(c => c.indicador.ativo);

  // NCG + GAP calculation
  const ncgCalc = useMemo(() => {
    const fat = faturamento != null ? Math.abs(faturamento) : 0;
    const cv = cmv != null ? Math.abs(cmv) : 0;
    if (!fat) return null;
    const pmr = cicloData?.pmr ?? 30;
    const pme = cicloData?.pme ?? 15;
    const pmp = cicloData?.pmp ?? 30;
    const ncg = calcNCG({ faturamento: fat, cmv: cv, pmr, pme, pmp });
    const pct = calcNCGPct(ncg, fat);
    const status = calcNCGStatus(pct);
    const cx = caixaDisponivel ?? 0;
    const gap = calcGapNCG(ncg, cx);
    const gapStatus = calcGapStatus(gap);
    return { ncg, pct, status, gap, gapStatus, caixa: cx };
  }, [faturamento, cmv, cicloData, caixaDisponivel]);

  const score = calcScore(ativos);

  if (!ativos.length && !ncgCalc) return null;

  const scoreColor = score >= 70 ? '#00A86B' : score >= 40 ? '#D97706' : '#DC2626';
  const allChips = [...ativos];
  const visibleChips = allChips.slice(0, 4);
  const extraCount = allChips.length - 4 + (ncgCalc ? 1 : 0);

  const fmtGap = (v: number) => {
    const abs = Math.abs(v);
    const formatted = abs.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
    return v >= 0 ? `+${formatted}` : `−${formatted}`;
  };

  return (
    <div>
      {/* Banner */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 44,
          padding: '0 16px',
          background: expanded ? '#E8EEF8' : '#F0F4FA',
          borderTop: '1px solid #DDE4F0',
          borderBottom: '1px solid #DDE4F0',
          cursor: 'pointer',
          transition: 'background 0.15s',
          userSelect: 'none',
        }}
        onMouseEnter={e => { (e.currentTarget.style.background = '#E8EEF8'); }}
        onMouseLeave={e => { if (!expanded) e.currentTarget.style.background = '#F0F4FA'; }}
      >
        {/* Left */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, color: '#1A3CFF' }}>◎</span>
          <span style={{ fontSize: 11, color: '#4A5E80', letterSpacing: '0.15em', fontWeight: 600 }}>
            PAINEL DE SAÚDE FINANCEIRA
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              background: scoreColor,
              borderRadius: 10,
              padding: '2px 8px',
              lineHeight: '18px',
            }}
          >
            {score}/100
          </span>
        </div>

        {/* Right */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {visibleChips.map(item => {
            const cfg = STATUS_CONFIG[item.status];
            return (
              <span key={item.indicador.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#4A5E80' }}>
                <svg width="8" height="8"><circle cx="4" cy="4" r="4" fill={cfg.color} /></svg>
                {item.indicador.nome}
              </span>
            );
          })}
          {ncgCalc && visibleChips.length < 4 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#4A5E80' }}>
              <svg width="8" height="8"><circle cx="4" cy="4" r="4" fill={NCG_STATUS_MAP[ncgCalc.gapStatus]} /></svg>
              Cap. de Giro
            </span>
          )}
          {extraCount > 0 && (
            <span style={{ fontSize: 11, color: '#8A9BBC', fontWeight: 500 }}>+{extraCount}</span>
          )}
          {expanded
            ? <ChevronDown className="h-4 w-4" style={{ color: '#4A5E80', transition: 'transform 0.2s' }} />
            : <ChevronRight className="h-4 w-4" style={{ color: '#4A5E80', transition: 'transform 0.2s' }} />
          }
        </div>
      </div>

      {/* Expanded panel */}
      <div
        style={{
          maxHeight: expanded ? 2000 : 0,
          opacity: expanded ? 1 : 0,
          overflow: 'hidden',
          transition: 'max-height 0.3s ease, opacity 0.25s ease',
        }}
      >
        <div
          style={{
            padding: 16,
            background: '#FAFCFF',
            borderBottom: '1px solid #DDE4F0',
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 16px 16px 16px' }}>
            {ativos.map(item => {
              const cfg = STATUS_CONFIG[item.status];
              const pctVal = item.pct ?? 0;
              const barWidth = item.indicador.limite_verde > 0
                ? Math.min(Math.max(pctVal / item.indicador.limite_verde, 0), 1) * 100
                : 0;
              return (
                <div
                  key={item.indicador.id}
                  onClick={() => setSelectedKpi(item)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: '#FFFFFF', border: '1px solid #DDE4F0',
                    borderRadius: 100, padding: '6px 14px 6px 10px',
                    cursor: 'pointer', position: 'relative', overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(13,27,53,0.05)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#1A3CFF'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(26,60,255,0.08)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = '#DDE4F0'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(13,27,53,0.05)'; }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: cfg.color }} />
                  <span style={{ fontSize: 11, color: '#4A5E80', fontWeight: 500, whiteSpace: 'nowrap' }}>{item.indicador.nome}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Courier New', monospace", color: cfg.color }}>{pctVal.toFixed(1)}%</span>
                  {barWidth > 0 && (
                    <span style={{ position: 'absolute', bottom: 0, left: 0, height: 2, borderRadius: '0 1px 1px 0', background: cfg.color, width: `${barWidth}%`, transition: 'width 0.3s ease' }} />
                  )}
                </div>
              );
            })}

            {/* NCG/GAP Chip — cockpit navy style */}
            {ncgCalc && (() => {
              const gapCfg = GAP_STATUS_CONFIG[ncgCalc.gapStatus];
              return (
                <div
                  onClick={() => setNcgModalOpen(true)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    background: '#0D1B35', border: '1px solid rgba(26,60,255,0.25)',
                    borderRadius: 100, padding: '6px 14px 6px 10px',
                    cursor: 'pointer', position: 'relative', overflow: 'hidden',
                    boxShadow: '0 2px 8px rgba(13,27,53,0.25)',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.borderColor = '#1A3CFF'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(26,60,255,0.15)'; }}
                  onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(26,60,255,0.25)'; e.currentTarget.style.boxShadow = '0 2px 8px rgba(13,27,53,0.25)'; }}
                >
                  <span style={{ fontSize: 11 }}>💰</span>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', fontWeight: 600, letterSpacing: '.05em' }}>Cap. de Giro</span>
                  <span style={{ fontSize: 14, fontWeight: 800, fontFamily: "'Courier New', monospace", color: '#FFFFFF' }}>
                    {fmtGap(ncgCalc.gap)}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, color: gapCfg.badgeText,
                    background: gapCfg.badgeBg, padding: '2px 8px', borderRadius: 100,
                  }}>
                    {gapCfg.badge}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {selectedKpi && (
        <KpiDetalheModal
          open={!!selectedKpi}
          onClose={() => setSelectedKpi(null)}
          kpiCalc={selectedKpi}
          competencia={competencia}
        />
      )}

      {ncgModalOpen && (
        <NcgDetalheModal
          open={ncgModalOpen}
          onClose={() => setNcgModalOpen(false)}
          clienteId={clienteId}
          competencia={competencia}
          faturamento={faturamento ?? 0}
          cmv={cmv ?? 0}
          caixaDisponivel={caixaDisponivel ?? 0}
        />
      )}
    </div>
  );
}