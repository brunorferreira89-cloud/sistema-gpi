import { useState, useCallback, useEffect } from 'react';
import { Check, AlertTriangle, GraduationCap, BookOpen, Monitor, Search, FileText, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScoreRing } from '@/components/ui/score-ring';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import {
  type DiagnosticoInputs, type DreResult,
  calcularDRE, emptyInputs, fmtBRL, fmtPct,
  getScoreLabel, getPitchTitle,
} from '@/lib/diagnostico-calculos';

const SEGMENTOS = [
  'Restaurante/Alimentação', 'Clínica/Saúde', 'Beleza/Estética',
  'Varejo', 'Serviços', 'Outro',
];

// ── Currency input helper ──
function CurrencyInput({ value, onChange, disabled, placeholder }: {
  value: number | null; onChange: (v: number | null) => void; disabled?: boolean; placeholder?: string;
}) {
  const [display, setDisplay] = useState(value != null ? fmtBRL(value) : '');
  useEffect(() => { if (disabled) setDisplay(''); }, [disabled]);

  const handleChange = (raw: string) => {
    const nums = raw.replace(/\D/g, '');
    if (!nums) { setDisplay(''); onChange(null); return; }
    const v = parseInt(nums, 10);
    setDisplay(v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0 }));
    onChange(v);
  };

  return (
    <Input
      value={display} onChange={e => handleChange(e.target.value)}
      disabled={disabled} placeholder={placeholder || 'R$ 0'}
      className="font-mono-data"
      style={{ borderColor: '#DDE4F0', borderRadius: 8, padding: '10px 14px', fontSize: 14 }}
    />
  );
}

// ── "Não sabe" field wrapper ──
function FieldNaoSabe({ label, sublabel, value, onChange, naoSabe, onNaoSabe }: {
  label: string; sublabel?: string; value: number | null; onChange: (v: number | null) => void;
  naoSabe: boolean; onNaoSabe: (v: boolean) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold" style={{ color: '#4A5E80' }}>{label}</Label>
      {sublabel && <p className="text-[11px]" style={{ color: '#7A8FB0' }}>{sublabel}</p>}
      <CurrencyInput value={value} onChange={onChange} disabled={naoSabe} />
      <div className="flex items-center gap-2 mt-1">
        <Checkbox checked={naoSabe} onCheckedChange={v => { onNaoSabe(!!v); if (v) onChange(null); }} id={`ns-${label}`} />
        <label htmlFor={`ns-${label}`} className="text-xs" style={{ color: '#7A8FB0' }}>Não sabe</label>
      </div>
      {naoSabe && (
        <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium"
          style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
          <AlertTriangle className="h-3 w-3" /> Ponto crítico — informação não disponível
        </div>
      )}
    </div>
  );
}

// ── CNPJ mask ──
function maskCNPJ(v: string) {
  return v.replace(/\D/g, '').replace(/^(\d{2})(\d)/, '$1.$2').replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2').replace(/(\d{4})(\d)/, '$1-$2').slice(0, 18);
}

// ── Stepper ──
function Stepper({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        return (
          <div key={step} className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all"
              style={{
                background: done ? '#00A86B' : active ? 'hsl(233 100% 55%)' : '#E2E8F0',
                color: done || active ? '#fff' : '#94A3B8',
              }}>
              {done ? <Check className="h-4 w-4" /> : step}
            </div>
            {step < total && <div className="h-0.5 w-6 rounded-full" style={{ background: done ? '#00A86B' : '#E2E8F0' }} />}
          </div>
        );
      })}
    </div>
  );
}

