import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Save, RotateCcw } from 'lucide-react';

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

export function BenchmarkConfigTab({ clienteId }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<BenchmarkThresholds>(DEFAULT_BENCHMARKS);

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
        {
          cliente_id: clienteId,
          tipo: 'cmv',
          limite_verde: values.cmv_verde,
          limite_amarelo: values.cmv_amarelo,
        },
        {
          cliente_id: clienteId,
          tipo: 'cmo',
          limite_verde: values.cmo_verde,
          limite_amarelo: values.cmo_amarelo,
        },
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

  const handleReset = () => {
    setForm(DEFAULT_BENCHMARKS);
  };

  if (isLoading) return <div className="py-8 text-center text-sm text-muted-foreground">Carregando...</div>;

  return (
    <div className="space-y-6 py-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Benchmarks GPI — Custos Variáveis (CMV)</CardTitle>
          <CardDescription>
            Define os limites de análise vertical para contas do tipo Custo Variável.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <BenchmarkField
              label="Saudável (verde)"
              description="AV% abaixo deste valor"
              value={form.cmv_verde}
              onChange={(v) => setForm((f) => ({ ...f, cmv_verde: v }))}
              dotColor="#00A86B"
            />
            <BenchmarkField
              label="Atenção (amarelo) até"
              description="AV% entre verde e este valor"
              value={form.cmv_amarelo}
              onChange={(v) => setForm((f) => ({ ...f, cmv_amarelo: v }))}
              dotColor="#D97706"
            />
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
          <CardDescription>
            Define os limites de análise vertical para subgrupos de Pessoal dentro dos custos variáveis.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <BenchmarkField
              label="Saudável (verde)"
              description="AV% abaixo deste valor"
              value={form.cmo_verde}
              onChange={(v) => setForm((f) => ({ ...f, cmo_verde: v }))}
              dotColor="#00A86B"
            />
            <BenchmarkField
              label="Atenção (amarelo) até"
              description="AV% entre verde e este valor"
              value={form.cmo_amarelo}
              onChange={(v) => setForm((f) => ({ ...f, cmo_amarelo: v }))}
              dotColor="#D97706"
            />
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
        <Input
          type="number"
          className="w-24"
          value={value}
          min={0}
          max={100}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
