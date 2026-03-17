import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, RefreshCw, Check, Clock, Play, Eye, Save, Sparkles, ArrowLeft, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { type ContaRow } from '@/lib/plano-contas-utils';
import { getLeafContas, sumLeafByTipo, calcIndicador } from '@/lib/dre-indicadores';
import { fetchMergedIndicadores, calcularIndicadores } from '@/lib/kpi-indicadores-utils';
import { useNavigate } from 'react-router-dom';
import { ReuniaoDialog } from '@/components/reunioes/ReuniaoDialog';

interface Props {
  clienteId: string;
  competencia: string;
  onStartPresentation: () => void;
  onPreview: () => void;
}

const CAMPOS = ['diagnostico', 'objetivos', 'riscos', 'proximos_passos'] as const;
const CAMPO_LABELS: Record<string, { label: string; icon: string }> = {
  diagnostico: { label: 'O que os números dizem', icon: '🔍' },
  objetivos: { label: 'O que queremos alcançar', icon: '🎯' },
  riscos: { label: 'Riscos se não agirmos agora', icon: '⚡' },
  proximos_passos: { label: 'O que fazer esta semana', icon: '✅' },
};

const CHECKLIST_LABELS = [
  'DRE do mês importada',
  'Metas definidas na Torre',
  'Análises IA geradas',
  'Slides revisados',
  'Reunião agendada no sistema',
];

