import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BookOpen, ArrowLeft, Calendar } from 'lucide-react';
import { OnboardingTab } from '@/components/clientes/OnboardingTab';
import { TreinamentoTab } from '@/components/clientes/TreinamentoTab';
import { FinanceiroTab } from '@/components/clientes/FinanceiroTab';
import { KPIsTab } from '@/components/clientes/KPIsTab';
import { AlertasTab } from '@/components/clientes/AlertasTab';
import { segmentColors, segmentLabels, faixaLabels, statusColors, statusLabels } from '@/lib/clientes-utils';
import { toast } from '@/hooks/use-toast';
import { ReuniaoDialog } from '@/components/reunioes/ReuniaoDialog';
import { ScoreRing, calcHealthScore } from '@/components/ui/score-ring';
import { fetchKpiData } from '@/lib/kpi-utils';

export default function ClienteFichaPage() {
  const { clienteId } = useParams<{ clienteId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reuniaoDialogOpen, setReuniaoDialogOpen] = useState(false);

  const { data: cliente, isLoading } = useQuery({
    queryKey: ['cliente', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('*').eq('id', clienteId!).single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!clienteId,
  });

  const { data: onboardingStats } = useQuery({
    queryKey: ['onboarding', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from('onboarding_checklist' as any).select('concluido').eq('cliente_id', clienteId!);
      if (error) throw error;
      const items = data as any[];
      return { done: items.filter((i) => i.concluido).length, total: items.length };
    },
    enabled: !!clienteId,
  });

  const { data: treinamentoStats } = useQuery({
    queryKey: ['treinamento-stats', clienteId],
    queryFn: async () => {
      const { data, error } = await supabase.from('treinamento_progresso' as any).select('concluido').eq('cliente_id', clienteId!);
      if (error) throw error;
      const items = data as any[];
      return { done: items.filter((i) => i.concluido).length, total: items.length };
    },
    enabled: !!clienteId,
  });

  const { data: planoStats } = useQuery({
    queryKey: ['plano-stats', clienteId],
    queryFn: async () => {
      const { data: contas, error } = await supabase.from('plano_de_contas').select('id').eq('cliente_id', clienteId!);
      if (error) throw error;
      const contaIds = contas?.map((c) => c.id) || [];
      let metasPendentes = 0;
      if (contaIds.length) {
        const comp = new Date();
        comp.setDate(1);
        const { data: valores } = await supabase
          .from('valores_mensais')
          .select('conta_id, valor_meta')
          .eq('competencia', comp.toISOString().split('T')[0])
          .in('conta_id', contaIds);
        const metasMap = new Set(valores?.filter((v) => v.valor_meta != null).map((v) => v.conta_id));
        metasPendentes = contaIds.length - metasMap.size;
      }
      return { contas: contas?.length || 0, metasPendentes };
    },
    enabled: !!clienteId,
  });

  const { data: proximaReuniao } = useQuery({
    queryKey: ['proxima-reuniao', clienteId],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('reunioes' as any)
        .select('*')
        .eq('cliente_id', clienteId!)
        .eq('tipo', 'individual')
        .eq('status', 'agendada')
        .gte('data_reuniao', today)
        .order('data_reuniao', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    enabled: !!clienteId,
  });

  const currentComp = (() => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]; })();
  const { data: kpiData } = useQuery({
    queryKey: ['kpi-ficha', clienteId, currentComp],
    queryFn: () => fetchKpiData(clienteId!, currentComp),
    enabled: !!clienteId,
  });
  const healthScore = kpiData ? calcHealthScore({
    mc_pct: kpiData.mc_pct, cmv_pct: kpiData.cmv_pct,
    cmo_pct: kpiData.cmo_pct, gc_pct: kpiData.gc_pct, hasData: kpiData.hasData,
  }) : 0;

  const updateMutation = useMutation({
    mutationFn: async (updates: Record<string, any>) => {
      const { error } = await supabase.from('clientes').update(updates as any).eq('id', clienteId!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cliente', clienteId] });
      toast({ title: 'Atualizado com sucesso' });
    },
  });

  if (isLoading || !cliente) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const seg = segmentColors[cliente.segmento] || segmentColors.outro;
  const st = statusColors[cliente.status] || statusColors.ativo;
  const diasCliente = Math.floor((Date.now() - new Date(cliente.created_at).getTime()) / 86400000);
  const obPct = onboardingStats ? (onboardingStats.total ? Math.round((onboardingStats.done / onboardingStats.total) * 100) : 0) : 0;
  const trPct = treinamentoStats ? (treinamentoStats.total ? Math.round((treinamentoStats.done / treinamentoStats.total) * 100) : 0) : 0;
  const progressColor = (pct: number) => (pct >= 100 ? 'text-green' : pct >= 50 ? 'text-amber' : 'text-red');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/clientes')} className="rounded-md p-1.5 text-txt-muted hover:bg-surface-hi">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-txt">{cliente.nome_empresa}</h2>
          <div className="mt-1 flex items-center gap-2 text-xs text-txt-muted">
            <Popover>
              <PopoverTrigger>
                <span className={`cursor-pointer rounded-full px-2 py-0.5 font-medium ${seg.bg} ${seg.text}`}>
                  {segmentLabels[cliente.segmento] || cliente.segmento}
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-44 p-2">
                <Select defaultValue={cliente.segmento} onValueChange={(v) => updateMutation.mutate({ segmento: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(segmentLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger>
                <span className={`cursor-pointer rounded-full px-2 py-0.5 font-medium ${st.bg} ${st.text}`}>
                  {statusLabels[cliente.status] || cliente.status}
                </span>
              </PopoverTrigger>
              <PopoverContent className="w-40 p-2">
                <Select defaultValue={cliente.status} onValueChange={(v) => updateMutation.mutate({ status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusLabels).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </PopoverContent>
            </Popover>
            <span>·</span>
            <span>{faixaLabels[cliente.faturamento_faixa] || cliente.faturamento_faixa}</span>
            <span>·</span>
            <span>{new Date(cliente.created_at).toLocaleDateString('pt-BR')}</span>
            <span>·</span>
            <span>{diasCliente} dias como cliente</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="visao-geral">
        <TabsList className="flex-wrap">
          <TabsTrigger value="visao-geral">Visão Geral</TabsTrigger>
          <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
          <TabsTrigger value="kpis">KPIs</TabsTrigger>
          <TabsTrigger value="alertas">Alertas</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="treinamento">Treinamento</TabsTrigger>
          <TabsTrigger value="contato">Contato</TabsTrigger>
        </TabsList>

        {/* Visão Geral */}
        <TabsContent value="visao-geral" className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
              <p className="text-sm font-semibold text-txt">Onboarding</p>
              <p className={`text-lg font-bold ${progressColor(obPct)}`}>
                {onboardingStats?.done || 0} / {onboardingStats?.total || 0} itens
              </p>
              <Progress value={obPct} className="h-2" />
            </div>
            <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
              <p className="text-sm font-semibold text-txt">Treinamento</p>
              <p className={`text-lg font-bold ${progressColor(trPct)}`}>
                {treinamentoStats?.done || 0} / {treinamentoStats?.total || 0} módulos
              </p>
              <Progress value={trPct} className="h-2" />
            </div>
            <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
              <p className="text-sm font-semibold text-txt">Plano de Contas</p>
              <p className="text-lg font-bold text-txt">
                {planoStats?.contas || 0} contas · {planoStats?.metasPendentes || 0} metas pendentes
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
              <p className="text-sm font-semibold text-txt">Próxima Reunião</p>
              {proximaReuniao ? (
                <>
                  <p className="text-sm text-txt">
                    {new Date(proximaReuniao.data_reuniao + 'T00:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
                    {proximaReuniao.horario && ` · ${(proximaReuniao.horario as string).slice(0, 5).replace(':', 'h')}`}
                  </p>
                  <span className="text-xs text-txt-muted capitalize">{proximaReuniao.formato === 'video' ? 'Vídeo' : 'Presencial'}</span>
                </>
              ) : (
                <>
                  <p className="text-sm text-txt-muted">Nenhuma reunião agendada</p>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setReuniaoDialogOpen(true)}>
                    <Calendar className="h-3.5 w-3.5" /> Agendar
                  </Button>
                </>
              )}
            </div>
            <div className="rounded-xl border border-border bg-surface p-5 flex flex-col items-center justify-center gap-2 sm:col-span-2">
              <p className="text-sm font-semibold text-txt">Saúde Financeira</p>
              <ScoreRing score={healthScore} size={80} />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
            <p className="text-sm font-semibold text-txt">Informações do responsável</p>
            <InlineField label="Nome" value={cliente.responsavel_nome || ''} onSave={(v) => updateMutation.mutate({ responsavel_nome: v })} />
            <InlineField label="E-mail" value={cliente.responsavel_email || ''} onSave={(v) => updateMutation.mutate({ responsavel_email: v })} />
            <InlineField label="WhatsApp" value={cliente.responsavel_whatsapp || ''} onSave={(v) => updateMutation.mutate({ responsavel_whatsapp: v })} />
          </div>
        </TabsContent>

        {/* Financeiro */}
        <TabsContent value="financeiro">
          <FinanceiroTab
            clienteId={clienteId!}
            clienteNome={cliente.nome_empresa}
            clienteSegmento={cliente.segmento}
            clienteFaixa={cliente.faturamento_faixa}
          />
        </TabsContent>

        {/* KPIs */}
        <TabsContent value="kpis">
          <KPIsTab clienteId={clienteId!} />
        </TabsContent>

        {/* Alertas */}
        <TabsContent value="alertas">
          <AlertasTab clienteId={clienteId!} clienteNome={cliente.nome_empresa} />
        </TabsContent>

        {/* Onboarding */}
        <TabsContent value="onboarding">
          <OnboardingTab clienteId={clienteId!} />
        </TabsContent>

        {/* Treinamento */}
        <TabsContent value="treinamento">
          <TreinamentoTab clienteId={clienteId!} />
        </TabsContent>

        {/* Contato */}
        <TabsContent value="contato" className="space-y-4">
          <div className="rounded-xl border border-border bg-surface p-5 space-y-4">
            <p className="text-sm font-semibold text-txt">Dados de contato</p>
            <InlineField label="Nome do responsável" value={cliente.responsavel_nome || ''} onSave={(v) => updateMutation.mutate({ responsavel_nome: v })} />
            <InlineField label="E-mail" value={cliente.responsavel_email || ''} onSave={(v) => updateMutation.mutate({ responsavel_email: v })} />
            <InlineField label="WhatsApp" value={cliente.responsavel_whatsapp || ''} onSave={(v) => updateMutation.mutate({ responsavel_whatsapp: v })} />
          </div>
          <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
            <p className="text-sm font-semibold text-txt">Observações internas</p>
            <Textarea
              defaultValue={cliente.observacoes || ''}
              placeholder="Notas sobre este cliente..."
              onBlur={(e) => {
                if (e.target.value !== (cliente.observacoes || '')) {
                  updateMutation.mutate({ observacoes: e.target.value });
                }
              }}
              className="min-h-[100px]"
            />
          </div>
          <div className="rounded-xl border border-border bg-surface p-5 text-xs text-txt-muted space-y-1">
            <p>Cadastrado em: {new Date(cliente.created_at).toLocaleDateString('pt-BR')}</p>
          </div>
        </TabsContent>
      </Tabs>

      <ReuniaoDialog
        open={reuniaoDialogOpen}
        onOpenChange={setReuniaoDialogOpen}
        preselectedClienteId={clienteId}
      />
    </div>
  );
}

function InlineField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <span className="w-28 text-xs text-txt-muted">{label}</span>
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onSave(draft); setEditing(false); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onSave(draft); setEditing(false); }
            if (e.key === 'Escape') { setDraft(value); setEditing(false); }
          }}
          className="h-8 text-sm"
        />
      </div>
    );
  }

  return (
    <div
      className="flex items-center gap-2 cursor-pointer rounded-md px-1 py-1 transition-colors hover:bg-surface-hi"
      onClick={() => { setDraft(value); setEditing(true); }}
    >
      <span className="w-28 text-xs text-txt-muted">{label}</span>
      <span className="text-sm text-txt">{value || '—'}</span>
    </div>
  );
}
