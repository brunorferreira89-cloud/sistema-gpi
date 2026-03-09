import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { SparkLine, getBenchmarkColor } from './SparkLine';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clienteId: string;
  clienteNome: string;
}

const CORE_INDICATORS = [
  { key: 'faturamento', nome: 'Faturamento Bruto', benchmark: null },
  { key: 'margem_contribuicao', nome: 'Margem de Contribuição %', benchmark: '> 40%' },
  { key: 'resultado_operacional', nome: 'Resultado Operacional', benchmark: null },
  { key: 'geracao_caixa', nome: 'Geração de Caixa %', benchmark: '> 10%' },
];

const ADVANCED_INDICATORS = [
  { key: 'ponto_equilibrio', nome: 'Ponto de Equilíbrio Financeiro' },
  { key: 'margem_seguranca', nome: 'Margem de Segurança %' },
  { key: 'cmv', nome: 'CMV %' },
  { key: 'cmo', nome: 'CMO %' },
  { key: 'retiradas_socios', nome: 'Retiradas dos Sócios %' },
];

function getMonday(d: Date) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date;
}

function getFriday(monday: Date) {
  const d = new Date(monday);
  d.setDate(d.getDate() + 4);
  return d;
}

export function GerarAlertaDialog({ open, onOpenChange, clienteId, clienteNome }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedAdvanced, setSelectedAdvanced] = useState<string[]>([]);
  const [analise, setAnalise] = useState('');
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const monday = getMonday(new Date());
  const friday = getFriday(monday);
  const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const fmtDateFull = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Fetch last 4 months of valores_mensais for spark lines
  const { data: sparkData } = useQuery({
    queryKey: ['spark-values', clienteId],
    queryFn: async () => {
      const { data: contas } = await supabase
        .from('plano_de_contas')
        .select('id, nome, tipo, nivel, is_total')
        .eq('cliente_id', clienteId)
        .order('ordem');
      if (!contas?.length) return { contas: [], valores: [] };

      const contaIds = contas.map((c) => c.id);
      const now = new Date();
      const months: string[] = [];
      for (let i = 3; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toISOString().split('T')[0]);
      }

      const { data: valores } = await supabase
        .from('valores_mensais')
        .select('conta_id, competencia, valor_realizado, valor_meta')
        .in('conta_id', contaIds)
        .in('competencia', months);

      return { contas, valores: valores || [], months };
    },
    enabled: open && !!clienteId,
  });

  const indicators = useMemo(() => {
    if (!sparkData?.contas?.length) return [];
    const { contas, valores, months } = sparkData;

    // Simple indicator extraction: find totalizador lines
    const findContaValues = (keywords: string[]) => {
      const conta = contas.find((c: any) =>
        keywords.some((kw) => c.nome.toLowerCase().includes(kw))
      );
      if (!conta) return { values: [], current: 0, meta: 0 };
      const vals = (months || []).map((m: string) => {
        const v = valores.find((v: any) => v.conta_id === conta.id && v.competencia === m);
        return v?.valor_realizado || 0;
      });
      const currentMonth = months?.[months.length - 1];
      const cv = valores.find((v: any) => v.conta_id === conta.id && v.competencia === currentMonth);
      return { values: vals, current: cv?.valor_realizado || 0, meta: cv?.valor_meta || 0 };
    };

    return [
      { key: 'faturamento', ...findContaValues(['faturamento bruto', 'receita bruta']) },
      { key: 'margem_contribuicao', ...findContaValues(['margem de contribui']) },
      { key: 'resultado_operacional', ...findContaValues(['resultado operacional', 'lucro operacional']) },
      { key: 'geracao_caixa', ...findContaValues(['geração de caixa', 'geracao de caixa']) },
      { key: 'cmv', ...findContaValues(['cmv', 'custo da mercadoria']) },
      { key: 'cmo', ...findContaValues(['cmo', 'custo de mão de obra']) },
      { key: 'ponto_equilibrio', ...findContaValues(['ponto de equilíbrio', 'ponto de equilibrio']) },
      { key: 'margem_seguranca', ...findContaValues(['margem de segurança', 'margem de seguranca']) },
      { key: 'retiradas_socios', ...findContaValues(['retirada', 'sócio', 'socio']) },
    ];
  }, [sparkData]);

  const getIndicatorData = (key: string) => indicators.find((i) => i.key === key);

  const saveMutation = useMutation({
    mutationFn: async (markSent: boolean) => {
      const allIndicators = [
        ...CORE_INDICATORS.map((i) => ({ ...i, core: true })),
        ...ADVANCED_INDICATORS.filter((i) => selectedAdvanced.includes(i.key)).map((i) => ({ ...i, core: false })),
      ].map((ind) => {
        const data = getIndicatorData(ind.key);
        return { nome: ind.nome, key: ind.key, core: 'core' in ind && ind.core, valor: data?.current || 0, meta: data?.meta || 0 };
      });

      const conteudo = { indicadores: allIndicators, analise };
      const semanaInicio = monday.toISOString().split('T')[0];
      const semanaFim = friday.toISOString().split('T')[0];

      const payload: any = {
        cliente_id: clienteId,
        semana_inicio: semanaInicio,
        semana_fim: semanaFim,
        conteudo,
        status: markSent ? 'enviado' : 'rascunho',
      };
      if (markSent) {
        payload.enviado_em = new Date().toISOString();
        payload.enviado_por = user?.id;
      }

      const { data: existing } = await supabase
        .from('alertas_semanais' as any)
        .select('id')
        .eq('cliente_id', clienteId)
        .eq('semana_inicio', semanaInicio)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase.from('alertas_semanais' as any).update(payload as any).eq('id', (existing as any).id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('alertas_semanais' as any).insert(payload as any);
        if (error) throw error;
      }
    },
    onSuccess: (_, markSent) => {
      queryClient.invalidateQueries({ queryKey: ['alertas', clienteId] });
      toast({ title: markSent ? 'Alerta enviado com sucesso.' : 'Rascunho salvo.' });
      onOpenChange(false);
      setStep(1);
      setAnalise('');
      setSelectedAdvanced([]);
    },
  });

  const toggleAdvanced = (key: string) => {
    setSelectedAdvanced((prev) => prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]);
  };

  const fmtCurrency = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { setStep(1); } onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === 1 ? 'Gerar Alerta' : 'Preview do Alerta'} — semana de {fmtDate(monday)} a {fmtDate(friday)}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <div className="space-y-6">
            {/* Core indicators */}
            <div>
              <p className="text-sm font-semibold text-txt mb-3">Indicadores Core</p>
              <div className="space-y-2">
                {CORE_INDICATORS.map((ind) => {
                  const data = getIndicatorData(ind.key);
                  return (
                    <div key={ind.key} className="flex items-center gap-3 rounded-lg border border-border bg-surface-hi px-3 py-2">
                      <span className="text-sm font-medium text-txt flex-1">{ind.nome}</span>
                      {data && <SparkLine values={data.values} color={getBenchmarkColor(ind.key, data.current)} />}
                      <span className="font-mono-data text-sm text-txt">{data ? fmtCurrency(data.current) : '—'}</span>
                      {ind.benchmark && <Badge variant="outline" className="text-xs">{ind.benchmark}</Badge>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Advanced indicators */}
            <div>
              <p className="text-sm font-semibold text-txt mb-3">Indicadores Avançados</p>
              <div className="space-y-2">
                {ADVANCED_INDICATORS.map((ind) => {
                  const data = getIndicatorData(ind.key);
                  return (
                    <div key={ind.key} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                      <Checkbox
                        checked={selectedAdvanced.includes(ind.key)}
                        onCheckedChange={() => toggleAdvanced(ind.key)}
                      />
                      <span className="text-sm text-txt flex-1">{ind.nome}</span>
                      {data && <SparkLine values={data.values} color={getBenchmarkColor(ind.key, data.current)} />}
                      <span className="font-mono-data text-sm text-txt-muted">{data ? fmtCurrency(data.current) : '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Análise */}
            <div>
              <p className="text-sm font-semibold text-txt mb-2">Análise e contexto</p>
              <Textarea
                value={analise}
                onChange={(e) => setAnalise(e.target.value)}
                placeholder="Descreva os destaques da semana, variações relevantes e orientações para o empresário..."
                className="min-h-[100px]"
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={() => setStep(2)}>Salvar rascunho →</Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            {/* Preview */}
            <div className="rounded-xl border border-border bg-surface p-6 space-y-4">
              <div className="border-b border-border pb-3">
                <h3 className="text-base font-bold text-txt">
                  Alerta Semanal GPI — {clienteNome}
                </h3>
                <p className="text-xs text-txt-muted">Semana de {fmtDate(monday)} a {fmtDateFull(friday)}</p>
              </div>

              <div className="space-y-2">
                {[...CORE_INDICATORS, ...ADVANCED_INDICATORS.filter((i) => selectedAdvanced.includes(i.key))].map((ind) => {
                  const data = getIndicatorData(ind.key);
                  return (
                    <div key={ind.key} className="flex items-center justify-between py-1 border-b border-border/50 last:border-0">
                      <span className="text-sm text-txt">{ind.nome}</span>
                      <span className="font-mono-data text-sm font-semibold text-txt">
                        {data ? fmtCurrency(data.current) : '—'}
                      </span>
                    </div>
                  );
                })}
              </div>

              {analise && (
                <div className="border-t border-border pt-3">
                  <p className="text-xs font-semibold text-txt-sec mb-1">Análise do período</p>
                  <p className="text-sm text-txt whitespace-pre-wrap">{analise}</p>
                </div>
              )}

              <p className="text-[10px] text-txt-muted pt-2 border-t border-border">
                GPI Inteligência Financeira
              </p>
            </div>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep(1)}>← Editar</Button>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => saveMutation.mutate(false)}>Salvar rascunho</Button>
                <Button onClick={() => saveMutation.mutate(true)} className="gap-1.5">
                  <span>Marcar como enviado</span>
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