// ── Preview card ──
function Preview({ label, value, pct, color }: { label: string; value: number | null; pct?: number | null; color?: string }) {
  return (
    <div className="rounded-lg px-4 py-3 mt-4" style={{ background: color || '#EEF2FF', border: '1px solid #DDE4F0' }}>
      <span className="text-xs font-semibold" style={{ color: '#4A5E80' }}>{label}: </span>
      <span className="font-mono-data text-sm font-bold" style={{ color: '#0D1B35' }}>{fmtBRL(value)}</span>
      {pct != null && <span className="text-xs ml-1" style={{ color: '#7A8FB0' }}>({fmtPct(pct)})</span>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════════════════
export default function DiagnosticoPublicoPage() {
  const [inputs, setInputs] = useState<DiagnosticoInputs>(emptyInputs());
  const [step, setStep] = useState(1);
  const [showResult, setShowResult] = useState(false);
  const { toast } = useToast();

  const set = useCallback(<K extends keyof DiagnosticoInputs>(key: K, val: DiagnosticoInputs[K]) => {
    setInputs(prev => ({ ...prev, [key]: val }));
  }, []);

  const dre = calcularDRE(inputs);

  // ── Save lead ──
  const saveLead = useCallback(async (final = false) => {
    if (!inputs.email) return;
    try {
      const payload: any = {
        nome_empresa: inputs.nome_empresa,
        responsavel_nome: inputs.responsavel_nome,
        email: inputs.email,
        cnpj: inputs.cnpj || null,
        segmento: inputs.segmento || null,
        faturamento: inputs.faturamento,
        status: 'lead',
      };
      if (final) {
        payload.dados_diagnostico = inputs;
        payload.score = dre.score;
        payload.updated_at = new Date().toISOString();
      }
      await (supabase as any).from('diagnostico_leads').upsert(payload, { onConflict: 'email' });
    } catch {
      toast({ title: 'Aviso', description: 'Não foi possível salvar o diagnóstico. Os resultados foram gerados normalmente.', variant: 'destructive' });
    }
  }, [inputs, dre.score, toast]);

  // ── Step navigation ──
  const canAdvance = () => {
    if (step === 1) return inputs.nome_empresa && inputs.responsavel_nome && inputs.email && inputs.segmento && (inputs.faturamento != null || inputs.faturamento_nao_sabe);
    return true;
  };

  const next = async () => {
    if (step === 1) await saveLead(false);
    if (step < 5) setStep(s => s + 1);
    else { await saveLead(true); setShowResult(true); }
  };

  const prev = () => { if (step > 1) setStep(s => s - 1); };

  // ══════════ RESULT SCREEN ══════════
  if (showResult) return <ResultScreen dre={dre} inputs={inputs} onBack={() => setShowResult(false)} />;

  // ══════════ WIZARD ══════════
  return (
    <div className="min-h-screen" style={{ background: '#F0F4FA', backgroundImage: 'radial-gradient(circle, #C1CBD9 1px, transparent 1px)', backgroundSize: '28px 28px' }}>
      {/* Header */}
      <div className="sticky top-0 z-10 border-b" style={{ background: '#F0F4FA', borderColor: '#DDE4F0' }}>
        <div className="mx-auto flex max-w-[680px] items-center gap-3 px-6 py-3">
          <div className="flex h-7 items-center rounded-full px-3" style={{ background: '#0D1B35' }}>
            <span className="text-[11px] font-bold tracking-wider text-white">GPI</span>
          </div>
          <span className="text-sm font-semibold" style={{ color: '#0D1B35' }}>Mini-Diagnóstico Financeiro Gratuito</span>
        </div>
      </div>

      <div className="mx-auto max-w-[680px] px-6 py-8">
        <Stepper current={step} total={5} />

        <div className="rounded-[14px] p-6" style={{ background: '#fff', border: '1px solid #DDE4F0', boxShadow: '0 2px 12px rgba(13,27,53,0.08)' }}>
          {step === 1 && <Step1 inputs={inputs} set={set} />}
          {step === 2 && <Step2 inputs={inputs} set={set} dre={dre} />}
          {step === 3 && <Step3 inputs={inputs} set={set} dre={dre} />}
          {step === 4 && <Step4 inputs={inputs} set={set} dre={dre} />}
          {step === 5 && <Step5 inputs={inputs} set={set} dre={dre} />}

          <div className="flex justify-between mt-6">
            {step > 1 ? <Button variant="outline" onClick={prev}>Voltar</Button> : <div />}
            <Button onClick={next} disabled={!canAdvance()}>
              {step < 5 ? 'Continuar' : 'Ver meu diagnóstico'} <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════ STEPS ══════════
function Step1({ inputs, set }: { inputs: DiagnosticoInputs; set: <K extends keyof DiagnosticoInputs>(k: K, v: DiagnosticoInputs[K]) => void }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold" style={{ color: '#0D1B35' }}>Empresa e Identificação</h2>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" style={{ color: '#4A5E80' }}>Nome da empresa *</Label>
        <Input value={inputs.nome_empresa} onChange={e => set('nome_empresa', e.target.value)}
          style={{ borderColor: '#DDE4F0', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" style={{ color: '#4A5E80' }}>Nome do responsável *</Label>
        <Input value={inputs.responsavel_nome} onChange={e => set('responsavel_nome', e.target.value)}
          style={{ borderColor: '#DDE4F0', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" style={{ color: '#4A5E80' }}>E-mail *</Label>
        <Input type="email" value={inputs.email} onChange={e => set('email', e.target.value)}
          style={{ borderColor: '#DDE4F0', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" style={{ color: '#4A5E80' }}>CNPJ (opcional)</Label>
        <Input value={inputs.cnpj} onChange={e => set('cnpj', maskCNPJ(e.target.value))}
          placeholder="XX.XXX.XXX/XXXX-XX"
          style={{ borderColor: '#DDE4F0', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" style={{ color: '#4A5E80' }}>Segmento *</Label>
        <Select value={inputs.segmento} onValueChange={v => set('segmento', v)}>
          <SelectTrigger style={{ borderColor: '#DDE4F0', borderRadius: 8 }}><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>{SEGMENTOS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <FieldNaoSabe label="Faturamento Bruto médio (últimos 3 meses) *"
        value={inputs.faturamento} onChange={v => set('faturamento', v)}
        naoSabe={inputs.faturamento_nao_sabe} onNaoSabe={v => set('faturamento_nao_sabe', v)} />
    </div>
  );
}

function Step2({ inputs, set, dre }: { inputs: DiagnosticoInputs; set: any; dre: DreResult }) {
  const taxaCalc = inputs.taxas_cartao_modo === 'percentual' && inputs.taxas_cartao_pct != null && inputs.faturamento != null
    ? (inputs.taxas_cartao_pct / 100) * inputs.faturamento : null;
  const mcColor = dre.mc_pct != null ? (dre.mc_pct > 40 ? '#ECFDF5' : dre.mc_pct >= 30 ? '#FFFBEB' : '#FEF2F2') : '#EEF2FF';

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold" style={{ color: '#0D1B35' }}>Custos Variáveis</h2>
      {inputs.faturamento != null && (
        <div className="rounded-lg px-4 py-2" style={{ background: '#EEF2FF', border: '1px solid #C7D2FE' }}>
          <span className="text-xs font-semibold" style={{ color: '#4A5E80' }}>Faturamento: </span>
          <span className="font-mono-data text-sm font-bold">{fmtBRL(inputs.faturamento)}</span>
        </div>
      )}
      <FieldNaoSabe label="CMV — Compras de produtos/insumos/prestadores" value={inputs.cmv} onChange={(v: any) => set('cmv', v)}
        naoSabe={inputs.cmv_nao_sabe} onNaoSabe={(v: any) => set('cmv_nao_sabe', v)} />
      <FieldNaoSabe label="Impostos sobre receita (DAS, ICMS, ISS, PIS/COFINS)" value={inputs.impostos} onChange={(v: any) => set('impostos', v)}
        naoSabe={inputs.impostos_nao_sabe} onNaoSabe={(v: any) => set('impostos_nao_sabe', v)} />
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" style={{ color: '#4A5E80' }}>Taxas de cartão</Label>
        <div className="flex gap-1 mb-2">
          {(['valor', 'percentual'] as const).map(m => (
            <button key={m} onClick={() => set('taxas_cartao_modo', m)}
              className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: inputs.taxas_cartao_modo === m ? 'hsl(233 100% 55%)' : '#F1F5F9',
                color: inputs.taxas_cartao_modo === m ? '#fff' : '#64748B',
              }}>
              {m === 'valor' ? 'R$' : '%'}
            </button>
          ))}
        </div>
        {inputs.taxas_cartao_modo === 'valor' ? (
          <FieldNaoSabe label="" value={inputs.taxas_cartao} onChange={(v: any) => set('taxas_cartao', v)}
            naoSabe={inputs.taxas_cartao_nao_sabe} onNaoSabe={(v: any) => set('taxas_cartao_nao_sabe', v)} />
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Input type="number" value={inputs.taxas_cartao_pct ?? ''} onChange={e => set('taxas_cartao_pct', e.target.value ? Number(e.target.value) : null)}
                disabled={inputs.taxas_cartao_nao_sabe} placeholder="0" className="w-24 font-mono-data"
                style={{ borderColor: '#DDE4F0', borderRadius: 8 }} />
              <span className="text-sm" style={{ color: '#7A8FB0' }}>%</span>
              {taxaCalc != null && (
                <span className="rounded-md px-2 py-1 text-xs font-medium" style={{ background: '#EEF2FF', color: 'hsl(233 100% 55%)' }}>
                  = {fmtBRL(taxaCalc)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <Checkbox checked={inputs.taxas_cartao_nao_sabe} onCheckedChange={(v: any) => { set('taxas_cartao_nao_sabe', !!v); if (v) set('taxas_cartao_pct', null); }} />
              <span className="text-xs" style={{ color: '#7A8FB0' }}>Não sabe</span>
            </div>
            {inputs.taxas_cartao_nao_sabe && (
              <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
                <AlertTriangle className="h-3 w-3" /> Ponto crítico — informação não disponível
              </div>
            )}
          </div>
        )}
      </div>
      <Preview label="Margem de Contribuição estimada" value={dre.margem_contribuicao} pct={dre.mc_pct} color={mcColor} />
    </div>
  );
}

function Step3({ inputs, set, dre }: { inputs: DiagnosticoInputs; set: any; dre: DreResult }) {
  const folhaTotal = [inputs.salarios, inputs.inss_irrf, inputs.fgts, inputs.ferias, inputs.decimo_rescisoes]
    .filter(v => v != null).reduce((s, v) => s + (v || 0), 0);
  const provMissing = inputs.ferias_nao_sabe || inputs.decimo_rescisoes_nao_sabe;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold" style={{ color: '#0D1B35' }}>Despesas Operacionais</h2>
      <FieldNaoSabe label="Despesas administrativas (aluguel, energia, internet, seguros, contador, softwares)"
        value={inputs.despesas_admin} onChange={(v: any) => set('despesas_admin', v)}
        naoSabe={inputs.despesas_admin_nao_sabe} onNaoSabe={(v: any) => set('despesas_admin_nao_sabe', v)} />
      <div className="space-y-1.5">
        <Label className="text-xs font-semibold" style={{ color: '#4A5E80' }}>Número de funcionários</Label>
        <p className="text-[11px]" style={{ color: '#7A8FB0' }}>CLT + parceiros fixos remunerados mensalmente. Não incluir prestadores avulsos.</p>
        <Input type="number" min={0} value={inputs.num_funcionarios || ''} onChange={e => set('num_funcionarios', Number(e.target.value) || 0)}
          style={{ borderColor: '#DDE4F0', borderRadius: 8, padding: '10px 14px', fontSize: 14 }} />
      </div>
      <div className="rounded-lg p-4" style={{ border: '1px solid #DDE4F0' }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-semibold" style={{ color: '#4A5E80' }}>Folha de Pessoal</span>
          <span className="font-mono-data text-xs font-bold" style={{ color: '#0D1B35' }}>Total: {fmtBRL(folhaTotal)}</span>
        </div>
        <div className="space-y-3">
          <FieldNaoSabe label="Salários líquidos" value={inputs.salarios} onChange={(v: any) => set('salarios', v)} naoSabe={inputs.salarios_nao_sabe} onNaoSabe={(v: any) => set('salarios_nao_sabe', v)} />
          <FieldNaoSabe label="INSS + IRRF" value={inputs.inss_irrf} onChange={(v: any) => set('inss_irrf', v)} naoSabe={inputs.inss_irrf_nao_sabe} onNaoSabe={(v: any) => set('inss_irrf_nao_sabe', v)} />
          <FieldNaoSabe label="FGTS" value={inputs.fgts} onChange={(v: any) => set('fgts', v)} naoSabe={inputs.fgts_nao_sabe} onNaoSabe={(v: any) => set('fgts_nao_sabe', v)} />
          <FieldNaoSabe label="Provisão de férias" value={inputs.ferias} onChange={(v: any) => set('ferias', v)} naoSabe={inputs.ferias_nao_sabe} onNaoSabe={(v: any) => set('ferias_nao_sabe', v)} />
          <FieldNaoSabe label="Provisão 13º e rescisões" value={inputs.decimo_rescisoes} onChange={(v: any) => set('decimo_rescisoes', v)} naoSabe={inputs.decimo_rescisoes_nao_sabe} onNaoSabe={(v: any) => set('decimo_rescisoes_nao_sabe', v)} />
        </div>
        {provMissing && (
          <div className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 mt-3 text-[11px] font-medium" style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }}>
            <AlertTriangle className="h-3 w-3" /> Provisões não informadas — custo real pode ser até 35% maior
          </div>
        )}
      </div>
      <FieldNaoSabe label="Manutenção e conservação" value={inputs.manutencao} onChange={(v: any) => set('manutencao', v)} naoSabe={inputs.manutencao_nao_sabe} onNaoSabe={(v: any) => set('manutencao_nao_sabe', v)} />
      <FieldNaoSabe label="Despesas diversas" value={inputs.despesas_diversas} onChange={(v: any) => set('despesas_diversas', v)} naoSabe={inputs.despesas_diversas_nao_sabe} onNaoSabe={(v: any) => set('despesas_diversas_nao_sabe', v)} />
      <Preview label="Lucro Operacional estimado" value={dre.lucro_operacional} pct={dre.lucro_op_pct} />
    </div>
  );
}

function Step4({ inputs, set, dre }: { inputs: DiagnosticoInputs; set: any; dre: DreResult }) {
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold" style={{ color: '#0D1B35' }}>Investimentos e Financiamentos</h2>
      <FieldNaoSabe label="Marketing e publicidade" value={inputs.marketing} onChange={(v: any) => set('marketing', v)} naoSabe={inputs.marketing_nao_sabe} onNaoSabe={(v: any) => set('marketing_nao_sabe', v)} />
      <FieldNaoSabe label="Obras, reformas e equipamentos — CAPEX mensalizado" value={inputs.capex} onChange={(v: any) => set('capex', v)} naoSabe={inputs.capex_nao_sabe} onNaoSabe={(v: any) => set('capex_nao_sabe', v)} />
      <FieldNaoSabe label="Retiradas dos sócios — pró-labore + lucros + informal, total mensal" value={inputs.retiradas} onChange={(v: any) => set('retiradas', v)} naoSabe={inputs.retiradas_nao_sabe} onNaoSabe={(v: any) => set('retiradas_nao_sabe', v)} />
      <FieldNaoSabe label="Parcelas de empréstimos e financiamentos — total mensal" value={inputs.parcelas} onChange={(v: any) => set('parcelas', v)} naoSabe={inputs.parcelas_nao_sabe} onNaoSabe={(v: any) => set('parcelas_nao_sabe', v)} />

      {/* DRE cascade preview */}
      <div className="rounded-lg p-4 space-y-1 mt-4" style={{ background: '#F8FAFC', border: '1px solid #DDE4F0' }}>
        <p className="text-xs font-semibold mb-2" style={{ color: '#4A5E80' }}>DRE em cascata</p>
        <DRELine label="Lucro Operacional" value={dre.lucro_operacional} bold />
        <DRELine label="(-) Marketing" value={dre.marketing} indent />
        <DRELine label="(-) CAPEX" value={dre.capex} indent />
        <DRELine label="(-) Retiradas" value={dre.retiradas} indent />
        <DRELine label="(-) Parcelas" value={dre.parcelas} indent />
        <div className="border-t pt-1 mt-1" style={{ borderColor: '#DDE4F0' }}>
          <DRELine label="= Geração de Caixa" value={dre.geracao_caixa} pct={dre.gc_pct} bold
            color={dre.gc_pct != null ? (dre.gc_pct >= 10 ? '#00A86B' : dre.gc_pct >= 0 ? '#D97706' : '#DC2626') : undefined} />
        </div>
      </div>
    </div>
  );
}

function Step5({ inputs, set, dre }: { inputs: DiagnosticoInputs; set: any; dre: DreResult }) {
  const endivColor = dre.endividamento_pct != null ? (dre.endividamento_pct < 30 ? '#00A86B' : dre.endividamento_pct <= 50 ? '#D97706' : '#DC2626') : '#94A3B8';
  const endivLabel = dre.endividamento_pct != null ? (dre.endividamento_pct < 30 ? 'Seguro' : dre.endividamento_pct <= 50 ? 'Atenção' : 'Risco') : '—';

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold" style={{ color: '#0D1B35' }}>Dívidas e Endividamento</h2>
      <FieldNaoSabe label="Fornecedores em aberto (contas a pagar vencidas/a vencer)" value={inputs.fornecedores} onChange={(v: any) => set('fornecedores', v)} naoSabe={inputs.fornecedores_nao_sabe} onNaoSabe={(v: any) => set('fornecedores_nao_sabe', v)} />
      <FieldNaoSabe label="Impostos atrasados (DAS, FGTS, parcelamentos fiscais)" value={inputs.impostos_atrasados} onChange={(v: any) => set('impostos_atrasados', v)} naoSabe={inputs.impostos_atrasados_nao_sabe} onNaoSabe={(v: any) => set('impostos_atrasados_nao_sabe', v)} />
      <FieldNaoSabe label="Saldo devedor total de empréstimos bancários" sublabel="Não a parcela mensal, o total devedor" value={inputs.emprestimos_saldo} onChange={(v: any) => set('emprestimos_saldo', v)} naoSabe={inputs.emprestimos_saldo_nao_sabe} onNaoSabe={(v: any) => set('emprestimos_saldo_nao_sabe', v)} />
      <FieldNaoSabe label="Outras dívidas — sócios, antecipações, informais" value={inputs.outras_dividas} onChange={(v: any) => set('outras_dividas', v)} naoSabe={inputs.outras_dividas_nao_sabe} onNaoSabe={(v: any) => set('outras_dividas_nao_sabe', v)} />

      {/* Endividamento gauge */}
      <div className="rounded-lg p-4 mt-4" style={{ background: '#F8FAFC', border: '1px solid #DDE4F0' }}>
        <p className="text-xs font-semibold mb-2" style={{ color: '#4A5E80' }}>Indicador de Endividamento</p>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
            <div className="h-full rounded-full transition-all" style={{
              width: `${Math.min(100, dre.endividamento_pct ?? 0)}%`,
              background: endivColor,
            }} />
          </div>
          <span className="font-mono-data text-sm font-bold" style={{ color: endivColor }}>{fmtPct(dre.endividamento_pct)}</span>
        </div>
        <div className="flex justify-between mt-1 text-[10px]" style={{ color: '#94A3B8' }}>
          <span>0%</span><span>30% Seguro</span><span>50% Atenção</span><span>100% Risco</span>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <div className="h-2 w-2 rounded-full" style={{ background: endivColor }} />
          <span className="text-xs font-semibold" style={{ color: endivColor }}>{endivLabel}</span>
        </div>
      </div>
    </div>
  );
}

// ── DRE Line helper ──
function DRELine({ label, value, pct, bold, indent, color }: {
  label: string; value: number | null; pct?: number | null; bold?: boolean; indent?: boolean; color?: string;
}) {
  const isNull = value == null;
  return (
    <div className="flex justify-between items-center py-0.5" style={{ paddingLeft: indent ? 16 : 0 }}>
      <span className="text-xs" style={{ fontWeight: bold ? 700 : 400, color: color || '#4A5E80' }}>{label}</span>
      <span className="font-mono-data text-xs" style={{ fontWeight: bold ? 700 : 400, color: isNull ? '#94A3B8' : (color || '#0D1B35'), fontStyle: isNull ? 'italic' : 'normal' }}>
        {isNull ? '⚠ N/I' : fmtBRL(value)}
        {pct != null && <span className="ml-1 text-[10px]" style={{ color: color || '#7A8FB0' }}>({fmtPct(pct)})</span>}
      </span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// RESULT SCREEN
// ══════════════════════════════════════════════════════════════
function ResultScreen({ dre, inputs, onBack }: { dre: DreResult; inputs: DiagnosticoInputs; onBack: () => void }) {
  const scoreInfo = getScoreLabel(dre.score);
  const pitchTitle = getPitchTitle(inputs, dre);

  const kpiCard = (label: string, value: number | null, ref: number, unit: string, inverted = false) => {
    const v = value ?? 0;
    const ok = inverted ? v <= ref : v >= ref;
    const color = ok ? '#00A86B' : '#DC2626';
    return (
      <div className="rounded-lg p-4" style={{ background: '#fff', border: '1px solid #DDE4F0' }}>
        <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: '#7A8FB0' }}>{label}</p>
        <p className="font-mono-data text-2xl font-bold" style={{ color }}>{value != null ? `${value.toFixed(1)}${unit}` : 'N/I'}</p>
        <div className="h-1.5 rounded-full mt-2 mb-1" style={{ background: '#E2E8F0' }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.abs(v))}%`, background: color }} />
        </div>
        <p className="text-[10px]" style={{ color: '#7A8FB0' }}>Ref GPI: {ref}{unit}</p>
        <div className="flex items-center gap-1 mt-1.5 text-[11px] font-medium" style={{ color }}>
          {ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
          {ok ? 'Dentro do benchmark' : 'Acima do limite'}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen" style={{ background: '#F0F4FA', backgroundImage: 'radial-gradient(circle, #C1CBD9 1px, transparent 1px)', backgroundSize: '28px 28px' }}>
      <div className="sticky top-0 z-10 border-b" style={{ background: '#F0F4FA', borderColor: '#DDE4F0' }}>
        <div className="mx-auto flex max-w-[680px] items-center gap-3 px-6 py-3">
          <div className="flex h-7 items-center rounded-full px-3" style={{ background: '#0D1B35' }}>
            <span className="text-[11px] font-bold tracking-wider text-white">GPI</span>
          </div>
          <span className="text-sm font-semibold" style={{ color: '#0D1B35' }}>Diagnóstico Financeiro — {inputs.nome_empresa}</span>
        </div>
      </div>

      <div className="mx-auto max-w-[680px] px-6 py-8 space-y-6">
        <Button variant="outline" onClick={onBack} size="sm">← Voltar e editar</Button>

        {/* 4.1 — DRE Cascata */}
        <div className="rounded-[14px] p-6" style={{ background: '#fff', border: '1px solid #DDE4F0', boxShadow: '0 2px 12px rgba(13,27,53,0.08)' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: '#0D1B35' }}>DRE Gerencial</h3>
          <DRELine label="Faturamento Bruto" value={dre.faturamento} bold />
          <DRELine label="(-) CMV" value={dre.cmv} indent />
          <DRELine label="(-) Impostos" value={dre.impostos} indent />
          <DRELine label="(-) Taxas de cartão" value={dre.taxas_cartao} indent />
          <div className="border-t my-1" style={{ borderColor: '#DDE4F0' }} />
          <DRELine label="= Margem de Contribuição" value={dre.margem_contribuicao} pct={dre.mc_pct} bold
            color={dre.mc_pct != null ? (dre.mc_pct >= 40 ? '#00A86B' : dre.mc_pct >= 30 ? '#D97706' : '#DC2626') : undefined} />
          <DRELine label="(-) Despesas administrativas" value={dre.despesas_admin} indent />
          <DRELine label="(-) Folha de pessoal" value={dre.folha_total} indent />
          <DRELine label="(-) Manutenção" value={dre.manutencao} indent />
          <DRELine label="(-) Despesas diversas" value={dre.despesas_diversas} indent />
          <div className="border-t my-1" style={{ borderColor: '#DDE4F0' }} />
          <DRELine label="= Lucro Operacional" value={dre.lucro_operacional} pct={dre.lucro_op_pct} bold />
          <DRELine label="(-) Marketing" value={dre.marketing} indent />
          <DRELine label="(-) CAPEX" value={dre.capex} indent />
          <DRELine label="(-) Retiradas sócios" value={dre.retiradas} indent />
          <DRELine label="(-) Parcelas" value={dre.parcelas} indent />
          <div className="border-t my-1" style={{ borderColor: '#DDE4F0' }} />
          <DRELine label="= Geração de Caixa" value={dre.geracao_caixa} pct={dre.gc_pct} bold
            color={dre.gc_pct != null ? (dre.gc_pct >= 10 ? '#00A86B' : dre.gc_pct >= 0 ? '#D97706' : '#DC2626') : undefined} />
        </div>

        {/* 4.2 — KPIs Grid */}
        <div className="grid grid-cols-2 gap-3">
          {kpiCard('Margem de Contribuição', dre.mc_pct, 40, '%')}
          {kpiCard('CMV', dre.cmv_pct, 38, '%', true)}
          {kpiCard('CMO', dre.cmo_pct, 25, '%', true)}
          {kpiCard('Geração de Caixa', dre.gc_pct, 10, '%')}
        </div>

        {/* 4.3 — Ponto de Equilíbrio */}
        <div className="rounded-[14px] p-6" style={{ background: '#fff', border: '1px solid #DDE4F0' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: '#0D1B35' }}>Ponto de Equilíbrio</h3>
          <p className="font-mono-data text-xl font-bold" style={{ color: '#0D1B35' }}>{fmtBRL(dre.pe_valor)}</p>
          {dre.faturamento != null && dre.pe_valor != null && (
            <div className="mt-3">
              <div className="h-3 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                <div className="h-full rounded-full" style={{
                  width: `${Math.min(100, dre.faturamento > 0 ? (dre.pe_valor / dre.faturamento) * 100 : 0)}%`,
                  background: (dre.margem_seguranca ?? 0) >= 20 ? '#00A86B' : (dre.margem_seguranca ?? 0) >= 0 ? '#D97706' : '#DC2626',
                }} />
              </div>
              <div className="flex justify-between mt-1 text-[10px]" style={{ color: '#94A3B8' }}>
                <span>PE: {fmtBRL(dre.pe_valor)}</span>
                <span>Fat: {fmtBRL(dre.faturamento)}</span>
              </div>
              <p className="text-xs mt-2" style={{ color: '#4A5E80' }}>
                Margem de Segurança: <span className="font-mono-data font-bold">{fmtPct(dre.margem_seguranca)}</span>
              </p>
            </div>
          )}
        </div>

        {/* 4.4 — Retiradas */}
        <div className="rounded-[14px] p-6" style={{ background: '#fff', border: '1px solid #DDE4F0' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: '#0D1B35' }}>Retiradas dos Sócios</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <p className="text-[10px] uppercase" style={{ color: '#7A8FB0' }}>Valor mensal</p>
              <p className="font-mono-data text-sm font-bold">{fmtBRL(dre.retiradas)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase" style={{ color: '#7A8FB0' }}>% Faturamento</p>
              <p className="font-mono-data text-sm font-bold" style={{ color: (dre.retiradas_pct_fat ?? 0) > 5 ? '#DC2626' : '#0D1B35' }}>
                {fmtPct(dre.retiradas_pct_fat)} <span className="text-[9px] font-normal" style={{ color: '#94A3B8' }}>ref: ≤5%</span>
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase" style={{ color: '#7A8FB0' }}>% Geração Caixa</p>
              <p className="font-mono-data text-sm font-bold" style={{ color: (dre.retiradas_pct_gc ?? 0) > 50 ? '#DC2626' : '#0D1B35' }}>
                {fmtPct(dre.retiradas_pct_gc)} <span className="text-[9px] font-normal" style={{ color: '#94A3B8' }}>ref: ≤50%</span>
              </p>
            </div>
          </div>
          {dre.retiradas_pct_gc != null && dre.retiradas_pct_gc > 50 && dre.geracao_caixa != null && (
            <div className="mt-3 rounded-md px-3 py-2 text-xs" style={{ background: '#FEF2F2', color: '#DC2626', border: '1px solid #FECACA' }}>
              <AlertTriangle className="h-3 w-3 inline mr-1" />
              Retirada máxima sustentável: <strong>{fmtBRL(dre.geracao_caixa * 0.5)}</strong> (50% da Geração de Caixa atual)
            </div>
          )}
          {dre.retiradas_pct_gc != null && dre.retiradas_pct_gc <= 50 && (
            <div className="mt-3 rounded-md px-3 py-2 text-xs" style={{ background: '#ECFDF5', color: '#00A86B', border: '1px solid #A7F3D0' }}>
              <Check className="h-3 w-3 inline mr-1" /> Retiradas dentro do limite sustentável
            </div>
          )}
        </div>

        {/* 4.5 — Endividamento */}
        <div className="rounded-[14px] p-6" style={{ background: '#fff', border: '1px solid #DDE4F0' }}>
          <h3 className="text-sm font-bold mb-3" style={{ color: '#0D1B35' }}>Endividamento</h3>
          <div className="flex items-center gap-3">
            <p className="font-mono-data text-xl font-bold">{fmtBRL(dre.total_dividas)}</p>
            <span className="font-mono-data text-sm font-bold" style={{
              color: dre.endividamento_pct != null ? (dre.endividamento_pct < 30 ? '#00A86B' : dre.endividamento_pct <= 50 ? '#D97706' : '#DC2626') : '#94A3B8',
            }}>{fmtPct(dre.endividamento_pct)}</span>
          </div>
          <div className="h-3 rounded-full overflow-hidden mt-3" style={{ background: '#E2E8F0' }}>
            <div className="h-full rounded-full transition-all" style={{
              width: `${Math.min(100, dre.endividamento_pct ?? 0)}%`,
              background: dre.endividamento_pct != null ? (dre.endividamento_pct < 30 ? '#00A86B' : dre.endividamento_pct <= 50 ? '#D97706' : '#DC2626') : '#94A3B8',
            }} />
          </div>
          <div className="flex justify-between mt-1 text-[10px]" style={{ color: '#94A3B8' }}>
            <span>Seguro &lt;30%</span><span>Atenção 30–50%</span><span>Risco &gt;50%</span>
          </div>
          {inputs.impostos_atrasados_nao_sabe && (
            <div className="mt-3 rounded-md px-3 py-2 text-[11px]" style={{ background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }}>
              <AlertTriangle className="h-3 w-3 inline mr-1" /> Impostos atrasados não informados — endividamento pode ser maior
            </div>
          )}
        </div>

        {/* 4.6 — Score */}
        <div className="rounded-[14px] p-6 flex flex-col items-center" style={{ background: '#fff', border: '1px solid #DDE4F0' }}>
          <ScoreRing score={dre.score} size={160} />
          <p className="text-sm font-bold mt-3" style={{ color: scoreInfo.color }}>{scoreInfo.label}</p>
          {dre.penalidades.length > 0 && (
            <ul className="mt-3 space-y-1 w-full">
              {dre.penalidades.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-xs" style={{ color: '#4A5E80' }}>
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" style={{ color: '#DC2626' }} />
                  {p}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 4.7 — Pitch GPI */}
        <div className="rounded-[14px] p-6 relative overflow-hidden" style={{
          background: '#fff', border: '1px solid #DDE4F0',
          borderTop: '3px solid hsl(233 100% 55%)',
        }}>
          <p className="text-base font-bold mb-4" style={{ color: '#0D1B35' }}>{pitchTitle}</p>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[
              { icon: GraduationCap, title: 'Treinamento', desc: 'O operador aprende o método, não apenas usa o sistema' },
              { icon: BookOpen, title: 'Método', desc: 'Plano de contas, categorias, ciclo mensal com prazos' },
              { icon: Monitor, title: 'Plataforma', desc: 'DRE, alertas, dashboards num único lugar' },
              { icon: Search, title: 'Acompanhamento', desc: 'Analista revisa lançamentos todos os dias úteis' },
            ].map(p => (
              <div key={p.title} className="rounded-lg p-3" style={{ border: '1px solid #DDE4F0' }}>
                <p.icon className="h-5 w-5 mb-1.5" style={{ color: 'hsl(233 100% 55%)' }} />
                <p className="text-xs font-bold" style={{ color: '#0D1B35' }}>{p.title}</p>
                <p className="text-[11px] mt-0.5" style={{ color: '#7A8FB0' }}>{p.desc}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-4">
            {['Auditoria diária', 'Alertas semanais', 'DRE mensal completa', 'Dashboards em tempo real',
              'Ponto de equilíbrio monitorado', 'Indicador de endividamento', 'Torre de Controle com metas', 'Reunião mensal de análise',
            ].map(pill => (
              <span key={pill} className="rounded-full px-2.5 py-1 text-[10px] font-medium" style={{ background: '#EEF2FF', color: 'hsl(233 100% 55%)' }}>
                {pill}
              </span>
            ))}
          </div>
          <p className="text-xs mb-3" style={{ color: '#4A5E80' }}>
            Próximo passo: agendar reunião de 30 minutos para apresentar a proposta personalizada com base neste diagnóstico. Sem compromisso.
          </p>
          <Button className="w-full" asChild>
            <a href="#">Agendar reunião</a>
          </Button>
        </div>
      </div>
    </div>
  );
}
