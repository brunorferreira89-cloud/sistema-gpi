import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, RefreshCw, Check, Clock, ChevronDown, Play, Eye, Save, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas, sumLeafByTipo, calcIndicador } from '@/lib/dre-indicadores';
import { fetchMergedIndicadores, calcularIndicadores, calcScore } from '@/lib/kpi-indicadores-utils';

interface Props {
  clienteId: string;
  competencia: string;
  onStartPresentation: () => void;
  onPreview: () => void;
}

const CAMPOS = ['diagnostico', 'objetivos', 'riscos', 'proximos_passos'] as const;
const CAMPO_LABELS: Record<string, { label: string; icon: string }> = {
  diagnostico: { label: 'Diagnóstico', icon: '🔍' },
  objetivos: { label: 'Objetivos', icon: '🎯' },
  riscos: { label: 'Riscos', icon: '⚠️' },
  proximos_passos: { label: 'Próximos Passos', icon: '✅' },
};

const CHECKLIST_ITEMS = [
  'DRE do mês importada',
  'Metas da Torre de Controle definidas',
  'Análise consultiva revisada',
  'Slides pré-visualizados',
  'WhatsApp de confirmação enviado',
];

type PrepRow = {
  id: string;
  diagnostico: string | null;
  objetivos: string | null;
  riscos: string | null;
  proximos_passos: string | null;
  gerado_em: string | null;
  editado_em: string | null;
  editado_por: string | null;
};

