import { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { Save, RotateCcw, Trash2, Plus } from 'lucide-react';
import type { ContaRow } from '@/lib/plano-contas-utils';

export interface BenchmarkThresholds {
  cmv_verde: number;
  cmv_amarelo: number;
  cmo_verde: number;
  cmo_amarelo: number;
}

export const DEFAULT_BENCHMARKS: BenchmarkThresholds = {
  cmv_verde: 38,
  cmv_amarelo: 50,
  cmo_verde: 25,
  cmo_amarelo: 35,
};

interface Props {
  clienteId: string;
}

interface BenchmarkConfigRow {
  id: string;
  cliente_id: string;
  conta_id: string;
  limite_verde: number;
  limite_ambar: number;
  direcao: string;
}

interface SubgrupoBenchmarkForm {
  conta_id: string;
  limite_verde: string;
  limite_ambar: string;
  direcao: string;
}

const TIPO_GROUPS = [
  { tipo: 'custo_variavel', label: 'CUSTOS VARIÁVEIS' },
  { tipo: 'despesa_fixa', label: 'DESPESAS FIXAS' },
  { tipo: 'investimento', label: 'INVESTIMENTOS' },
  { tipo: 'financeiro', label: 'FINANCEIRO' },
];

export function BenchmarkConfigTab({ clienteId }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BenchmarkThresholds>(DEFAULT_BENCHMARKS);
  const [subForms, setSubForms] = useState<Record<string, SubgrupoBenchmarkForm>>({});
  const [flashId, setFlashId] = useState<string | null>(null);

  // Legacy benchmark_config
  const { data: configs, isLoading } = useQuery({
    queryKey: ['benchmark-config', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('benchmark_config')
        .select('*')
        .eq('cliente_id', clienteId);
      return data || [];
    },
  });

  // Plano de contas — subgrupos (nivel=1)
  const { data: contas } = useQuery({
    queryKey: ['plano-contas-subgrupos', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('plano_de_contas')
        .select('*')
        .eq('cliente_id', clienteId)
        .order('ordem');
      return (data || []) as ContaRow[];
    },
  });

  // New benchmark_configuracoes
  const { data: benchmarkConfigs } = useQuery({
    queryKey: ['benchmark-configuracoes', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('benchmark_configuracoes' as any)
        .select('*')
        .eq('cliente_id', clienteId);
      return (data || []) as BenchmarkConfigRow[];
    },
  });

  const subgrupos = useMemo(() => {
    if (!contas) return [];
    return contas.filter(c => c.nivel === 1 && ['custo_variavel', 'despesa_fixa', 'investimento', 'financeiro'].includes(c.tipo));
  }, [contas]);

  const configMap = useMemo(() => {
    const map = new Map<string, BenchmarkConfigRow>();
    benchmarkConfigs?.forEach(c => map.set(c.conta_id, c));
    return map;
  }, [benchmarkConfigs]);

  // Initialize subForms from saved configs
  useEffect(() => {
    if (!subgrupos.length) return;
    const forms: Record<string, SubgrupoBenchmarkForm> = {};
    for (const sub of subgrupos) {
      const existing = configMap.get(sub.id);
      forms[sub.id] = {
        conta_id: sub.id,
        limite_verde: existing ? String(existing.limite_verde) : '',
        limite_ambar: existing ? String(existing.limite_ambar) : '',
        direcao: existing?.direcao || 'menor_melhor',
      };
    }
    setSubForms(forms);
  }, [subgrupos, configMap]);

  useEffect(() => {
    if (!configs) return;
    const merged = { ...DEFAULT_BENCHMARKS };
    for (const c of configs) {
      if (c.tipo === 'cmv') {
        merged.cmv_verde = Number(c.limite_verde);
        merged.cmv_amarelo = Number(c.limite_amarelo);
      }
      if (c.tipo === 'cmo') {
        merged.cmo_verde = Number(c.limite_verde);
        merged.cmo_amarelo = Number(c.limite_amarelo);
      }
    }
    setForm(merged);
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: async (values: BenchmarkThresholds) => {
      const upserts = [
        { cliente_id: clienteId, tipo: 'cmv', limite_verde: values.cmv_verde, limite_amarelo: values.cmv_amarelo },
        { cliente_id: clienteId, tipo: 'cmo', limite_verde: values.cmo_verde, limite_amarelo: values.cmo_amarelo },
      ];
      for (const u of upserts) {
        const { error } = await supabase
          .from('benchmark_config')
          .upsert(u, { onConflict: 'cliente_id,tipo' });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benchmark-config', clienteId] });
      toast.success('Benchmarks salvos com sucesso');
    },
    onError: () => toast.error('Erro ao salvar benchmarks'),
  });

  const saveSubBenchmark = useMutation({
    mutationFn: async (f: SubgrupoBenchmarkForm) => {
      const verde = Number(f.limite_verde);
      const ambar = Number(f.limite_ambar);
      if (isNaN(verde) || isNaN(ambar)) throw new Error('Valores inválidos');
      if (f.direcao === 'menor_melhor' && verde >= ambar) throw new Error('Verde deve ser menor que âmbar');
      if (f.direcao === 'maior_melhor' && verde <= ambar) throw new Error('Verde deve ser maior que âmbar');

      const { error } = await supabase
        .from('benchmark_configuracoes' as any)
        .upsert({
          cliente_id: clienteId,
          conta_id: f.conta_id,
          limite_verde: verde,
          limite_ambar: ambar,
          direcao: f.direcao,
        }, { onConflict: 'cliente_id,conta_id' });
      if (error) throw error;
      return f.conta_id;
    },
    onSuccess: (contaId) => {
      queryClient.invalidateQueries({ queryKey: ['benchmark-configuracoes', clienteId] });
      setFlashId(contaId);
      setTimeout(() => setFlashId(null), 1200);
      toast.success('Benchmark salvo');
    },
    onError: (err: Error) => toast.error(err.message || 'Erro ao salvar'),
  });

  const removeSubBenchmark = useMutation({
    mutationFn: async (contaId: string) => {
      const { error } = await supabase
        .from('benchmark_configuracoes' as any)
        .delete()
        .eq('cliente_id', clienteId)
        .eq('conta_id', contaId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['benchmark-configuracoes', clienteId] });
      toast.success('Benchmark removido');
    },
    onError: () => toast.error('Erro ao remover'),
  });

  const handleSave = () => {
    if (form.cmv_verde >= form.cmv_amarelo) {
      toast.error('CMV: limite verde deve ser menor que o amarelo');
      return;
    }
    if (form.cmo_verde >= form.cmo_amarelo) {
      toast.error('CMO: limite verde deve ser menor que o amarelo');
      return;
    }
    saveMutation.mutate(form);
  };

  const handleReset = () => setForm(DEFAULT_BENCHMARKS);

  const updateSubForm = (contaId: string, field: keyof SubgrupoBenchmarkForm, value: string) => {
    setSubForms(prev => ({
      ...prev,
      [contaId]: { ...prev[contaId], [field]: value },
    }));
  };

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>;

  const configured = subgrupos.filter(s => configMap.has(s.id));
  const unconfigured = subgrupos.filter(s => !configMap.has(s.id));

  return (
    <div className="space-y-6 py-4">
      {/* Legacy CMV/CMO cards */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Benchmarks GPI — Custos Variáveis (CMV)</CardTitle>
          <CardDescription>Define os limites de análise vertical para contas do tipo Custo Variável.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <BenchmarkField label="Saudável (verde)" description="AV% abaixo deste valor" value={form.cmv_verde} onChange={(v) => setForm(f => ({ ...f, cmv_verde: v }))} dotColor="#00A86B" />
            <BenchmarkField label="Atenção (amarelo) até" description="AV% entre verde e este valor" value={form.cmv_amarelo} onChange={(v) => setForm(f => ({ ...f, cmv_amarelo: v }))} dotColor="#D97706" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#DC2626" /></svg>
              Acima de {form.cmv_amarelo}% é considerado <strong>risco</strong>.
            </span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Benchmarks GPI — Pessoal / Mão de Obra (CMO)</CardTitle>
          <CardDescription>Define os limites de análise vertical para subgrupos de Pessoal dentro dos custos variáveis.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <BenchmarkField label="Saudável (verde)" description="AV% abaixo deste valor" value={form.cmo_verde} onChange={(v) => setForm(f => ({ ...f, cmo_verde: v }))} dotColor="#00A86B" />
            <BenchmarkField label="Atenção (amarelo) até" description="AV% entre verde e este valor" value={form.cmo_amarelo} onChange={(v) => setForm(f => ({ ...f, cmo_amarelo: v }))} dotColor="#D97706" />
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#DC2626" /></svg>
              Acima de {form.cmo_amarelo}% é considerado <strong>risco</strong>.
            </span>
          </p>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          <Save className="h-4 w-4" />
          Salvar Benchmarks
        </Button>
        <Button variant="outline" onClick={handleReset}>
          <RotateCcw className="h-4 w-4" />
          Restaurar Padrões
        </Button>
      </div>

      {/* ========== BENCHMARKS POR SUBGRUPO ========== */}
      <div style={{ marginTop: 32, paddingTop: 24, borderTop: '2px solid #DDE4F0' }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#8A9BBC', letterSpacing: '0.08em' }}>
          BENCHMARKS POR SUBGRUPO
        </div>
        <p style={{ fontSize: 12, color: '#4A5E80', marginTop: 4 }}>
          Define os limites de desempenho exibidos na DRE por subgrupo (nível 1)
        </p>
      </div>

      {TIPO_GROUPS.map(({ tipo, label }) => {
        const subs = subgrupos.filter(s => s.tipo === tipo);
        if (subs.length === 0) return null;
        return (
          <div key={tipo}>
            <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#4A5E80', letterSpacing: '0.04em', marginBottom: 8 }}>
              {label}
            </div>
            <div className="rounded-lg border" style={{ borderColor: '#DDE4F0', overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: '#F0F4FA', borderBottom: '1px solid #DDE4F0' }}>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80' }}>SUBGRUPO</th>
                    <th style={{ textAlign: 'left', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 160 }}>DIREÇÃO</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 100 }}>LIMITE VERDE</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 100 }}>LIMITE ÂMBAR</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 200 }}>PRÉVIA</th>
                    <th style={{ textAlign: 'center', padding: '8px 12px', fontSize: 11, fontWeight: 600, color: '#4A5E80', width: 120 }}>AÇÕES</th>
                  </tr>
                </thead>
                <tbody>
                  {subs.map(sub => {
                    const f = subForms[sub.id];
                    if (!f) return null;
                    const isConfigured = configMap.has(sub.id);
                    const isFlashing = flashId === sub.id;
                    const cleanName = sub.nome.replace(/^\([+-]\)\s*/, '');

                    const verde = Number(f.limite_verde);
                    const ambar = Number(f.limite_ambar);
                    const hasValid = !isNaN(verde) && !isNaN(ambar) && f.limite_verde !== '' && f.limite_ambar !== '';

                    return (
                      <tr
                        key={sub.id}
                        style={{
                          borderBottom: '1px solid #F0F4FA',
                          background: isFlashing ? '#E8F5E9' : '#FFFFFF',
                          transition: 'background 0.3s',
                        }}
                      >
                        <td style={{ padding: '8px 12px', color: '#0D1B35', fontWeight: 500 }}>
                          {cleanName}
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <Select value={f.direcao} onValueChange={v => updateSubForm(sub.id, 'direcao', v)}>
                            <SelectTrigger className="h-8 text-xs w-[150px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="menor_melhor">Menor é melhor</SelectItem>
                              <SelectItem value="maior_melhor">Maior é melhor</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <div className="flex items-center justify-center gap-1">
                            <input
                              type="number"
                              value={f.limite_verde}
                              onChange={e => updateSubForm(sub.id, 'limite_verde', e.target.value)}
                              placeholder="ex: 38"
                              style={{
                                width: 70, textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                                border: '1px solid #DDE4F0', borderRadius: 4, padding: '4px 6px',
                              }}
                            />
                            <span style={{ fontSize: 11, color: '#8A9BBC' }}>%</span>
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center justify-center gap-1">
                                  <input
                                    type="number"
                                    value={f.limite_ambar}
                                    onChange={e => updateSubForm(sub.id, 'limite_ambar', e.target.value)}
                                    placeholder="ex: 50"
                                    style={{
                                      width: 70, textAlign: 'right', fontFamily: 'monospace', fontSize: 12,
                                      border: '1px solid #DDE4F0', borderRadius: 4, padding: '4px 6px',
                                    }}
                                  />
                                  <span style={{ fontSize: 11, color: '#8A9BBC' }}>%</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>Acima deste valor = vermelho</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          {hasValid ? (
                            <div className="flex items-center justify-center gap-2" style={{ fontSize: 11 }}>
                              <span className="inline-flex items-center gap-1">
                                <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#00A86B" /></svg>
                                {f.direcao === 'menor_melhor' ? `< ${verde}%` : `> ${verde}%`}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#D97706" /></svg>
                                {f.direcao === 'menor_melhor' ? `${verde}–${ambar}%` : `${ambar}–${verde}%`}
                              </span>
                              <span className="inline-flex items-center gap-1">
                                <svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#DC2626" /></svg>
                                {f.direcao === 'menor_melhor' ? `> ${ambar}%` : `< ${ambar}%`}
                              </span>
                            </div>
                          ) : (
                            <span style={{ color: '#C4CFEA', fontSize: 11 }}>—</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => saveSubBenchmark.mutate(f)}
                              disabled={saveSubBenchmark.isPending}
                              style={{
                                background: 'none', border: 'none', color: '#1A3CFF',
                                fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: '4px 8px',
                              }}
                            >
                              Salvar
                            </button>
                            {isConfigured && (
                              <button
                                onClick={() => removeSubBenchmark.mutate(sub.id)}
                                disabled={removeSubBenchmark.isPending}
                                style={{
                                  background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
                                  lineHeight: 0,
                                }}
                              >
                                <Trash2 style={{ width: 14, height: 14, color: '#DC2626' }} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {/* Unconfigured list */}
      {unconfigured.length > 0 && configured.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, color: '#8A9BBC', marginBottom: 8 }}>
            Sem benchmark configurado:
          </div>
          <div className="flex flex-wrap gap-2">
            {unconfigured.map(s => (
              <span key={s.id} style={{
                fontSize: 12, color: '#4A5E80', background: '#F0F4FA',
                padding: '4px 10px', borderRadius: 6, border: '1px solid #DDE4F0',
              }}>
                {s.nome.replace(/^\([+-]\)\s*/, '')}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BenchmarkField({ label, description, value, onChange, dotColor }: {
  label: string;
  description: string;
  value: number;
  onChange: (v: number) => void;
  dotColor: string;
}) {
  return (
    <div className="space-y-2">
      <Label className="flex items-center gap-2">
        <svg width="8" height="8"><circle cx="4" cy="4" r="4" fill={dotColor} /></svg>
        {label}
      </Label>
      <div className="flex items-center gap-2">
        <Input type="number" className="w-24" value={value} min={0} max={100} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
