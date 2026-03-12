import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ArcGauge } from '@/components/ui/arc-gauge';
import { SparkLine } from '@/components/ui/spark-line';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { KpiDetalheModal } from './KpiDetalheModal';
import { type ContaRow } from '@/lib/plano-contas-utils';
import {
  fetchMergedIndicadores,
  calcularIndicadores,
  calcScore,
  getLast6Months,
  type IndicadorCalculado,
} from '@/lib/kpi-indicadores-utils';

const STATUS_CONFIG = {
  verde: { bg: '#00A86B1A', color: '#00A86B', label: '✓' },
  ambar: { bg: '#D977061A', color: '#D97706', label: '⚠' },
  vermelho: { bg: '#DC26261A', color: '#DC2626', label: '✗' },
};

const fmtCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

interface Props {
  clienteId: string;
  competencia: string;
}

export function KpiPainelDre({ clienteId, competencia }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [selectedKpi, setSelectedKpi] = useState<import('@/lib/kpi-indicadores-utils').IndicadorCalculado | null>(null);

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

  const sparkMonths = useMemo(() => getLast6Months(competencia), [competencia]);
  const { data: sparkData } = useQuery({
    queryKey: ['valores-spark-kpis', clienteId, competencia],
    enabled: !!clienteId && !!contas?.length,
    queryFn: async () => {
      const contaIds = contas!.map(c => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, competencia, valor_realizado').in('conta_id', contaIds).in('competencia', sparkMonths);
      return data || [];
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
  const score = calcScore(ativos);

  const sparkHistories = useMemo(() => {
    if (!sparkData || !contas || !indicadores) return new Map<string, number[]>();
    const map = new Map<string, number[]>();
    for (const ind of indicadores.filter(i => i.ativo)) {
      const history = sparkMonths.map(m => {
        const monthMap: Record<string, number | null> = {};
        sparkData.filter(v => v.competencia === m).forEach(v => { monthMap[v.conta_id] = v.valor_realizado; });
        const results = calcularIndicadores([ind], contas, monthMap);
        return results[0]?.pct ?? 0;
      });
      map.set(ind.id, history);
    }
    return map;
  }, [sparkData, contas, indicadores, sparkMonths]);

  if (!ativos.length) return null;

  const scoreColor = score >= 70 ? '#00A86B' : score >= 40 ? '#D97706' : '#DC2626';
  const visibleChips = ativos.slice(0, 4);
  const extraCount = ativos.length - 4;

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
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ativos.map(item => {
              const cfg = STATUS_CONFIG[item.status];
              const spark = sparkHistories.get(item.indicador.id) || [];
              return (
                <div
                  key={item.indicador.id}
                  className="rounded-xl border p-5"
                  style={{ borderColor: '#DDE4F0', background: '#FFFFFF', cursor: 'pointer', transition: 'box-shadow 0.15s' }}
                  onClick={() => setSelectedKpi(item)}
                  onMouseEnter={e => (e.currentTarget.style.boxShadow = '0 4px 16px rgba(26,60,255,0.1)')}
                  onMouseLeave={e => (e.currentTarget.style.boxShadow = 'none')}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[13px] font-semibold" style={{ color: '#0D1B35' }}>{item.indicador.nome}</span>
                    <span className="text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-center my-2">
                    <ArcGauge
                      value={item.pct ?? 0}
                      benchmark={item.indicador.limite_verde}
                      color={cfg.color}
                      label=""
                      size={120}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <div>
                      <span className="text-xs" style={{ color: '#4A5E80' }}>{fmtCurrency(Math.abs(item.valor ?? 0))}</span>
                      <span className="text-[11px] ml-1" style={{ color: '#8A9BBC' }}>/ {fmtCurrency(item.faturamento)} fat.</span>
                    </div>
                    <SparkLine data={spark} color={cfg.color} width={50} height={18} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