export default function PrepararApresentacao({ clienteId, competencia, onStartPresentation, onPreview }: Props) {
  const { user } = useAuth();
  const [prep, setPrep] = useState<PrepRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null); // null or campo name or 'all'
  const [checklist, setChecklist] = useState<boolean[]>(CHECKLIST_ITEMS.map(() => false));
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [editorNome, setEditorNome] = useState<string | null>(null);
  const [cliente, setCliente] = useState<any>(null);
  const [indicadorSummary, setIndicadorSummary] = useState<{ nome: string; valor: string }[]>([]);
  const [apresentacao, setApresentacao] = useState<any>(null);

  // Fetch prep data
  useEffect(() => {
    async function load() {
      setLoading(true);
      const [prepRes, clienteRes, apresRes] = await Promise.all([
        supabase.from('apresentacao_preparacao').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle(),
        supabase.from('clientes').select('nome_empresa, segmento, razao_social').eq('id', clienteId).single(),
        supabase.from('apresentacoes').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle(),
      ]);
      setPrep(prepRes.data as any);
      setCliente(clienteRes.data);
      setApresentacao(apresRes.data);

      if (prepRes.data?.editado_por) {
        const { data: profileData } = await supabase.from('profiles').select('nome').eq('id', prepRes.data.editado_por).single();
        setEditorNome(profileData?.nome || null);
      }

      // Build indicator summary
      try {
        const { data: contasRaw } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
        const contasTyped = (contasRaw || []) as ContaRow[];
        const { data: valores } = await supabase.from('valores_mensais').select('conta_id, valor_realizado')
          .in('conta_id', contasTyped.map(c => c.id)).eq('competencia', competencia);
        const valMap: Record<string, number | null> = {};
        (valores || []).forEach((v: any) => { valMap[v.conta_id] = v.valor_realizado; });
        const fat = sumLeafByTipo(contasTyped, valMap, 'receita');
        const mc = calcIndicador(contasTyped, valMap, ['receita', 'custo_variavel']);
        const ro = calcIndicador(contasTyped, valMap, ['receita', 'custo_variavel', 'despesa_fixa']);
        const gc = calcIndicador(contasTyped, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);
        const fmtR = (v: number) => `R$ ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
        const fmtP = (v: number, base: number) => base ? `${((v / Math.abs(base)) * 100).toFixed(1)}%` : '—';
        setIndicadorSummary([
          { nome: 'Faturamento', valor: fmtR(fat) },
          { nome: 'MC', valor: fmtP(mc, fat) },
          { nome: 'RO', valor: fmtP(ro, fat) },
          { nome: 'GC', valor: fmtP(gc, fat) },
        ]);
      } catch { /* ignore */ }

      setLoading(false);
    }
    load();
  }, [clienteId, competencia]);

  const hasAnyContent = CAMPOS.some(c => prep?.[c] || editedFields[c]);

  const getFieldValue = (campo: string) => editedFields[campo] ?? prep?.[campo as keyof PrepRow] as string ?? '';

  const handleFieldChange = (campo: string, value: string) => {
    setEditedFields(prev => ({ ...prev, [campo]: value }));
  };

  const handleSave = async () => {
    const updates: any = { editado_em: new Date().toISOString(), editado_por: user?.id };
    CAMPOS.forEach(c => {
      const val = editedFields[c];
      if (val !== undefined) updates[c] = val;
    });

    if (prep?.id) {
      await supabase.from('apresentacao_preparacao').update(updates).eq('id', prep.id);
    } else {
      await supabase.from('apresentacao_preparacao').insert({ cliente_id: clienteId, competencia, ...updates });
    }
    toast.success('Preparação salva');
    // Reload
    const { data } = await supabase.from('apresentacao_preparacao').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle();
    setPrep(data as any);
    setEditedFields({});
  };

  const buildPayload = async () => {
    const { data: contasRaw2 } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
    const contasAll = (contasRaw2 || []) as ContaRow[];
    const contaIds = contasAll.map(c => c.id);
    const { data: valores } = await supabase.from('valores_mensais').select('conta_id, valor_realizado, competencia')
      .in('conta_id', contaIds);
    const valMap: Record<string, number | null> = {};
    (valores || []).filter((v: any) => v.competencia === competencia).forEach((v: any) => { valMap[v.conta_id] = v.valor_realizado; });

    const prevDate = new Date(competencia + 'T00:00:00');
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevComp = prevDate.toISOString().split('T')[0];
    const prevValMap: Record<string, number | null> = {};
    (valores || []).filter((v: any) => v.competencia === prevComp).forEach((v: any) => { prevValMap[v.conta_id] = v.valor_realizado; });

    const leafs = getLeafContas(contasAll);
    const fat = sumLeafByTipo(contasAll, valMap, 'receita');
    const prevFat = sumLeafByTipo(contasAll, prevValMap, 'receita');

    const tipos = ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'];
    const tipoLabels: Record<string, string> = {
      receita: 'Faturamento', custo_variavel: 'Custos Operacionais', despesa_fixa: 'Despesas Operacionais',
      investimento: 'Investimentos', financeiro: 'Financiamentos',
    };

    const indicadores = tipos.map(tipo => {
      const val = sumLeafByTipo(contasAll, valMap, tipo);
      const prevVal = sumLeafByTipo(contasAll, prevValMap, tipo);
      const subgrupos = contasAll.filter(c => c.nivel === 1 && c.tipo === tipo).map(sg => {
        const cats = contasAll.filter(c => c.conta_pai_id === sg.id && c.nivel === 2);
        const sgVal = cats.reduce((s, c) => s + (valMap[c.id] || 0), 0);
        return {
          nome: sg.nome,
          valor: sgVal,
          categorias: cats.map(c => ({ nome: c.nome, valor: valMap[c.id] || 0 })).filter(c => c.valor !== 0).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
        };
      }).filter(sg => sg.valor !== 0);

      return {
        nome: tipoLabels[tipo] || tipo,
        valor_realizado: val,
        valor_mes_anterior: prevVal,
        variacao_pct: prevVal ? ((val - prevVal) / Math.abs(prevVal)) * 100 : 0,
        av_pct: fat ? (Math.abs(val) / Math.abs(fat)) * 100 : 0,
        subgrupos,
      };
    });

    const mc = calcIndicador(contasAll, valMap, ['receita', 'custo_variavel']);
    const ro = calcIndicador(contasAll, valMap, ['receita', 'custo_variavel', 'despesa_fixa']);
    const rai = calcIndicador(contasAll, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento']);
    const gc = calcIndicador(contasAll, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);

    // Add totalizadores as indicators too
    const totIndicadores = [
      { nome: 'Margem de Contribuição', valor_realizado: mc, valor_mes_anterior: 0, variacao_pct: 0, av_pct: fat ? (mc / Math.abs(fat)) * 100 : 0, subgrupos: [] },
      { nome: 'Resultado Operacional', valor_realizado: ro, valor_mes_anterior: 0, variacao_pct: 0, av_pct: fat ? (ro / Math.abs(fat)) * 100 : 0, subgrupos: [] },
      { nome: 'Resultado após Investimento', valor_realizado: rai, valor_mes_anterior: 0, variacao_pct: 0, av_pct: fat ? (rai / Math.abs(fat)) * 100 : 0, subgrupos: [] },
      { nome: 'Geração de Caixa', valor_realizado: gc, valor_mes_anterior: 0, variacao_pct: 0, av_pct: fat ? (gc / Math.abs(fat)) * 100 : 0, subgrupos: [] },
    ];

    // KPIs
    let kpisArr: any[] = [];
    try {
      const kpiInds = await fetchMergedIndicadores(clienteId);
      const calcs = calcularIndicadores(kpiInds, contasAll, valMap);
      kpisArr = calcs.filter(c => c.indicador.ativo).map(c => ({
        nome: c.indicador.nome,
        valor: c.pct?.toFixed(1) || '0',
        status: c.status,
      }));
    } catch { /* ignore */ }

    return {
      cliente_id: clienteId,
      competencia,
      indicadores: [...indicadores, ...totIndicadores],
      totalizadores: {
        MC: mc, MC_pct: fat ? (mc / Math.abs(fat)) * 100 : 0,
        RO: ro, RO_pct: fat ? (ro / Math.abs(fat)) * 100 : 0,
        RAI: rai, RAI_pct: fat ? (rai / Math.abs(fat)) * 100 : 0,
        GC: gc, GC_pct: fat ? (gc / Math.abs(fat)) * 100 : 0,
      },
      kpis: kpisArr,
      empresa_nome: cliente?.nome_empresa || '',
      segmento: cliente?.segmento || '',
    };
  };

  const handleGenerate = async (campo?: string) => {
    setGenerating(campo || 'all');
    try {
      const payload: any = await buildPayload();
      if (campo) payload.campo = campo;

      const { data, error } = await supabase.functions.invoke('gerar-analise-consultiva', { body: payload });
      if (error) throw error;
      if (data?.data) {
        const { data: refreshed } = await supabase.from('apresentacao_preparacao').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle();
        setPrep(refreshed as any);
        setEditedFields({});
        toast.success(campo ? `${CAMPO_LABELS[campo]?.label} regenerado` : 'Análise completa gerada');
      }
    } catch (e: any) {
      toast.error(e.message || 'Erro ao gerar análise');
    }
    setGenerating(null);
  };

  // Timeline steps
  const steps = [
    { label: 'Dados importados', done: indicadorSummary.length > 0 },
    { label: 'IA gerou', done: !!prep?.gerado_em },
    { label: 'Consultor revisou', done: !!prep?.editado_em },
    { label: 'Ao vivo', done: !!apresentacao?.encerrada_em },
  ];

  const mesLabel = (() => {
    const d = new Date(competencia + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase().replace('.', '');
  })();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#0D1B35]">Preparar Apresentação</h1>
        <p className="text-sm text-[#4A5E80]">{cliente?.razao_social || cliente?.nome_empresa} · {mesLabel}</p>
      </div>

      {/* Timeline */}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-[#DDE4F0] p-4">
        {steps.map((step, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div className={`flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold ${step.done ? 'bg-emerald-100 text-emerald-700' : 'bg-[#F0F4FA] text-[#4A5E80]'}`}>
              {step.done ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            </div>
            <span className={`text-xs font-medium ${step.done ? 'text-emerald-700' : 'text-[#4A5E80]'}`}>{step.label}</span>
            {i < steps.length - 1 && <div className="flex-1 h-px bg-[#DDE4F0]" />}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Main content */}
        <div className="space-y-4">
          {/* Generate all button */}
          {!hasAnyContent && (
            <Button
              onClick={() => handleGenerate()}
              disabled={generating !== null}
              className="w-full h-12 bg-primary hover:bg-primary/90 text-white"
            >
              {generating === 'all' ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Analisando {mesLabel} com IA...</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Gerar Análise Completa</>
              )}
            </Button>
          )}

          {/* 4 editable blocks */}
          {CAMPOS.map(campo => {
            const val = getFieldValue(campo);
            const wasEdited = prep?.editado_em && prep?.[campo] && editedFields[campo] === undefined;
            const isGenerating = generating === campo;

            return (
              <Card key={campo} className="bg-white border-[#DDE4F0] relative overflow-hidden">
                {wasEdited && (
                  <div className="h-1 bg-amber-400 w-full" />
                )}
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{CAMPO_LABELS[campo].icon}</span>
                    <CardTitle className="text-base font-semibold text-[#0D1B35]">{CAMPO_LABELS[campo].label}</CardTitle>
                    {wasEdited && <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[10px]">Editado manualmente</Badge>}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleGenerate(campo)}
                    disabled={generating !== null}
                    className="text-xs text-[#4A5E80]"
                  >
                    {isGenerating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    <span className="ml-1">Regenerar</span>
                  </Button>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={val}
                    onChange={e => handleFieldChange(campo, e.target.value)}
                    placeholder="Clique em Gerar Análise para preencher"
                    className="min-h-[100px] resize-y border-[#DDE4F0] bg-[#FAFCFF] text-sm text-[#0D1B35]"
                  />
                </CardContent>
              </Card>
            );
          })}

          {/* Footer buttons */}
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={handleSave} className="border-[#DDE4F0]">
              <Save className="h-4 w-4 mr-1" /> Salvar
            </Button>
            <Button variant="outline" onClick={onPreview} className="border-[#DDE4F0]">
              <Eye className="h-4 w-4 mr-1" /> Pré-visualizar slides
            </Button>
            <Button onClick={onStartPresentation} className="bg-primary text-white">
              <Play className="h-4 w-4 mr-1" /> Iniciar Apresentação
            </Button>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Checklist */}
          <Collapsible defaultOpen>
            <Card className="bg-white border-[#DDE4F0]">
              <CollapsibleTrigger className="w-full">
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-[#0D1B35]">Checklist pré-reunião</CardTitle>
                  <ChevronDown className="h-4 w-4 text-[#4A5E80]" />
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="space-y-2">
                  {CHECKLIST_ITEMS.map((item, i) => (
                    <label key={i} className="flex items-center gap-2 text-sm text-[#0D1B35] cursor-pointer">
                      <Checkbox
                        checked={checklist[i]}
                        onCheckedChange={(v) => setChecklist(prev => { const n = [...prev]; n[i] = !!v; return n; })}
                      />
                      {item}
                    </label>
                  ))}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Dados usados pela IA */}
          <Collapsible>
            <Card className="bg-white border-[#DDE4F0]">
              <CollapsibleTrigger className="w-full">
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-[#0D1B35]">Dados usados pela IA</CardTitle>
                  <ChevronDown className="h-4 w-4 text-[#4A5E80]" />
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent>
                  <div className="flex flex-wrap gap-2">
                    {indicadorSummary.map((ind, i) => (
                      <span key={i} className="text-xs text-[#4A5E80] bg-[#F0F4FA] px-2 py-1 rounded">
                        {ind.nome} {ind.valor}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>

          {/* Histórico de edições */}
          <Collapsible>
            <Card className="bg-white border-[#DDE4F0]">
              <CollapsibleTrigger className="w-full">
                <CardHeader className="pb-2 flex-row items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-[#0D1B35]">Histórico de edições</CardTitle>
                  <ChevronDown className="h-4 w-4 text-[#4A5E80]" />
                </CardHeader>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent>
                  {prep?.editado_em ? (
                    <p className="text-xs text-[#4A5E80]">
                      Editado por {editorNome || 'consultor'} em{' '}
                      {new Date(prep.editado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  ) : (
                    <p className="text-xs text-[#4A5E80]">Nenhuma edição manual registrada</p>
                  )}
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </div>
      </div>
    </div>
  );
}
