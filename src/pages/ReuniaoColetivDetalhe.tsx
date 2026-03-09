import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { Users2, FileText, Printer, CheckCircle } from 'lucide-react';
import { AtaColetivaSheet } from '@/components/reuniao-coletiva/AtaColetivaSheet';

const statusBadge: Record<string, { className: string; label: string }> = {
  planejando: { className: 'border-amber/30 bg-amber/10 text-amber', label: 'Planejando' },
  pronta: { className: 'border-green/30 bg-green/10 text-green', label: 'Pronta' },
  realizada: { className: 'border-green/30 bg-green/10 text-green', label: 'Realizada' },
  cancelada: { className: 'border-muted bg-muted/50 text-txt-muted', label: 'Cancelada' },
};

const checklistItems = [
  'Tema do Bloco 1 definido',
  'Dados anonimizados selecionados',
  'Material visual preparado (slides)',
  'Convite enviado a todos os clientes',
  'Sala/link de vídeo configurado',
  'Roteiro revisado por Lula',
];

export default function ReuniaoColetivDetalhe() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab') || 'preparacao';
  const [tab, setTab] = useState(initialTab);
  const [checkedItems, setCheckedItems] = useState<boolean[]>(new Array(6).fill(false));
  const [ataOpen, setAtaOpen] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: reuniao, isLoading } = useQuery({
    queryKey: ['reuniao-coletiva', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reunioes_coletivas' as any)
        .select('*')
        .eq('id', id!)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!id,
  });

  const [tema, setTema] = useState('');
  const [descricaoTema, setDescricaoTema] = useState('');
  const [participantes, setParticipantes] = useState(0);
  const [dataReuniao, setDataReuniao] = useState('');
  const [horario, setHorario] = useState('');
  const [formato, setFormato] = useState('hibrido');
  const [perguntaBloco2, setPerguntaBloco2] = useState('Como vocês estão lidando com esse desafio no dia a dia?');

  useEffect(() => {
    if (reuniao) {
      setTema(reuniao.tema_principal || '');
      setDescricaoTema(reuniao.descricao_tema || '');
      setParticipantes(reuniao.participantes_confirmados || 0);
      setDataReuniao(reuniao.data_reuniao || '');
      setHorario(reuniao.horario?.slice(0, 5) || '');
      setFormato(reuniao.formato || 'hibrido');
    }
  }, [reuniao]);

  const updateMutation = useMutation({
    mutationFn: async (fields: any) => {
      const { error } = await supabase
        .from('reunioes_coletivas' as any)
        .update(fields as any)
        .eq('id', id!);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reuniao-coletiva', id] });
      queryClient.invalidateQueries({ queryKey: ['reunioes-coletivas'] });
      toast({ title: 'Atualizado com sucesso.' });
    },
  });

  const checkedCount = checkedItems.filter(Boolean).length;

  // Snapshot generation
  const { data: snapshot, refetch: refetchSnapshot } = useQuery({
    queryKey: ['snapshot-anonimizado', id],
    queryFn: async () => {
      // Get all active clients
      const { data: clientes } = await supabase.from('clientes').select('id').eq('status', 'ativo');
      if (!clientes?.length) return null;

      // Get most recent competencia with data
      const { data: latestVal } = await supabase
        .from('valores_mensais')
        .select('competencia')
        .order('competencia', { ascending: false })
        .limit(1);
      if (!latestVal?.length) return null;
      const comp = latestVal[0].competencia;

      // Get all plano_de_contas with values for this competencia
      const { data: contas } = await supabase
        .from('plano_de_contas')
        .select('id, cliente_id, nome, tipo, is_total')
        .in('cliente_id', clientes.map(c => c.id));
      if (!contas?.length) return null;

      const contaIds = contas.map(c => c.id);
      const { data: valores } = await supabase
        .from('valores_mensais')
        .select('conta_id, valor_realizado, valor_meta, competencia')
        .eq('competencia', comp)
        .in('conta_id', contaIds);
      if (!valores?.length) return null;

      // Group by cliente
      const contaMap = new Map(contas.map(c => [c.id, c]));
      const clienteData: Record<string, { receita: number; custoVar: number; despFixa: number; financeiro: number }> = {};

      valores.forEach((v: any) => {
        const conta = contaMap.get(v.conta_id);
        if (!conta || !v.valor_realizado) return;
        const cid = conta.cliente_id;
        if (!clienteData[cid]) clienteData[cid] = { receita: 0, custoVar: 0, despFixa: 0, financeiro: 0 };
        if (conta.tipo === 'receita') clienteData[cid].receita += Number(v.valor_realizado);
        if (conta.tipo === 'custo_variavel') clienteData[cid].custoVar += Number(v.valor_realizado);
        if (conta.tipo === 'despesa_fixa') clienteData[cid].despFixa += Number(v.valor_realizado);
        if (conta.tipo === 'financeiro') clienteData[cid].financeiro += Number(v.valor_realizado);
      });

      const entries = Object.values(clienteData).filter(d => d.receita > 0);
      if (!entries.length) return null;

      const totalClientes = entries.length;
      const fats = entries.map(d => d.receita);
      const mcs = entries.map(d => ((d.receita - d.custoVar) / d.receita) * 100);
      const cmos = entries.map(d => (d.despFixa / d.receita) * 100);
      const gcs = entries.map(d => (d.financeiro / d.receita) * 100);
      const pes = entries.map(d => {
        const mcPct = (d.receita - d.custoVar) / d.receita;
        return mcPct > 0 ? d.despFixa / mcPct : 0;
      });

      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const median = (arr: number[]) => {
        const s = [...arr].sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      };

      return {
        competencia: comp,
        totalClientes,
        fatMedio: avg(fats),
        mcMedia: avg(mcs),
        mcMediana: median(mcs),
        mcAmplitude: Math.max(...mcs) - Math.min(...mcs),
        cmoMedia: avg(cmos),
        cmoForaBenchmark: cmos.filter(v => v > 25).length,
        gcMedia: avg(gcs),
        gcForaBenchmark: gcs.filter(v => v < 10).length,
        peMedio: avg(pes),
        fatMedioVsPe: avg(fats) - avg(pes),
      };
    },
    enabled: false,
  });

  const saveSnapshot = () => {
    if (!snapshot) return;
    updateMutation.mutate({ dados_anonimizados: snapshot });
  };

  const saveTema = () => {
    updateMutation.mutate({ tema_principal: tema, descricao_tema: descricaoTema });
  };

  const savePreparacao = () => {
    updateMutation.mutate({
      data_reuniao: dataReuniao,
      horario: horario || null,
      formato,
      participantes_confirmados: participantes,
    });
  };

  const marcarPronta = () => {
    updateMutation.mutate({ status: 'pronta' });
  };

  const fmtCurrency = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const fmtPct = (v: number) => `${v.toFixed(1)}%`;

  const fmtDateDisplay = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const snapshotData = snapshot || reuniao?.dados_anonimizados;

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!reuniao) {
    return <p className="text-center py-20 text-txt-muted">Reunião não encontrada.</p>;
  }

  const st = statusBadge[reuniao.status] || statusBadge.planejando;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users2 className="h-5 w-5 text-primary" />
          <h1 className="text-2xl font-bold text-txt">{reuniao.titulo}</h1>
          <Badge variant="outline" className={st.className}>{st.label}</Badge>
        </div>
        <div className="flex gap-2">
          {(reuniao.status === 'pronta' || reuniao.status === 'planejando') && (
            <Button variant="outline" size="sm" onClick={() => setAtaOpen(true)}>
              <FileText className="h-4 w-4 mr-1" /> Registrar ata
            </Button>
          )}
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="preparacao">Preparação</TabsTrigger>
          <TabsTrigger value="material">Material — Bloco 1</TabsTrigger>
          <TabsTrigger value="roteiro">Roteiro</TabsTrigger>
        </TabsList>

        {/* Tab Preparação */}
        <TabsContent value="preparacao" className="space-y-5">
          <Card>
            <CardContent className="p-5 space-y-4">
              <h3 className="font-semibold text-txt">Dados da reunião</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-txt-muted">Data</label>
                  <Input type="date" value={dataReuniao} onChange={e => setDataReuniao(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-txt-muted">Horário</label>
                  <Input type="time" value={horario} onChange={e => setHorario(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs text-txt-muted">Formato</label>
                  <div className="flex gap-3 mt-1">
                    {['presencial', 'video', 'hibrido'].map(f => (
                      <label key={f} className="flex items-center gap-1 text-sm text-txt cursor-pointer">
                        <input type="radio" name="formato" checked={formato === f} onChange={() => setFormato(f)} className="accent-primary" />
                        {f === 'video' ? 'Vídeo' : f === 'hibrido' ? 'Híbrido' : 'Presencial'}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className="text-xs text-txt-muted">Participantes confirmados</label>
                <Input type="number" value={participantes} onChange={e => setParticipantes(Number(e.target.value))} className="w-32" />
              </div>
              <Button size="sm" onClick={savePreparacao}>Salvar dados</Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-3">
              <h3 className="font-semibold text-txt">Checklist de preparação</h3>
              <Progress value={(checkedCount / 6) * 100} className="h-2" />
              <p className="text-xs text-txt-muted">{checkedCount}/6 itens prontos</p>
              <div className="space-y-2">
                {checklistItems.map((item, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm text-txt cursor-pointer">
                    <Checkbox checked={checkedItems[i]} onCheckedChange={(v) => {
                      const next = [...checkedItems];
                      next[i] = !!v;
                      setCheckedItems(next);
                    }} />
                    {item}
                  </label>
                ))}
              </div>
              {checkedCount === 6 && reuniao.status === 'planejando' && (
                <div className="flex items-center gap-3 pt-2">
                  <Badge variant="outline" className="border-green/30 bg-green/10 text-green">
                    <CheckCircle className="h-3 w-3 mr-1" /> Pronta para realizar
                  </Badge>
                  <Button size="sm" onClick={marcarPronta}>Marcar como Pronta</Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Material — Bloco 1 */}
        <TabsContent value="material" className="space-y-5">
          <Card>
            <CardContent className="p-5 space-y-4">
              <h3 className="font-semibold text-txt">Tema da reunião</h3>
              <div>
                <label className="text-xs text-txt-muted">Título do tema</label>
                <Input value={tema} onChange={e => setTema(e.target.value)} placeholder="Ex: Como reduzir CMV sem perder qualidade" />
              </div>
              <div>
                <label className="text-xs text-txt-muted">Desenvolvimento do tema</label>
                <Textarea rows={6} value={descricaoTema} onChange={e => setDescricaoTema(e.target.value)} placeholder="Descreva o tema com profundidade..." />
              </div>
              <Button size="sm" onClick={saveTema}>Salvar tema</Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-txt">Dados anonimizados para apresentação</h3>
                <Button size="sm" variant="outline" onClick={() => refetchSnapshot()}>
                  Gerar snapshot de indicadores
                </Button>
              </div>

              {snapshotData ? (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <SnapshotCard label="Clientes com dados" value={String(snapshotData.totalClientes)} />
                    <SnapshotCard label="Faturamento médio" value={fmtCurrency(snapshotData.fatMedio)} />
                    <SnapshotCard label="MC% média" value={fmtPct(snapshotData.mcMedia)} ref_="Ref > 40%" />
                    <SnapshotCard label="MC% mediana" value={fmtPct(snapshotData.mcMediana)} />
                    <SnapshotCard label="MC% amplitude" value={fmtPct(snapshotData.mcAmplitude)} />
                    <SnapshotCard label="CMO% média" value={fmtPct(snapshotData.cmoMedia)} ref_="Ref < 25%" extra={`${snapshotData.cmoForaBenchmark} acima do benchmark`} />
                    <SnapshotCard label="GC% média" value={fmtPct(snapshotData.gcMedia)} ref_="Ref > 10%" extra={`${snapshotData.gcForaBenchmark} em risco`} />
                    <SnapshotCard label="PE médio" value={fmtCurrency(snapshotData.peMedio)} />
                  </div>
                  {!reuniao.dados_anonimizados && (
                    <Button size="sm" onClick={saveSnapshot}>Salvar snapshot</Button>
                  )}
                </>
              ) : (
                <p className="text-sm text-txt-muted py-4 text-center">Clique em "Gerar snapshot" para carregar os indicadores anonimizados.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab Roteiro */}
        <TabsContent value="roteiro" className="space-y-5">
          <div className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Imprimir roteiro
            </Button>
          </div>

          <div className="print:block space-y-6 print:space-y-4" id="roteiro-print">
            <RoteiroSection title="ABERTURA (5min)">
              <p>Boas-vindas. Hoje temos <strong>{participantes || '___'}</strong> empresários reunidos.</p>
              <p>Nossa pauta de hoje: <strong>{tema || '[tema não definido]'}</strong>.</p>
            </RoteiroSection>

            <RoteiroSection title={`BLOCO 1 — ${tema || '[Tema]'} (20min)`}>
              {descricaoTema ? (
                <p className="whitespace-pre-wrap">{descricaoTema}</p>
              ) : (
                <p className="text-txt-muted italic">Desenvolvimento do tema não preenchido.</p>
              )}
              {snapshotData && (
                <div className="mt-3 space-y-1 text-sm">
                  <p className="font-medium">Dados do mercado:</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>A média de MC% dos negócios acompanhados pela GPI este mês foi de {fmtPct(snapshotData.mcMedia)}</li>
                    <li>{fmtPct((snapshotData.cmoForaBenchmark / snapshotData.totalClientes) * 100)} dos empresários aqui estão com CMO acima do benchmark recomendado</li>
                    <li>Geração de Caixa média: {fmtPct(snapshotData.gcMedia)} — {snapshotData.gcForaBenchmark} negócio(s) em zona de risco</li>
                    <li>Faturamento médio do grupo: {fmtCurrency(snapshotData.fatMedio)}</li>
                  </ul>
                </div>
              )}
            </RoteiroSection>

            <RoteiroSection title="BLOCO 2 — Troca entre empresários (20min)">
              <p className="font-medium">Pergunta para o grupo:</p>
              <Textarea
                className="mt-1 print:border-none print:p-0"
                rows={2}
                value={perguntaBloco2}
                onChange={e => setPerguntaBloco2(e.target.value)}
              />
              <p className="mt-3 font-medium text-txt-muted">Espaço para anotações durante a reunião:</p>
              <div className="mt-1 min-h-[80px] rounded-lg border border-dashed border-border p-3 text-sm text-txt-muted">
                ...
              </div>
            </RoteiroSection>

            <RoteiroSection title="BLOCO 3 — Perguntas e encerramento (20min)">
              <p>Próxima reunião: estimada para os dias 15–20 do próximo mês.</p>
              <p>Lembrete: lançamentos do mês devem ser encerrados até o último dia útil do mês.</p>
            </RoteiroSection>
          </div>
        </TabsContent>
      </Tabs>

      <AtaColetivaSheet
        open={ataOpen}
        onOpenChange={setAtaOpen}
        reuniao={reuniao}
      />
    </div>
  );
}

function RoteiroSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-5 space-y-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-primary">{title}</h3>
        <div className="text-sm text-txt space-y-1">{children}</div>
      </CardContent>
    </Card>
  );
}

function SnapshotCard({ label, value, ref_, extra }: { label: string; value: string; ref_?: string; extra?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-hi p-3 space-y-1">
      <p className="text-[10px] font-semibold uppercase text-txt-muted">{label}</p>
      <p className="text-lg font-bold text-txt font-mono">{value}</p>
      {ref_ && <p className="text-[10px] text-txt-muted">{ref_}</p>}
      {extra && <p className="text-[10px] text-amber font-medium">{extra}</p>}
    </div>
  );
}
