import { useState, useMemo, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { X } from 'lucide-react';
import { calcNCG, calcNCGPct, calcNCGStatus, fmtCompetencia } from '@/lib/torre-utils';

interface Props {
  open: boolean;
  onClose: () => void;
  clienteId: string;
  competencia: string;
  faturamento: number;
  cmv: number;
}

const STATUS_COLORS: Record<string, { color: string; bg: string; label: string }> = {
  ok: { color: '#00A86B', bg: 'rgba(0,168,107,0.12)', label: 'Saudável' },
  atencao: { color: '#D97706', bg: 'rgba(217,119,6,0.12)', label: 'Atenção' },
  critico: { color: '#DC2626', bg: 'rgba(220,38,38,0.12)', label: 'Crítico' },
};

export function NcgDetalheModal({ open, onClose, clienteId, competencia, faturamento, cmv }: Props) {
  const queryClient = useQueryClient();
  const [pmr, setPmr] = useState(30);
  const [pme, setPme] = useState(15);
  const [pmp, setPmp] = useState(30);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const { data: cicloData } = useQuery({
    queryKey: ['kpi-ciclo-financeiro', clienteId],
    enabled: !!clienteId && open,
    queryFn: async () => {
      const { data } = await supabase
        .from('kpi_ciclo_financeiro')
        .select('*')
        .eq('cliente_id', clienteId)
        .maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (cicloData) {
      setPmr(cicloData.pmr);
      setPme(cicloData.pme);
      setPmp(cicloData.pmp);
    }
  }, [cicloData]);

  const absFat = Math.abs(faturamento);
  const absCmv = Math.abs(cmv);

  const calc = useMemo(() => {
    const ncg = calcNCG({ faturamento: absFat, cmv: absCmv, pmr, pme, pmp });
    const pct = calcNCGPct(ncg, absFat);
    const status = calcNCGStatus(pct);
    const receber = (absFat / 30) * pmr;
    const estoques = (absCmv / 30) * pme;
    const pagar = (absCmv / 30) * pmp;
    return { ncg, pct, status, receber, estoques, pagar };
  }, [absFat, absCmv, pmr, pme, pmp]);

  const statusCfg = STATUS_COLORS[calc.status];

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: existing } = await supabase
        .from('kpi_ciclo_financeiro')
        .select('id')
        .eq('cliente_id', clienteId)
        .maybeSingle();

      if (existing) {
        await supabase.from('kpi_ciclo_financeiro').update({ pmr, pme, pmp, updated_at: new Date().toISOString() }).eq('id', existing.id);
      } else {
        await supabase.from('kpi_ciclo_financeiro').insert({ cliente_id: clienteId, pmr, pme, pmp });
      }
      queryClient.invalidateQueries({ queryKey: ['kpi-ciclo-financeiro', clienteId] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const fmtR$ = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const mesLabel = fmtCompetencia(competencia);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(13,27,53,0.45)' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 560, maxHeight: '88vh', borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', animation: 'modalEnter 0.22s ease' }}
      >
        {/* Header */}
        <div style={{ background: '#0D1B35', padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>Capital de Giro</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: statusCfg.color, background: statusCfg.bg, padding: '3px 10px', borderRadius: 100 }}>
              {fmtR$(calc.ncg)}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)' }}>{mesLabel}</span>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 4, lineHeight: 0 }}>
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24, background: '#FAFCFF' }}>
          {/* SEÇÃO 1 — Definição */}
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0099E6' }}>📐 DEFINIÇÃO</span>
          <p style={{ fontSize: 13, color: '#4A5E80', margin: '8px 0 12px', lineHeight: 1.6 }}>
            A Necessidade de Capital de Giro é o valor que a empresa precisa ter disponível para financiar o intervalo entre
            pagar custos e receber dos clientes. Uma NCG alta significa que a operação consome caixa mesmo sendo lucrativa.
          </p>
          <div style={{ background: '#E8EEF8', borderRadius: 8, padding: 12, fontFamily: "'Courier New', monospace", fontSize: 12, color: '#0D1B35', marginBottom: 20 }}>
            NCG = (Fat./30 × PMR) + (CMV/30 × PME) − (CMV/30 × PMP)
          </div>

          {/* SEÇÃO 2 — Cálculo */}
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0099E6' }}>🔢 CÁLCULO — {mesLabel}</span>
          <div style={{ background: '#F6F9FF', borderRadius: 8, padding: 12, marginTop: 8, marginBottom: 20 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <CalcLine label="Contas a Receber" formula={`${fmtR$(absFat)} ÷ 30 × ${pmr} dias`} result={fmtR$(calc.receber)} color="#0D1B35" />
              <CalcLine label="Estoques" formula={`${fmtR$(absCmv)} ÷ 30 × ${pme} dias`} result={fmtR$(calc.estoques)} color="#0D1B35" />
              <CalcLine label="Contas a Pagar" formula={`− ${fmtR$(absCmv)} ÷ 30 × ${pmp} dias`} result={`− ${fmtR$(calc.pagar)}`} color="#DC2626" prefix="−" />
              <div style={{ borderTop: '1px solid #DDE4F0', margin: '4px 0' }} />
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0D1B35' }}>= NCG</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18, fontWeight: 700, color: statusCfg.color }}>{fmtR$(calc.ncg)}</span>
                  <span style={{ fontSize: 12, color: '#8A9BBC' }}>{calc.pct.toFixed(1)}% do fat.</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: statusCfg.color }} />
                <span style={{ fontSize: 11, color: '#4A5E80' }}>Benchmark GPI: até 15% do faturamento — <b style={{ color: statusCfg.color }}>{statusCfg.label}</b></span>
              </div>
            </div>
          </div>

          {/* SEÇÃO 3 — Parâmetros */}
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#0099E6' }}>⚙️ PARÂMETROS DO NEGÓCIO</span>
          <p style={{ fontSize: 11, color: '#8A9BBC', margin: '6px 0 12px' }}>
            Configure os prazos reais do negócio do seu cliente. O cálculo atualiza automaticamente.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <ParamInput label="PMR" sublabel="Prazo de recebimento" value={pmr} onChange={setPmr} />
            <ParamInput label="PME" sublabel="Prazo de estocagem" value={pme} onChange={setPme} />
            <ParamInput label="PMP" sublabel="Prazo de pagamento" value={pmp} onChange={setPmp} />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              width: '100%', marginTop: 16, padding: '10px 0',
              background: saved ? '#00A86B' : '#1A3CFF',
              color: '#fff', border: 'none', borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer',
              transition: 'background 0.2s',
            }}
          >
            {saved ? '✓ Salvo' : saving ? 'Salvando...' : 'Salvar configuração'}
          </button>
          <p style={{ fontSize: 11, color: '#8A9BBC', textAlign: 'center', marginTop: 8 }}>
            Configuração salva por cliente · válida para todos os meses
          </p>
        </div>
      </div>
    </div>
  );
}

function CalcLine({ label, formula, result, color, prefix }: { label: string; formula: string; result: string; color: string; prefix?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div>
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{prefix ? `${prefix} ` : ''}{label}</span>
        <span style={{ fontSize: 11, color: '#8A9BBC', marginLeft: 8 }}>{formula}</span>
      </div>
      <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "'Courier New', monospace", color }}>{result}</span>
    </div>
  );
}

function ParamInput({ label, sublabel, value, onChange }: { label: string; sublabel: string; value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: '#8A9BBC' }}>{label}</span>
      <span style={{ fontSize: 10, color: '#8A9BBC' }}>{sublabel}</span>
      <input
        type="number"
        min={0}
        max={365}
        value={value}
        onChange={e => onChange(Math.max(0, parseInt(e.target.value) || 0))}
        style={{
          border: '1px solid #DDE4F0', borderRadius: 8,
          padding: '8px 12px', fontSize: 16, fontWeight: 700,
          textAlign: 'center', width: '100%', outline: 'none',
          background: '#fff',
        }}
      />
      <span style={{ fontSize: 11, color: '#8A9BBC', textAlign: 'center' }}>dias</span>
    </div>
  );
}
