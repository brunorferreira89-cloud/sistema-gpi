import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScoreRing, calcHealthScore } from '@/components/ui/score-ring';
import { SparkLine } from '@/components/ui/spark-line';
import { FileText, ChevronDown, Video, MapPin, Calendar } from 'lucide-react';
import { fetchKpiData, KpiData } from '@/lib/kpi-utils';

const flipTexts: Record<string, { label: string; ref: string; back: string }> = {
  mc: {
    label: 'Margem de Contribuição',
    ref: 'ref: > 40%',
    back: 'Cada R$100 faturado gera contribuição para pagar custos fixos. Benchmark GPI: manter acima de 40%.',
  },
  cmo: {
    label: 'CMO — Mão de Obra',
    ref: 'ref: < 25%',
    back: 'Custo total de pessoal sobre o faturamento. Acima de 25% sinaliza folha desproporcional à receita gerada.',
  },
  gc: {
    label: 'Geração de Caixa',
    ref: 'ref: > 10%',
    back: 'O que sobra de caixa após todas as saídas do mês. Abaixo de 10% não cobre imprevistos nem crescimento.',
  },
};

function getStatusColor(key: string, value: number) {
  if (key === 'mc') return value >= 40 ? '#00A86B' : value >= 35 ? '#D97706' : '#DC2626';
  if (key === 'cmo') return value <= 25 ? '#00A86B' : value <= 30 ? '#D97706' : '#DC2626';
  if (key === 'gc') return value >= 10 ? '#00A86B' : value >= 7 ? '#D97706' : '#DC2626';
  return '#1A3CFF';
}

function getStatusLabel(key: string, value: number) {
  const color = getStatusColor(key, value);
  return color === '#00A86B' ? '✓ ok' : '⚠ atenção';
}

function getPenalties(kpi: KpiData) {
  const p: { text: string; cor: string }[] = [];
  if (kpi.mc_pct < 30) p.push({ text: 'MC% < 30%', cor: 'red' });
  else if (kpi.mc_pct < 40) p.push({ text: 'MC% < 40%', cor: 'amber' });
  if (kpi.cmv_pct > 42) p.push({ text: 'CMV% > 42%', cor: 'red' });
  else if (kpi.cmv_pct > 38) p.push({ text: 'CMV% > 38%', cor: 'amber' });
  if (kpi.cmo_pct > 30) p.push({ text: 'CMO% > 30%', cor: 'red' });
  else if (kpi.cmo_pct > 25) p.push({ text: 'CMO% > 25%', cor: 'amber' });
  if (kpi.gc_pct < 0) p.push({ text: 'GC% negativa', cor: 'red' });
  else if (kpi.gc_pct < 7) p.push({ text: 'GC% < 7%', cor: 'amber' });
  return p.slice(0, 3);
}

