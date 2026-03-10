import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SparkLine } from '@/components/ui/spark-line';
import { FileText, ChevronDown } from 'lucide-react';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas, sumLeafByTipo } from '@/lib/dre-indicadores';
import {
  fetchMergedIndicadores,
  calcularIndicadores,
  calcScore,
  type IndicadorCalculado,
} from '@/lib/kpi-indicadores-utils';

const STATUS_CONFIG = {
  verde: { bg: '#00A86B1A', color: '#00A86B', label: '✓ ok' },
  ambar: { bg: '#D977061A', color: '#D97706', label: '⚠ atenção' },
  vermelho: { bg: '#DC26261A', color: '#DC2626', label: '✗ crítico' },
};

export default function MinhaAreaPage() {
  const { profile } = useAuth();

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

  // Fetch indicadores
  const { data: indicadores } = useQuery({
    queryKey: ['minha-area-indicadores', profile?.cliente_id],
    queryFn: () => fetchMergedIndicadores(profile!.cliente_id!),
    enabled: !!profile?.cliente_id,
  });

  // Fetch contas
  const { data: contas } = useQuery({
    queryKey: ['minha-area-contas', profile?.cliente_id],
    enabled: !!profile?.cliente_id,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', profile!.cliente_id!).order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  // Fetch valores for latest comp
  const { data: valoresData } = useQuery({
    queryKey: ['minha-area-valores', profile?.cliente_id, latestComp],
    enabled: !!profile?.cliente_id && !!contas?.length && !!latestComp,
    queryFn: async () => {
      const contaIds = contas!.map(c => c.id);
      const { data } = await supabase.from('valores_mensais').select('conta_id, valor_realizado').in('conta_id', contaIds).eq('competencia', latestComp!);
      return data || [];
    },
  });

  const valoresMap: Record<string, number | null> = {};
  valoresData?.forEach(v => { valoresMap[v.conta_id] = v.valor_realizado; });

  const calculados = indicadores && contas
    ? calcularIndicadores(indicadores, contas, valoresMap).filter(c => c.indicador.ativo)
    : [];

  const score = calcScore(calculados);
  const scoreColor = score >= 75 ? '#00A86B' : score >= 50 ? '#D97706' : '#DC2626';
  const scoreMsg = score >= 75
    ? 'Seus indicadores estão saudáveis este mês.'
    : score >= 50
      ? 'Alguns indicadores merecem atenção.'
      : 'Indicadores precisam de ação imediata.';

  const primeiroNome = cliente?.responsavel_nome?.split(' ')[0] || profile?.nome?.split(' ')[0] || 'Cliente';
  const hasCurrentData = !!latestComp;
  const compLabel = latestComp
    ? new Date(latestComp + 'T00:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
    : '';

  const [expandedAta, setExpandedAta] = useState<string | null>(null);
  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' });

  const { data: proximaReuniao } = useQuery({
    queryKey: ['minha-area-reuniao', profile?.cliente_id],
    queryFn: async () => {
      if (!profile?.cliente_id) return null;
      const hoje = new Date().toISOString().split('T')[0];
      const { data } = await supabase.from('reunioes').select('*').eq('cliente_id', profile.cliente_id).eq('status', 'agendada').gte('data_reuniao', hoje).order('data_reuniao', { ascending: true }).limit(1);
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
      const { data } = await supabase.from('alertas_semanais').select('*').eq('cliente_id', profile.cliente_id).eq('semana_inicio', seg).eq('status', 'enviado').limit(1);
      return data?.[0] || null;
    },
    enabled: !!profile?.cliente_id,
  });

  const { data: reunioesPassadas } = useQuery({
    queryKey: ['minha-area-atas', profile?.cliente_id],
    queryFn: async () => {
      if (!profile?.cliente_id) return [];
      const { data } = await supabase.from('reunioes').select('*').eq('cliente_id', profile.cliente_id).eq('status', 'realizada').order('data_reuniao', { ascending: false }).limit(3);
      return data || [];
    },
    enabled: !!profile?.cliente_id,
  });

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

      {/* Saúde do Negócio Card */}
      <div className="rounded-xl border p-6" style={{ borderColor: '#DDE4F0', background: '#FFFFFF' }}>
        <div className="flex flex-col items-center">
          <div className="relative" style={{ width: 120, height: 120 }}>
            <svg width="120" height="120" viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="50" fill="none" stroke="#F0F4FA" strokeWidth="8" />
              <circle
                cx="60" cy="60" r="50" fill="none"
                stroke={scoreColor} strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={`${(score / 100) * 314} 314`}
                transform="rotate(-90 60 60)"
                style={{ transition: 'stroke-dasharray 0.8s ease' }}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center font-extrabold" style={{ fontSize: 36, color: scoreColor }}>{score}</span>
          </div>
          <p className="mt-2 text-sm font-medium" style={{ color: '#4A5E80' }}>
            Saúde Financeira{compLabel ? ` — ${compLabel}` : ''}
          </p>
        </div>

        {/* Indicator list */}
        {calculados.length > 0 && (
          <div className="mt-4 space-y-2">
            {calculados.map(item => {
              const cfg = STATUS_CONFIG[item.status];
              return (
                <div key={item.indicador.id} className="flex items-center justify-between py-1.5" style={{ borderBottom: '1px solid #F0F4FA' }}>
                  <div className="flex items-center gap-2">
                    <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill={cfg.color} /></svg>
                    <span className="text-xs" style={{ color: '#0D1B35' }}>{item.indicador.nome}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-medium" style={{ color: '#0D1B35' }}>
                      {item.pct != null ? `${item.pct.toFixed(1)}%` : '—'}
                    </span>
                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: cfg.bg, color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Context message */}
        <p className="mt-3 text-xs text-center" style={{ color: '#8A9BBC' }}>{scoreMsg}</p>
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
