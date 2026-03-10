import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Users, ClipboardCheck, Bell, FileSpreadsheet, AlertTriangle, ChevronRight, Users2 } from 'lucide-react';
import { SparkLine } from '@/components/ui/spark-line';
import { calcHealthScore } from '@/components/ui/score-ring';
import { segmentColors } from '@/lib/clientes-utils';

function AnimatedNumber({ value, duration = 800 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const start = performance.now();
    const animate = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(value * ease));
      if (t < 1 && mounted.current) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
    return () => { mounted.current = false; };
  }, [value, duration]);
  return <>{display}</>;
}

export default function DashboardPage() {
  const navigate = useNavigate();

  const { data: clientes } = useQuery({
    queryKey: ['dashboard-clientes'],
    queryFn: async () => {
      const { data } = await supabase.from('clientes').select('id, nome_empresa, segmento, faturamento_faixa, status').eq('status', 'ativo').order('nome_empresa');
      return data || [];
    },
  });

  const { data: tarefasHoje } = useQuery({
    queryKey: ['dashboard-tarefas-hoje'],
    queryFn: async () => {
      const hoje = new Date().toISOString().split('T')[0];
      const { data } = await supabase.from('tarefas_operacionais').select('id, status, tipo, cliente_id, prioridade').eq('data_tarefa', hoje);
      return data || [];
    },
  });

  const { data: alertasSemana } = useQuery({
    queryKey: ['dashboard-alertas-semana'],
    queryFn: async () => {
      const now = new Date();
      const day = now.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diff);
      const seg = monday.toISOString().split('T')[0];
      const { data } = await supabase.from('alertas_semanais').select('id, cliente_id, status').eq('semana_inicio', seg);
      return data || [];
    },
  });

  const { data: proximaColetiva } = useQuery({
    queryKey: ['dashboard-proxima-coletiva'],
    queryFn: async () => {
      const { data } = await supabase
        .from('reunioes_coletivas' as any)
        .select('*')
        .neq('status', 'cancelada')
        .gte('data_reuniao', new Date().toISOString().split('T')[0])
        .order('data_reuniao', { ascending: true })
        .limit(1);
      return (data as any[])?.[0] || null;
    },
  });

  // Score data per client
  const { data: scoreData } = useQuery({
    queryKey: ['dashboard-scores', clientes?.map(c => c.id).join(',')],
    queryFn: async () => {
      if (!clientes?.length) return {};
      const clienteIds = clientes.map(c => c.id);
      const { data: contas } = await supabase.from('plano_de_contas').select('id, cliente_id, nome, tipo').in('cliente_id', clienteIds);
      if (!contas?.length) return {};

      const contaIds = contas.map(c => c.id);
      // Get last 4 months
      const now = new Date();
      const months: string[] = [];
      for (let i = 0; i < 4; i++) {
        const m = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(m.toISOString().split('T')[0]);
      }

      const { data: valores } = await supabase.from('valores_mensais').select('conta_id, competencia, valor_realizado').in('conta_id', contaIds).in('competencia', months);
      if (!valores?.length) return {};

      const contaMap = new Map(contas.map(c => [c.id, c]));
      const result: Record<string, { scores: number[]; currentScore: number; hasCurrentData: boolean }> = {};

      clienteIds.forEach(cid => {
        const clienteContas = contas.filter(c => c.cliente_id === cid);
        const clienteContaIds = new Set(clienteContas.map(c => c.id));
        const scoresByMonth: number[] = [];

        months.forEach(month => {
          const monthVals = (valores || []).filter(v => clienteContaIds.has(v.conta_id) && v.competencia === month);
          if (!monthVals.length) { scoresByMonth.push(0); return; }
          
          let receita = 0, custoVar = 0, despFixa = 0, financeiro = 0;
          monthVals.forEach(v => {
            const conta = contaMap.get(v.conta_id);
            if (!conta || !v.valor_realizado) return;
            if (conta.tipo === 'receita') receita += Number(v.valor_realizado);
            if (conta.tipo === 'custo_variavel') custoVar += Number(v.valor_realizado);
            if (conta.tipo === 'despesa_fixa') despFixa += Number(v.valor_realizado);
            if (conta.tipo === 'financeiro') financeiro += Number(v.valor_realizado);
          });

          const fat = receita || 1;
          const s = calcHealthScore({
            mc_pct: ((receita + custoVar) / fat) * 100,
            cmv_pct: (Math.abs(custoVar) / fat) * 100,
            cmo_pct: (Math.abs(despFixa) / fat) * 100,
            gc_pct: ((receita + custoVar + despFixa + financeiro) / fat) * 100,
            hasData: monthVals.length > 0,
          });
          scoresByMonth.push(s);
        });

        result[cid] = {
          scores: scoresByMonth.reverse(),
          currentScore: scoresByMonth[scoresByMonth.length - 1] || 0,
          hasCurrentData: (valores || []).some(v => clienteContaIds.has(v.conta_id) && v.competencia === months[0]),
        };
      });

      return result;
    },
    enabled: !!clientes?.length,
  });

  // Derived
  const clientesAtivos = clientes?.length || 0;
  const auditorias = (tarefasHoje || []).filter(t => t.tipo === 'auditoria_diaria');
  const auditConc = auditorias.filter(t => t.status === 'concluida').length;
  const auditTotal = auditorias.length;
  const auditPend = auditTotal - auditConc;

  const alertaEnviados = (alertasSemana || []).filter(a => a.status === 'enviado').length;
  const alertaPend = clientesAtivos - alertaEnviados;

  const currentMonth = new Date().toISOString().split('T')[0].slice(0, 8) + '01';
  const clientesSemDre = clientes?.filter(c => !(scoreData?.[c.id]?.hasCurrentData)).length || 0;

  // Internal alerts
  const alertasInternos: { cor: string; texto: string }[] = [];
  clientes?.forEach(c => {
    if (!scoreData?.[c.id]?.hasCurrentData) {
      alertasInternos.push({ cor: 'amber', texto: `${c.nome_empresa} — sem importação Nibo no mês` });
    }
    if (scoreData?.[c.id]?.currentScore != null && scoreData[c.id].currentScore < 40) {
      alertasInternos.push({ cor: 'red', texto: `${c.nome_empresa} — score de saúde < 40` });
    }
  });
  (tarefasHoje || []).filter(t => t.prioridade === 'critica' && t.status !== 'concluida').forEach(t => {
    const nome = clientes?.find(c => c.id === t.cliente_id)?.nome_empresa || '';
    alertasInternos.push({ cor: 'red', texto: `Tarefa crítica pendente — ${nome}` });
  });
  const topAlertas = alertasInternos.sort((a, b) => (a.cor === 'red' ? -1 : 1) - (b.cor === 'red' ? -1 : 1)).slice(0, 5);

  const diasRestantes = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    return Math.ceil((d.getTime() - hoje.getTime()) / 86400000);
  };

  const cards = [
    { label: 'Clientes Ativos', value: clientesAtivos, sub: 'Meta: 30 / 12 meses', progress: (clientesAtivos / 30) * 100, color: 'hsl(var(--primary))' },
    { label: 'Auditorias Hoje', value: auditTotal > 0 ? `${auditConc}/${auditTotal}` : '0', sub: auditPend > 0 ? `${auditPend} pendentes` : 'Todas concluídas', color: auditPend > 0 ? 'hsl(var(--amber))' : 'hsl(var(--green))' },
    { label: 'Alertas da Semana', value: `${alertaEnviados}/${clientesAtivos}`, sub: alertaPend > 0 ? `${alertaPend} pendentes` : 'Todos enviados', color: alertaPend > 0 ? 'hsl(var(--amber))' : 'hsl(var(--green))' },
    { label: 'DREs em Aberto', value: clientesSemDre, sub: 'Fechamento dia 1–5', color: clientesSemDre > 0 ? 'hsl(var(--red))' : 'hsl(var(--green))' },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-txt">Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        {cards.map((card, i) => (
          <Card key={i} className="relative overflow-hidden group" style={{ animation: `fadeUp 0.4s ease-out ${i * 0.07}s both` }}>
            <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${card.color}, transparent)` }} />
            <CardContent className="p-4 space-y-2">
              <p className="text-[10px] font-semibold uppercase text-txt-muted tracking-wide">{card.label}</p>
              <p className="text-2xl font-bold font-mono-data" style={{ color: card.color }}>
                {typeof card.value === 'number' ? <AnimatedNumber value={card.value} /> : card.value}
              </p>
              <p className="text-[11px] text-txt-muted">{card.sub}</p>
              {card.progress != null && typeof card.progress === 'number' && card.label === 'Clientes Ativos' && (
                <Progress value={Math.min(card.progress, 100)} className="h-1.5" />
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-3 gap-5">
        {/* Left 2/3 — Client status table */}
        <div className="col-span-2 space-y-3">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-txt">Status por Cliente</h2>
            <Badge variant="outline" className="text-xs">Mês atual</Badge>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-txt-muted">Cliente</th>
                    <th className="px-4 py-3 text-xs font-semibold text-txt-muted">Segmento</th>
                    <th className="px-4 py-3 text-xs font-semibold text-txt-muted">Faturamento</th>
                    <th className="px-4 py-3 text-xs font-semibold text-txt-muted">Trend</th>
                    <th className="px-4 py-3 text-xs font-semibold text-txt-muted">Score</th>
                    <th className="px-4 py-3 text-xs font-semibold text-txt-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clientes?.map((c, idx) => {
                    const sd = scoreData?.[c.id];
                    const score = sd?.currentScore ?? 0;
                    const scoreColor = score >= 70 ? 'hsl(var(--green))' : score >= 40 ? 'hsl(var(--amber))' : 'hsl(var(--red))';
                    const seg = segmentColors[c.segmento] || segmentColors.outro;
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-border/50 hover:bg-surface-hi cursor-pointer transition-colors"
                        onClick={() => navigate(`/clientes/${c.id}`)}
                        style={{ animation: `fadeUp 0.3s ease-out ${idx * 0.03}s both` }}
                      >
                        <td className="px-4 py-3 font-medium text-txt">{c.nome_empresa}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-[10px] ${seg?.bg} ${seg?.text}`}>
                            {c.segmento}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-txt-sec text-xs">{c.faturamento_faixa}</td>
                        <td className="px-4 py-3">
                          <SparkLine data={sd?.scores || []} color={scoreColor} width={48} height={18} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: scoreColor }} />
                            </div>
                            <span className="text-xs font-bold font-mono-data" style={{ color: scoreColor }}>{score}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: scoreColor }} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right 1/3 */}
        <div className="space-y-4">
          {/* Alertas internos */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-txt flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber" /> Alertas Internos
              </h3>
              {topAlertas.length === 0 ? (
                <p className="text-xs text-txt-muted py-2">Nenhum alerta no momento ✓</p>
              ) : (
                <div className="space-y-2">
                  {topAlertas.map((a, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className={`mt-1 h-2 w-2 rounded-full shrink-0 ${a.cor === 'red' ? 'bg-red' : 'bg-amber'}`} />
                      <p className="text-xs text-txt-sec">{a.texto}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Próxima entrega */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-sm font-semibold text-txt flex items-center gap-1.5">
                <Users2 className="h-4 w-4 text-primary" /> Próxima Entrega
              </h3>
              {proximaColetiva ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-txt">{proximaColetiva.titulo}</p>
                  <p className="text-xs text-txt-sec">
                    {new Date(proximaColetiva.data_reuniao + 'T00:00:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                  {diasRestantes(proximaColetiva.data_reuniao) > 0 && (
                    <Badge variant="outline" className="text-xs border-primary/30 bg-primary-lo text-primary">
                      Faltam {diasRestantes(proximaColetiva.data_reuniao)} dias
                    </Badge>
                  )}
                  <Button size="sm" className="w-full mt-2" onClick={() => navigate(`/reuniao-coletiva/${proximaColetiva.id}`)}>
                    Preparar <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-txt-muted">Nenhuma reunião coletiva agendada</p>
                  <Button size="sm" variant="outline" className="w-full" onClick={() => navigate('/reuniao-coletiva')}>
                    + Planejar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