export default function MinhaAreaPage() {
  const { profile, user } = useAuth();

  const { data: cliente } = useQuery({
    queryKey: ['minha-area-cliente', profile?.cliente_id],
    queryFn: async () => {
      if (!profile?.cliente_id) return null;
      const { data } = await supabase.from('clientes').select('*').eq('id', profile.cliente_id).single();
      return data;
    },
    enabled: !!profile?.cliente_id,
  });

  // Get most recent competencia
  const { data: latestComp } = useQuery({
    queryKey: ['minha-area-comp', profile?.cliente_id],
    queryFn: async () => {
      if (!profile?.cliente_id) return null;
      const { data: contas } = await supabase.from('plano_de_contas').select('id').eq('cliente_id', profile.cliente_id);
      if (!contas?.length) return null;
      const { data } = await supabase.from('valores_mensais').select('competencia').in('conta_id', contas.map(c => c.id)).order('competencia', { ascending: false }).limit(1);
      return data?.[0]?.competencia || null;
    },
    enabled: !!profile?.cliente_id,
  });

  const { data: kpi } = useQuery({
    queryKey: ['minha-area-kpi', profile?.cliente_id, latestComp],
    queryFn: () => fetchKpiData(profile!.cliente_id!, latestComp!),
    enabled: !!profile?.cliente_id && !!latestComp,
  });

  const { data: proximaReuniao } = useQuery({
    queryKey: ['minha-area-reuniao', profile?.cliente_id],
    queryFn: async () => {
      if (!profile?.cliente_id) return null;
      const hoje = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('reunioes')
        .select('*')
        .eq('cliente_id', profile.cliente_id)
        .eq('status', 'agendada')
        .gte('data_reuniao', hoje)
        .order('data_reuniao', { ascending: true })
        .limit(1);
      return data?.[0] || null;
    },
    enabled: !!profile?.cliente_id,
  });

  const { data: alertaSemana } = useQuery({
    queryKey: ['minha-area-alerta', profile?.cliente_id],
    queryFn: async () => {
      if (!profile?.cliente_id) return null;
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff);
      const seg = monday.toISOString().split('T')[0];
      const { data } = await supabase
        .from('alertas_semanais')
        .select('*')
        .eq('cliente_id', profile.cliente_id)
        .eq('semana_inicio', seg)
        .eq('status', 'enviado')
        .limit(1);
      return data?.[0] || null;
    },
    enabled: !!profile?.cliente_id,
  });

  const { data: reunioesPassadas } = useQuery({
    queryKey: ['minha-area-atas', profile?.cliente_id],
    queryFn: async () => {
      if (!profile?.cliente_id) return [];
      const { data } = await supabase
        .from('reunioes')
        .select('*')
        .eq('cliente_id', profile.cliente_id)
        .eq('status', 'realizada')
        .order('data_reuniao', { ascending: false })
        .limit(3);
      return data || [];
    },
    enabled: !!profile?.cliente_id,
  });

  const score = kpi ? calcHealthScore({
    mc_pct: kpi.mc_pct, cmv_pct: kpi.cmv_pct, cmo_pct: kpi.cmo_pct, gc_pct: kpi.gc_pct, hasData: kpi.hasData,
  }) : 0;

  const penalties = kpi ? getPenalties(kpi) : [];
  const primeiroNome = cliente?.responsavel_nome?.split(' ')[0] || profile?.nome?.split(' ')[0] || 'Cliente';

  const hasCurrentData = !!latestComp;
  const compLabel = latestComp
    ? new Date(latestComp + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : '';

  const [flipped, setFlipped] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setFlipped(p => ({ ...p, [k]: !p[k] }));

  const [expandedAta, setExpandedAta] = useState<string | null>(null);

  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });

  const kpiCards = kpi ? [
    { key: 'mc', value: kpi.mc_pct, spark: kpi.sparkHistory.mc },
    { key: 'cmo', value: kpi.cmo_pct, spark: kpi.sparkHistory.cmo },
    { key: 'gc', value: kpi.gc_pct, spark: kpi.sparkHistory.gc },
  ] : [];

  return (
    <div className="space-y-5 pb-8">
      {/* Header */}
      <div className="rounded-xl px-4 py-3" style={{ background: '#0D1B35' }}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-white tracking-wide">GPI Inteligência Financeira</span>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-green" />
            <span className="text-[10px] text-green">online</span>
          </div>
        </div>
      </div>

      {/* Greeting */}
      <div>
        <p className="text-[11px] text-txt-muted">Olá, {primeiroNome} 👋</p>
        <h1 className="text-lg font-extrabold text-txt">{cliente?.nome_empresa || '...'}</h1>
        <p className="text-[11px] text-txt-muted">
          Mês atual · {hasCurrentData ? 'Fechamento disponível' : 'Aguardando fechamento'}
        </p>
      </div>

      {/* Score Ring */}
      <div className="relative flex items-center justify-center">
        <ScoreRing score={score} size={170} />
        {penalties.length > 0 && (
          <div className="absolute right-0 top-4 space-y-1.5">
            <p className="text-[9px] uppercase text-txt-muted font-semibold tracking-wide">Pontos críticos</p>
            {penalties.map((p, i) => (
              <Badge key={i} variant="outline" className={`text-[9px] block ${p.cor === 'red' ? 'border-red/40 bg-red/10 text-red' : 'border-amber/40 bg-amber/10 text-amber'}`}>
                {p.text}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Próxima reunião — glassmorphism */}
      <div
        className="rounded-2xl p-4 space-y-3"
        style={{
          background: 'linear-gradient(135deg, rgba(26,60,255,0.06), rgba(0,153,230,0.04))',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(26,60,255,0.18)',
          boxShadow: '0 4px 24px rgba(26,60,255,0.1), inset 0 1px 0 rgba(255,255,255,0.6)',
        }}
      >
        <p className="text-[9px] uppercase font-bold tracking-wider text-primary">Próxima Reunião</p>
        {proximaReuniao ? (
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-base font-bold text-txt">{proximaReuniao.titulo}</p>
              <p className="text-xs text-txt-sec">
                {fmtDate(proximaReuniao.data_reuniao)}
                {proximaReuniao.horario && ` · ${proximaReuniao.horario.slice(0, 5).replace(':', 'h')}`}
                {' · '}
                {proximaReuniao.formato === 'video' ? 'Vídeo' : 'Presencial'}
              </p>
            </div>
            <div className="flex flex-col items-center rounded-lg bg-primary px-3 py-2 text-white shrink-0">
              <span className="text-lg font-bold leading-none">{new Date(proximaReuniao.data_reuniao + 'T00:00:00').getDate()}</span>
              <span className="text-[9px] uppercase">{new Date(proximaReuniao.data_reuniao + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'short' })}</span>
            </div>
          </div>
        ) : (
          <p className="text-xs text-txt-muted">Nenhuma reunião agendada</p>
        )}
        {proximaReuniao && (
          <Button className="w-full" style={{ borderRadius: 9 }}>
            Confirmar presença
          </Button>
        )}
      </div>

      {/* KPI Flip Cards */}
      {kpiCards.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase text-txt-muted font-semibold tracking-wide">
            Indicadores do mês · toque para detalhes
          </p>
          {kpiCards.map(({ key, value, spark }) => {
            const info = flipTexts[key];
            const color = getStatusColor(key, value);
            const isFlipped = flipped[key];
            return (
              <div
                key={key}
                className="cursor-pointer"
                style={{ perspective: 900, height: 96 }}
                onClick={() => toggle(key)}
              >
                <div
                  className="relative w-full h-full transition-transform duration-[550ms]"
                  style={{
                    transformStyle: 'preserve-3d',
                    transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0)',
                    transitionTimingFunction: 'cubic-bezier(0.4,0,0.2,1)',
                  }}
                >
                  {/* Front */}
                  <div
                    className="absolute inset-0 rounded-xl p-4 flex items-center justify-between"
                    style={{
                      backfaceVisibility: 'hidden',
                      borderLeft: `4px solid ${color}`,
                      border: `1px solid ${color}88`,
                      borderLeftWidth: 4,
                      background: 'hsl(var(--surface))',
                    }}
                  >
                    <div>
                      <p className="text-[10px] uppercase text-txt-muted font-semibold">{info.label}</p>
                      <p className="text-[26px] font-bold font-mono-data" style={{ color, lineHeight: 1.1 }}>
                        {value.toFixed(1)}%
                      </p>
                      <p className="text-[10px] text-txt-muted">{info.ref}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <SparkLine data={spark} color={color} width={60} height={22} />
                      <Badge
                        variant="outline"
                        className="text-[9px]"
                        style={{ color, borderColor: `${color}55` }}
                      >
                        {getStatusLabel(key, value)}
                      </Badge>
                    </div>
                  </div>

                  {/* Back */}
                  <div
                    className="absolute inset-0 rounded-xl p-4 flex flex-col justify-center"
                    style={{
                      backfaceVisibility: 'hidden',
                      transform: 'rotateY(180deg)',
                      background: `linear-gradient(135deg, ${color}dd, ${color}99)`,
                    }}
                  >
                    <p className="text-[9px] uppercase text-white/70 font-semibold">O que significa</p>
                    <p className="text-xs text-white mt-1 leading-relaxed">{info.back}</p>
                    <p className="text-[9px] text-white/50 mt-2">↩ toque para voltar</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Alertas da semana */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-txt">Alertas da semana</p>
          <ChevronDown className="h-4 w-4 text-primary" style={{ animation: 'floatY 1.5s ease-in-out infinite' }} />
        </div>
        {alertaSemana ? (
          <Card>
            <CardContent className="p-4 space-y-2">
              {alertaSemana.conteudo && typeof alertaSemana.conteudo === 'object' && (alertaSemana.conteudo as any).indicadores?.map((ind: any, i: number) => (
                <div key={i} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                  <span className="text-xs text-txt">{ind.nome}</span>
                  <span className="text-xs font-bold font-mono-data text-txt">{ind.valor}</span>
                </div>
              ))}
              {(alertaSemana.conteudo as any)?.analise && (
                <p className="text-xs text-txt-sec mt-2 italic">{(alertaSemana.conteudo as any).analise}</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-4 text-center">
              <p className="text-xs text-txt-muted">Alerta da semana ainda não disponível</p>
              <p className="text-[10px] text-txt-muted mt-1">Disponível toda sexta-feira até 12h</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Histórico de atas */}
      {reunioesPassadas && reunioesPassadas.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-txt">Reuniões anteriores</p>
          {reunioesPassadas.map((r: any) => (
            <div key={r.id} className="rounded-xl border border-border bg-surface p-3 space-y-1">
              <div
                className="flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedAta(expandedAta === r.id ? null : r.id)}
              >
                <div>
                  <p className="text-xs font-medium text-txt">{fmtDate(r.data_reuniao)}</p>
                  <p className="text-[11px] text-txt-muted">{r.titulo}</p>
                </div>
                {r.ata && <FileText className="h-4 w-4 text-txt-muted" />}
              </div>
              {expandedAta === r.id && r.ata && (
                <div className="mt-2 rounded-lg bg-surface-hi p-3 text-xs text-txt whitespace-pre-wrap border border-border">
                  {r.ata}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