const INDICADOR_LABELS = [
  'Faturamento', 'Custos Op.', 'MC', 'Despesas', 'RO',
  'Investimentos', 'RAI', 'Financiamentos', 'GC',
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
  const navigate = useNavigate();
  const [prep, setPrep] = useState<PrepRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState<string | null>(null);
  const [editingCampo, setEditingCampo] = useState<string | null>(null);
  const [editedFields, setEditedFields] = useState<Record<string, string>>({});
  const [editorNome, setEditorNome] = useState<string | null>(null);
  const [cliente, setCliente] = useState<any>(null);
  const [indicadorSummary, setIndicadorSummary] = useState<{ nome: string; valor: string; hasData: boolean }[]>([]);
  const [apresentacao, setApresentacao] = useState<any>(null);
  const [checklistState, setChecklistState] = useState({
    dreImportada: false,
    metasDefinidas: false,
    analiseGerada: false,
    slidesRevisados: false,
    reuniaoAgendada: false,
  });
  const [reuniaoDialogOpen, setReuniaoDialogOpen] = useState(false);

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

      // Build indicator summary + checklist state
      try {
        const { data: contasRaw } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
        const contasTyped = (contasRaw || []) as ContaRow[];
        const contaIds = contasTyped.map(c => c.id);
        const { data: valores } = await supabase.from('valores_mensais').select('conta_id, valor_realizado')
          .in('conta_id', contaIds).eq('competencia', competencia);
        const valMap: Record<string, number | null> = {};
        (valores || []).forEach((v: any) => { valMap[v.conta_id] = v.valor_realizado; });

        const fat = sumLeafByTipo(contasTyped, valMap, 'receita');
        const custos = sumLeafByTipo(contasTyped, valMap, 'custo_variavel');
        const mc = calcIndicador(contasTyped, valMap, ['receita', 'custo_variavel']);
        const despesas = sumLeafByTipo(contasTyped, valMap, 'despesa_fixa');
        const ro = calcIndicador(contasTyped, valMap, ['receita', 'custo_variavel', 'despesa_fixa']);
        const invest = sumLeafByTipo(contasTyped, valMap, 'investimento');
        const rai = calcIndicador(contasTyped, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento']);
        const financ = sumLeafByTipo(contasTyped, valMap, 'financeiro');
        const gc = calcIndicador(contasTyped, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);

        const fmtR = (v: number) => `R$ ${Math.abs(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
        const vals = [fat, custos, mc, despesas, ro, invest, rai, financ, gc];
        const summary = INDICADOR_LABELS.map((nome, i) => ({
          nome,
          valor: fmtR(vals[i]),
          hasData: vals[i] !== 0,
        }));
        setIndicadorSummary(summary);

        // Auto-check DRE
        const hasDre = (valores || []).length > 0;
        // Auto-check metas (torre salva metas para o mês seguinte)
        const compDate = new Date(competencia + 'T00:00:00');
        const mesSeg = new Date(compDate.getFullYear(), compDate.getMonth() + 1, 1).toISOString().split('T')[0];
        const { count: metasCount } = await supabase.from('torre_metas' as any).select('id', { count: 'exact', head: true })
          .eq('cliente_id', clienteId).eq('competencia', mesSeg);
        // Auto-check reunião
        const hoje = new Date().toISOString().split('T')[0];
        const { count: reuniaoCount } = await supabase.from('reunioes').select('id', { count: 'exact', head: true })
          .eq('cliente_id', clienteId).gte('data_reuniao', hoje);

        setChecklistState({
          dreImportada: hasDre,
          metasDefinidas: (metasCount || 0) > 0,
          analiseGerada: !!prepRes.data?.gerado_em,
          slidesRevisados: false, // manual
          reuniaoAgendada: (reuniaoCount || 0) > 0,
        });
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

  const handleSaveBlock = async (campo: string) => {
    const val = editedFields[campo];
    if (val === undefined) return;
    const updates: any = { editado_em: new Date().toISOString(), editado_por: user?.id, [campo]: val };

    if (prep?.id) {
      await supabase.from('apresentacao_preparacao').update(updates).eq('id', prep.id);
    } else {
      await supabase.from('apresentacao_preparacao').insert({ cliente_id: clienteId, competencia, ...updates });
    }
    toast.success(`${CAMPO_LABELS[campo]?.label} salvo`);
    const { data } = await supabase.from('apresentacao_preparacao').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle();
    setPrep(data as any);
    setEditedFields(prev => { const n = { ...prev }; delete n[campo]; return n; });
    setEditingCampo(null);
  };

  const handleSaveAll = async () => {
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
    const { data } = await supabase.from('apresentacao_preparacao').select('*').eq('cliente_id', clienteId).eq('competencia', competencia).maybeSingle();
    setPrep(data as any);
    setEditedFields({});
    setEditingCampo(null);
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

    const fat = sumLeafByTipo(contasAll, valMap, 'receita');

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
          nome: sg.nome, valor: sgVal,
          categorias: cats.map(c => ({ nome: c.nome, valor: valMap[c.id] || 0 })).filter(c => c.valor !== 0).sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor)),
        };
      }).filter(sg => sg.valor !== 0);

      return {
        nome: tipoLabels[tipo] || tipo, valor_realizado: val, valor_mes_anterior: prevVal,
        variacao_pct: prevVal ? ((val - prevVal) / Math.abs(prevVal)) * 100 : 0,
        av_pct: fat ? (Math.abs(val) / Math.abs(fat)) * 100 : 0, subgrupos,
      };
    });

    const mc = calcIndicador(contasAll, valMap, ['receita', 'custo_variavel']);
    const ro = calcIndicador(contasAll, valMap, ['receita', 'custo_variavel', 'despesa_fixa']);
    const rai = calcIndicador(contasAll, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento']);
    const gc = calcIndicador(contasAll, valMap, ['receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro']);

    const totIndicadores = [
      { nome: 'Margem de Contribuição', valor_realizado: mc, valor_mes_anterior: 0, variacao_pct: 0, av_pct: fat ? (mc / Math.abs(fat)) * 100 : 0, subgrupos: [] },
      { nome: 'Resultado Operacional', valor_realizado: ro, valor_mes_anterior: 0, variacao_pct: 0, av_pct: fat ? (ro / Math.abs(fat)) * 100 : 0, subgrupos: [] },
      { nome: 'Resultado após Investimento', valor_realizado: rai, valor_mes_anterior: 0, variacao_pct: 0, av_pct: fat ? (rai / Math.abs(fat)) * 100 : 0, subgrupos: [] },
      { nome: 'Geração de Caixa', valor_realizado: gc, valor_mes_anterior: 0, variacao_pct: 0, av_pct: fat ? (gc / Math.abs(fat)) * 100 : 0, subgrupos: [] },
    ];

    let kpisArr: any[] = [];
    try {
      const kpiInds = await fetchMergedIndicadores(clienteId);
      const calcs = calcularIndicadores(kpiInds, contasAll, valMap);
      kpisArr = calcs.filter(c => c.indicador.ativo).map(c => ({
        nome: c.indicador.nome, valor: c.pct?.toFixed(1) || '0', status: c.status,
      }));
    } catch { /* ignore */ }

    return {
      cliente_id: clienteId, competencia,
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
    { label: 'Dados importados', done: checklistState.dreImportada },
    { label: 'IA gerou', done: !!prep?.gerado_em },
    { label: 'Consultor revisou', done: !!prep?.editado_em },
    { label: 'Ao vivo', done: !!apresentacao?.encerrada_em },
  ];
  const activeStepIdx = steps.findIndex(s => !s.done);

  const mesLabel = (() => {
    const d = new Date(competencia + 'T00:00:00');
    const meses = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
    return `${meses[d.getMonth()]}/${d.getFullYear()}`;
  })();

  const checklistItems = [
    { label: CHECKLIST_LABELS[0], checked: checklistState.dreImportada },
    { label: CHECKLIST_LABELS[1], checked: checklistState.metasDefinidas },
    { label: CHECKLIST_LABELS[2], checked: checklistState.analiseGerada },
    { label: CHECKLIST_LABELS[3], checked: checklistState.slidesRevisados },
    { label: CHECKLIST_LABELS[4], checked: checklistState.reuniaoAgendada },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96" style={{ background: '#F0F4FA' }}>
        <Loader2 className="h-8 w-8 animate-spin text-[#1A3CFF]" />
      </div>
    );
  }

  const isFieldEdited = (campo: string) => {
    // Was manually edited and saved (prep has editado_em and content exists, no pending edits)
    return !!prep?.editado_em && !!prep?.[campo as keyof PrepRow] && editedFields[campo] === undefined;
  };

  const isFieldFromIA = (campo: string) => {
    return !!prep?.gerado_em && !!prep?.[campo as keyof PrepRow] && !prep?.editado_em;
  };

  return (
    <div className="min-h-screen" style={{ background: '#F0F4FA', fontFamily: 'DM Sans, sans-serif' }}>
      <div className="max-w-[1400px] mx-auto px-6 py-6 space-y-6">
        {/* HEADER */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <button
              onClick={() => navigate(`/clientes/${clienteId}`)}
              className="inline-flex items-center gap-1 text-sm text-[#4A5E80] hover:text-[#1A3CFF] transition-colors mb-1"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Voltar para {cliente?.razao_social || cliente?.nome_empresa}
            </button>
            <h1 className="text-2xl font-bold text-[#0D1B35]">
              Preparar Apresentação — {mesLabel}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={handleSaveAll}
              className="border-[#DDE4F0] text-[#0D1B35]"
              disabled={Object.keys(editedFields).length === 0}
            >
              <Save className="h-4 w-4 mr-1" /> Salvar
            </Button>
            <Button variant="outline" onClick={onPreview} className="border-[#DDE4F0] text-[#0D1B35]">
              <Eye className="h-4 w-4 mr-1" /> Pré-visualizar
            </Button>
            {prep?.id && (
              <span className="inline-flex items-center gap-1 text-xs" style={{ color: '#00A86B' }}>
                <Check className="h-3.5 w-3.5" /> Apresentação disponível no portal do cliente
              </span>
            )}
          </div>
        </div>

        {/* TIMELINE */}
        <div className="rounded-xl border border-[#DDE4F0] bg-white p-4" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
          <div className="flex items-center">
            {steps.map((step, i) => {
              const isActive = i === activeStepIdx;
              const isDone = step.done;
              const isFuture = !isDone && !isActive;
              return (
                <div key={i} className="flex items-center flex-1">
                  <div className="flex items-center gap-2">
                    <div
                      className="flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold"
                      style={{
                        background: isDone ? 'rgba(0,168,107,0.12)' : isActive ? 'rgba(26,60,255,0.12)' : '#F0F4FA',
                        color: isDone ? '#00A86B' : isActive ? '#1A3CFF' : '#8A9BBC',
                      }}
                    >
                      {isDone ? <Check className="h-4 w-4" /> : <span>{i + 1}</span>}
                    </div>
                    <span
                      className="text-xs font-medium whitespace-nowrap"
                      style={{ color: isDone ? '#00A86B' : isActive ? '#1A3CFF' : '#8A9BBC' }}
                    >
                      {step.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <div className="flex-1 h-px mx-3" style={{ background: isDone ? '#00A86B' : '#DDE4F0' }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
          {/* MAIN COLUMN */}
          <div className="space-y-4">
            {/* Generate all button */}
            {!hasAnyContent && (
              <button
                onClick={() => handleGenerate()}
                disabled={generating !== null}
                className="w-full rounded-xl border-2 border-dashed border-[#1A3CFF] bg-white p-8 text-center transition-all hover:bg-[#F6F9FF] disabled:opacity-60"
                style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}
              >
                {generating === 'all' ? (
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin text-[#1A3CFF]" />
                    <span className="text-sm font-semibold text-[#1A3CFF]">Analisando {mesLabel} com IA...</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <Sparkles className="h-6 w-6 text-[#1A3CFF]" />
                    <span className="text-sm font-semibold text-[#1A3CFF]">✨ Gerar análise com IA</span>
                    <span className="text-xs text-[#8A9BBC]">A IA irá preencher os 4 blocos com base nos dados do mês</span>
                  </div>
                )}
              </button>
            )}

            {/* 4 EDITABLE BLOCKS */}
            {CAMPOS.map(campo => {
              const val = getFieldValue(campo);
              const isEditing = editingCampo === campo;
              const isGen = generating === campo;
              const edited = isFieldEdited(campo);
              const fromIA = isFieldFromIA(campo);

              return (
                <div
                  key={campo}
                  className="rounded-xl bg-white overflow-hidden"
                  style={{
                    border: '1px solid #DDE4F0',
                    borderTop: isEditing ? '3px solid #D97706' : edited ? '3px solid #00A86B' : '1px solid #DDE4F0',
                    boxShadow: '0 2px 8px rgba(13,27,53,0.06)',
                  }}
                >
                  {/* Block header */}
                  <div className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{CAMPO_LABELS[campo].icon}</span>
                      <span className="text-sm font-semibold text-[#0D1B35]">{CAMPO_LABELS[campo].label}</span>
                      {edited && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: '#00A86B', background: 'rgba(0,168,107,0.1)' }}>
                          ✓ Revisado
                        </span>
                      )}
                      {fromIA && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ color: '#1A3CFF', background: 'rgba(26,60,255,0.1)' }}>
                          ✨ IA
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {!isEditing && val && (
                        <button
                          onClick={() => setEditingCampo(campo)}
                          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#4A5E80] hover:bg-[#F0F4FA] transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Editar
                        </button>
                      )}
                      <button
                        onClick={() => handleGenerate(campo)}
                        disabled={generating !== null}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[#4A5E80] hover:bg-[#F0F4FA] transition-colors disabled:opacity-50"
                      >
                        {isGen ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                        Regenerar
                      </button>
                    </div>
                  </div>

                  {/* Block body */}
                  <div className="px-5 pb-4">
                    {isGen ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-[#1A3CFF] mr-2" />
                        <span className="text-sm text-[#4A5E80]">Regenerando com IA...</span>
                      </div>
                    ) : isEditing || !val ? (
                      <>
                        <Textarea
                          value={val}
                          onChange={e => handleFieldChange(campo, e.target.value)}
                          placeholder="Clique em 'Gerar análise com IA' para preencher automaticamente"
                          className="min-h-[120px] resize-y text-sm text-[#0D1B35]"
                          style={{ border: '1px solid #DDE4F0', background: '#FAFCFF' }}
                        />
                        {isEditing && editedFields[campo] !== undefined && (
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={() => { setEditingCampo(null); setEditedFields(prev => { const n = { ...prev }; delete n[campo]; return n; }); }}
                              className="mr-2 rounded-md px-3 py-1.5 text-xs font-medium text-[#4A5E80] hover:bg-[#F0F4FA]"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => handleSaveBlock(campo)}
                              className="rounded-md px-3 py-1.5 text-xs font-semibold text-white"
                              style={{ background: '#1A3CFF' }}
                            >
                              💾 Salvar bloco
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-sm text-[#0D1B35] leading-relaxed whitespace-pre-wrap">
                        {val}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* SIDEBAR */}
          <div className="space-y-4">
            {/* Checklist pré-reunião */}
            <div className="rounded-xl border border-[#DDE4F0] bg-white p-4" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
              <h3 className="text-sm font-semibold text-[#0D1B35] mb-3">Checklist pré-reunião</h3>
              <div className="space-y-2.5">
                {checklistItems.map((item, i) => (
                  <label key={i} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={item.checked}
                      onCheckedChange={(v) => {
                        // Only "Slides revisados" is manually toggleable
                        if (i === 3) {
                          setChecklistState(prev => ({ ...prev, slidesRevisados: !!v }));
                        }
                      }}
                      disabled={i !== 3}
                      className={item.checked ? '' : 'opacity-50'}
                    />
                    <span style={{ color: item.checked ? '#00A86B' : '#4A5E80', fontWeight: item.checked ? 600 : 400 }}>
                      {item.checked && '✓ '}{item.label}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Dados usados pela IA */}
            <div className="rounded-xl border border-[#DDE4F0] bg-white p-4" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
              <h3 className="text-sm font-semibold text-[#0D1B35] mb-3">Dados usados pela IA</h3>
              <div className="space-y-1.5">
                {indicadorSummary.map((ind, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="text-xs text-[#4A5E80]">{ind.nome}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-medium" style={{ fontFamily: 'Courier New, monospace', color: '#0D1B35' }}>
                        {ind.valor}
                      </span>
                      <span className="text-[10px]" style={{ color: ind.hasData ? '#00A86B' : '#8A9BBC' }}>
                        {ind.hasData ? '✓' : '—'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Histórico de edições */}
            <div className="rounded-xl border border-[#DDE4F0] bg-white p-4" style={{ boxShadow: '0 2px 8px rgba(13,27,53,0.06)' }}>
              <h3 className="text-sm font-semibold text-[#0D1B35] mb-3">Histórico de edições</h3>
              <div className="space-y-2">
                {prep?.gerado_em && (
                  <div className="flex items-start gap-2">
                    <div className="mt-1 h-1.5 w-1.5 rounded-full bg-[#1A3CFF] flex-shrink-0" />
                    <div>
                      <p className="text-xs text-[#0D1B35] font-medium">Gerou análise inicial (4 blocos)</p>
                      <p className="text-[10px] text-[#8A9BBC]">
                        {new Date(prep.gerado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                )}
                {prep?.editado_em && (
                  <div className="flex items-start gap-2">
                    <div className="mt-1 h-1.5 w-1.5 rounded-full bg-[#D97706] flex-shrink-0" />
                    <div>
                      <p className="text-xs text-[#0D1B35] font-medium">
                        Editado por {editorNome || 'consultor'}
                      </p>
                      <p className="text-[10px] text-[#8A9BBC]">
                        {new Date(prep.editado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                )}
                {!prep?.gerado_em && !prep?.editado_em && (
                  <p className="text-xs text-[#8A9BBC]">Nenhuma ação registrada</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
