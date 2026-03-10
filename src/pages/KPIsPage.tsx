import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Target } from 'lucide-react';
import { ArcGauge } from '@/components/ui/arc-gauge';
import { SparkLine } from '@/components/ui/spark-line';
import { LiveDeltaBadge } from '@/components/ui/live-delta-badge';
import { ScoreRing, calcHealthScore } from '@/components/ui/score-ring';
import { fetchKpiData, KpiData } from '@/lib/kpi-utils';

function getLast12Months() {
  const months: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({
      value: d.toISOString().split('T')[0],
      label: d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
    });
  }
  return months;
}

const fmtCurrency = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

function gaugeColor(value: number, benchmark: number, inverted = false) {
  const diff = inverted ? benchmark - value : value - benchmark;
  if (diff >= 0) return '#00A86B';
  if (diff >= -5) return '#D97706';
  return '#DC2626';
}

export default function KPIsPage() {
  const [clienteId, setClienteId] = useState('');
  const currentMonth = new Date();
  currentMonth.setDate(1);
  const [competencia, setCompetencia] = useState(currentMonth.toISOString().split('T')[0]);
  const months = getLast12Months();

  const { data: clientes } = useQuery({
    queryKey: ['clientes-ativos'],
    queryFn: async () => {
      const { data } = await supabase.from('clientes').select('id, nome_empresa, razao_social').eq('status', 'ativo').order('nome_empresa');
      return data || [];
    },
  });

  const { data: kpi, isLoading } = useQuery({
    queryKey: ['kpi-data', clienteId, competencia],
    queryFn: () => fetchKpiData(clienteId, competencia),
    enabled: !!clienteId,
  });

  const { data: lastImport } = useQuery({
    queryKey: ['last-import', clienteId],
    queryFn: async () => {
      const { data } = await supabase
        .from('importacoes_nibo')
        .select('created_at')
        .eq('cliente_id', clienteId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.created_at ? new Date(data.created_at).toLocaleDateString('pt-BR') : null;
    },
    enabled: !!clienteId,
  });

  const score = kpi ? calcHealthScore({
    mc_pct: kpi.mc_pct,
    cmv_pct: kpi.cmv_pct,
    cmo_pct: kpi.cmo_pct,
    gc_pct: kpi.gc_pct,
    hasData: kpi.hasData,
  }) : 0;

  const penalties = kpi ? getPenalties(kpi) : [];

  const scoreLabel = score >= 70
    ? { text: 'Saúde Financeira Adequada', className: 'text-green' }
    : score >= 40
      ? { text: 'Atenção — Pontos Críticos', className: 'text-amber' }
      : { text: 'Risco Elevado — Ação Urgente', className: 'text-red' };

  // Flip card state
  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const toggleFlip = (key: string) => setFlipped((prev) => ({ ...prev, [key]: !prev[key] }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt">KPIs e Indicadores</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={clienteId} onValueChange={setClienteId}>
            <SelectTrigger className="w-52"><SelectValue placeholder="Selecione o cliente" /></SelectTrigger>
            <SelectContent>
              {clientes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={competencia} onValueChange={setCompetencia}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              {months.map((m) => <SelectItem key={m.value} value={m.value} className="capitalize">{m.label}</SelectItem>)}
            </SelectContent>
          </Select>
          {lastImport && (
            <Badge variant="outline" className="text-xs text-txt-muted">
              Última atualização: {lastImport}
            </Badge>
          )}
        </div>
      </div>

      {!clienteId && (
        <div className="flex flex-col items-center justify-center py-20 text-txt-muted">
          <Target className="mb-3 h-12 w-12 opacity-30" />
          <p>Selecione um cliente para visualizar os KPIs</p>
        </div>
      )}

      {clienteId && isLoading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      )}

      {clienteId && kpi && !isLoading && (
        <>
          {/* Score + Arc Gauges */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Score ring */}
            <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-surface p-6">
              <ScoreRing score={score} />
              <p className={`mt-3 text-sm font-bold ${scoreLabel.className}`}>{scoreLabel.text}</p>
              {penalties.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5 justify-center">
                  {penalties.map((p, i) => (
                    <span key={i} className="rounded-full border border-red/30 bg-red/10 px-2 py-0.5 text-[10px] font-medium text-red">
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* 4 Arc gauges */}
            <div className="col-span-2 grid grid-cols-2 gap-4 rounded-xl border border-border bg-surface p-6">
              <ArcGauge value={kpi.mc_pct} benchmark={40} color={gaugeColor(kpi.mc_pct, 40)} label="Margem Contribuição" />
              <ArcGauge value={kpi.cmv_pct} benchmark={38} color={gaugeColor(kpi.cmv_pct, 38, true)} label="CMV" />
              <ArcGauge value={kpi.cmo_pct} benchmark={25} color={gaugeColor(kpi.cmo_pct, 25, true)} label="CMO" />
              <ArcGauge value={kpi.gc_pct} benchmark={10} color={gaugeColor(kpi.gc_pct, 10)} label="Geração de Caixa" />
            </div>
          </div>

          {/* Flip Cards */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FlipCard
              flipped={!!flipped.mc}
              onFlip={() => toggleFlip('mc')}
              label="MARGEM DE CONTRIBUIÇÃO"
              value={`${kpi.mc_pct.toFixed(1)}%`}
              subValue={fmtCurrency(kpi.mc_valor)}
              color={gaugeColor(kpi.mc_pct, 40)}
              sparkData={kpi.sparkHistory.mc}
              realizado={kpi.mc_valor}
              meta={kpi.mc_meta}
              backText={`Cada R$100 faturado gera R$${kpi.mc_pct.toFixed(0)} de contribuição para pagar custos fixos.\nBenchmark GPI: manter acima de 40%.`}
              formula="MC% = (Faturamento - Custos Variáveis) / Faturamento × 100"
            />
            <FlipCard
              flipped={!!flipped.cmv}
              onFlip={() => toggleFlip('cmv')}
              label="CMV"
              value={`${kpi.cmv_pct.toFixed(1)}%`}
              subValue={fmtCurrency(kpi.cmv_valor)}
              color={gaugeColor(kpi.cmv_pct, 38, true)}
              sparkData={kpi.sparkHistory.cmv}
              realizado={kpi.cmv_valor}
              meta={kpi.cmv_meta}
              backText="Custo de mercadoria ou insumos por real faturado.\nAcima de 38% comprime a margem — revisar fornecedores ou precificação."
              formula="CMV% = Custos Variáveis / Faturamento × 100"
            />
            <FlipCard
              flipped={!!flipped.cmo}
              onFlip={() => toggleFlip('cmo')}
              label="CMO"
              value={`${kpi.cmo_pct.toFixed(1)}%`}
              subValue={fmtCurrency(kpi.cmo_valor)}
              color={gaugeColor(kpi.cmo_pct, 25, true)}
              sparkData={kpi.sparkHistory.cmo}
              realizado={kpi.cmo_valor}
              meta={kpi.cmo_meta}
              backText="Custo total de pessoal sobre o faturamento.\nAcima de 25% sinaliza folha desproporcional à receita gerada."
              formula="CMO% = Custos de Pessoal / Faturamento × 100"
            />
            <FlipCard
              flipped={!!flipped.gc}
              onFlip={() => toggleFlip('gc')}
              label="GERAÇÃO DE CAIXA"
              value={`${kpi.gc_pct.toFixed(1)}%`}
              subValue={fmtCurrency(kpi.gc_valor)}
              color={gaugeColor(kpi.gc_pct, 10)}
              sparkData={kpi.sparkHistory.gc}
              realizado={kpi.gc_valor}
              meta={kpi.gc_meta}
              backText="O que sobra de caixa após todas as saídas do mês.\nAbaixo de 10% não cobre imprevistos nem crescimento."
              formula="GC% = Resultado Final / Faturamento × 100"
            />
          </div>

          {/* Ponto de Equilíbrio */}
          <div
            className="cursor-pointer rounded-xl border border-border bg-surface overflow-hidden"
            style={{ perspective: '900px' }}
            onClick={() => toggleFlip('pe')}
          >
            <div
              className="transition-transform duration-[550ms]"
              style={{
                transformStyle: 'preserve-3d',
                transform: flipped.pe ? 'rotateY(180deg)' : 'rotateY(0deg)',
              }}
            >
              {!flipped.pe ? (
                <div className="p-6 space-y-4">
                  <div className="h-[3px] w-full rounded-full" style={{ background: `linear-gradient(90deg, hsl(var(--primary)), transparent)` }} />
                  <p className="text-[9px] uppercase tracking-wider text-txt-muted font-bold">Ponto de Equilíbrio Financeiro</p>
                  <p className="font-mono-data text-2xl font-extrabold text-txt">{fmtCurrency(kpi.pe_valor)}</p>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-txt-muted">
                      <span>Faturamento: {fmtCurrency(kpi.faturamento)}</span>
                      <span>PE: {fmtCurrency(kpi.pe_valor)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.min(100, kpi.pe_valor > 0 ? (kpi.faturamento / kpi.pe_valor) * 100 : 0)}%`,
                          background: kpi.margem_seguranca > 20 ? '#00A86B' : kpi.margem_seguranca > 5 ? '#D97706' : '#DC2626',
                        }}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-txt">Margem de Segurança: {kpi.margem_seguranca.toFixed(1)}%</span>
                    <Badge
                      variant="outline"
                      className={`text-[10px] ${kpi.margem_seguranca > 20 ? 'text-green border-green/30' : kpi.margem_seguranca > 5 ? 'text-amber border-amber/30' : 'text-red border-red/30'}`}
                    >
                      {kpi.margem_seguranca > 20 ? 'Seguro' : kpi.margem_seguranca > 5 ? 'Atenção' : 'Risco'}
                    </Badge>
                  </div>
                  <p className="text-[9px] text-txt-muted">toque para detalhes →</p>
                </div>
              ) : (
                <div className="p-6 space-y-3" style={{ transform: 'rotateY(180deg)' }}>
                  <p className="text-[9px] uppercase tracking-wider text-txt-muted font-bold">O que significa</p>
                  <p className="text-sm text-txt">
                    PE = Custos Fixos ÷ MC%
                  </p>
                  <p className="text-xs text-txt-sec">
                    Custos Fixos: {fmtCurrency(kpi.despesas_fixas)} · MC%: {kpi.mc_pct.toFixed(1)}%
                  </p>
                  <p className="text-sm text-txt">
                    O negócio precisa faturar pelo menos {fmtCurrency(kpi.pe_valor)} para não ter prejuízo.
                  </p>
                  <p className="text-[9px] text-txt-muted">↩ toque para voltar</p>
                </div>
              )}
            </div>
          </div>

          {/* Retiradas dos Sócios */}
          <div
            className="cursor-pointer rounded-xl border border-border bg-surface overflow-hidden"
            style={{ perspective: '900px' }}
            onClick={() => toggleFlip('ret')}
          >
            <div
              className="transition-transform duration-[550ms]"
              style={{
                transformStyle: 'preserve-3d',
                transform: flipped.ret ? 'rotateY(180deg)' : 'rotateY(0deg)',
              }}
            >
              {!flipped.ret ? (
                <div className="p-6 space-y-4">
                  <div className="h-[3px] w-full rounded-full" style={{ background: `linear-gradient(90deg, #9333EA, transparent)` }} />
                  <p className="text-[9px] uppercase tracking-wider text-txt-muted font-bold">Retiradas dos Sócios</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <p className="text-[10px] text-txt-muted mb-1">Valor mensal</p>
                      <p className="font-mono-data text-lg font-extrabold text-txt">{fmtCurrency(kpi.retiradas)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-txt-muted mb-1">% Faturamento</p>
                      <p className={`font-mono-data text-lg font-extrabold ${kpi.retiradas_pct_fat > 5 ? 'text-red' : 'text-txt'}`}>
                        {kpi.retiradas_pct_fat.toFixed(1)}%
                      </p>
                      <span className="text-[9px] text-txt-muted">ref: ≤ 5%</span>
                    </div>
                    <div>
                      <p className="text-[10px] text-txt-muted mb-1">% Geração de Caixa</p>
                      <p className={`font-mono-data text-lg font-extrabold ${kpi.retiradas_pct_gc > 50 ? 'text-red' : 'text-txt'}`}>
                        {kpi.retiradas_pct_gc.toFixed(1)}%
                      </p>
                      <span className="text-[9px] text-txt-muted">ref: ≤ 50%</span>
                    </div>
                  </div>
                  <p className="text-[9px] text-txt-muted">toque para detalhes →</p>
                </div>
              ) : (
                <div className="p-6 space-y-3" style={{ transform: 'rotateY(180deg)' }}>
                  <p className="text-[9px] uppercase tracking-wider text-txt-muted font-bold">Diagnóstico</p>
                  {kpi.retiradas_pct_gc > 50 ? (
                    <>
                      <p className="text-sm font-bold text-red">Retirada insustentável</p>
                      <p className="text-xs text-txt-sec">
                        A retirada consome {kpi.retiradas_pct_gc.toFixed(0)}% da geração de caixa.
                      </p>
                      <p className="text-sm text-txt">
                        Retirada máxima segura: {fmtCurrency(Math.abs(kpi.gc_valor) * 0.5)}
                      </p>
                    </>
                  ) : (
                    <p className="text-sm font-bold text-green">Retirada dentro do limite saudável ✓</p>
                  )}
                  <p className="text-[9px] text-txt-muted">↩ toque para voltar</p>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* FlipCard component */
function FlipCard({
  flipped, onFlip, label, value, subValue, color, sparkData, realizado, meta, backText, formula,
}: {
  flipped: boolean; onFlip: () => void; label: string; value: string; subValue: string;
  color: string; sparkData: number[]; realizado: number; meta: number; backText: string; formula: string;
}) {
  return (
    <div
      className="cursor-pointer rounded-xl border border-border bg-surface overflow-hidden"
      style={{ perspective: '900px' }}
      onClick={onFlip}
    >
      <div
        className="transition-transform duration-[550ms]"
        style={{
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {!flipped ? (
          <div className="p-5 space-y-3">
            <div className="h-[3px] w-full rounded-full" style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />
            <p className="text-[9px] uppercase tracking-wider text-txt-muted font-bold">{label}</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="font-mono-data text-2xl font-extrabold" style={{ color }}>{value}</p>
                <p className="text-xs text-txt-muted">{subValue}</p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <SparkLine data={sparkData} color={color} />
                <LiveDeltaBadge realizado={realizado} meta={meta} />
              </div>
            </div>
            <p className="text-[9px] text-txt-muted">toque para detalhes →</p>
          </div>
        ) : (
          <div className="p-5 space-y-3" style={{ transform: 'rotateY(180deg)', background: `linear-gradient(135deg, ${color}22, ${color}08)` }}>
            <p className="text-[9px] uppercase tracking-wider text-txt-muted font-bold">O que significa</p>
            <p className="text-sm text-txt whitespace-pre-line">{backText}</p>
            <p className="text-[10px] text-txt-sec font-mono-data">{formula}</p>
            <p className="text-[9px] text-txt-muted">↩ toque para voltar</p>
          </div>
        )}
      </div>
    </div>
  );
}

function getPenalties(kpi: KpiData): string[] {
  const p: string[] = [];
  if (kpi.mc_pct < 30) p.push('MC < 30%');
  else if (kpi.mc_pct < 40) p.push('MC < 40%');
  if (kpi.cmv_pct > 42) p.push('CMV > 42%');
  else if (kpi.cmv_pct > 38) p.push('CMV > 38%');
  if (kpi.cmo_pct > 30) p.push('CMO > 30%');
  else if (kpi.cmo_pct > 25) p.push('CMO > 25%');
  if (kpi.gc_pct < 0) p.push('GC negativa');
  else if (kpi.gc_pct < 7) p.push('GC < 7%');
  if (!kpi.hasData) p.push('Sem dados importados');
  return p;
}
