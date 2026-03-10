import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BookOpen, FileSpreadsheet, Upload, TrendingUp, TrendingDown } from 'lucide-react';
import { formatCurrency, type ContaTipo, tipoBadgeColors, tipoLabels } from '@/lib/plano-contas-utils';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { getLeafContas } from '@/lib/dre-indicadores';
import { ImportNiboDialog } from '@/components/importacao/ImportNiboDialog';

const competencias = getCompetenciaOptions();

const tipoBorderColors: Record<string, string> = {
  receita: 'border-l-primary',
  custo_variavel: 'border-l-red',
  despesa_fixa: 'border-l-amber',
  investimento: 'border-l-[#9333EA]',
  financeiro: 'border-l-txt-muted',
};

function AnimatedNumber({ value, prefix = '' }: { value: number; prefix?: string }) {
  const [display, setDisplay] = useState(0);
  useState(() => {
    let start = 0;
    const duration = 800;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  });
  return <span>{prefix}{formatCurrency(display)}</span>;
}

function CheckmarkSVG() {
  return (
    <svg className="h-4 w-4 text-green" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline
        points="4 12 9 17 20 6"
        style={{ strokeDasharray: 20, strokeDashoffset: 0, animation: 'checkDraw 0.4s ease-out forwards' }}
      />
    </svg>
  );
}

function DeltaBadge({ realizado, meta }: { realizado: number | null; meta: number | null }) {
  if (realizado == null || meta == null || meta === 0) return null;
  const delta = ((realizado - meta) / Math.abs(meta)) * 100;
  const positive = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${positive ? 'bg-green/10 text-green' : 'bg-red/10 text-red animate-[pulseDelta_2s_ease-in-out_infinite]'}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

export default function TorrePage() {
  const [clienteId, setClienteId] = useState('');
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [importOpen, setImportOpen] = useState(false);
  const navigate = useNavigate();

  const { data: clientes } = useQuery({
    queryKey: ['clientes-ativos'],
    queryFn: async () => {
      const { data } = await supabase.from('clientes').select('id, nome_empresa, segmento').eq('status', 'ativo').order('nome_empresa');
      return data || [];
    },
  });

  const { data: contas } = useQuery({
    queryKey: ['plano-contas-torre', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('plano_de_contas').select('*').eq('cliente_id', clienteId).order('ordem');
      return data || [];
    },
  });

  const { data: valores } = useQuery({
    queryKey: ['valores-mensais-torre', clienteId, competencia],
    enabled: !!clienteId && !!competencia,
    queryFn: async () => {
      const contaIds = contas?.map((c) => c.id) || [];
      if (contaIds.length === 0) return [];
      const { data } = await supabase.from('valores_mensais').select('*').in('conta_id', contaIds).eq('competencia', competencia);
      return data || [];
    },
  });

  const { data: lastImport } = useQuery({
    queryKey: ['last-import', clienteId],
    enabled: !!clienteId,
    queryFn: async () => {
      const { data } = await supabase.from('importacoes_nibo' as any).select('created_at').eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(1);
      return (data as any)?.[0] || null;
    },
  });

  const valoresMap = useMemo(() => {
    const map: Record<string, { valor_realizado: number | null; valor_meta: number | null }> = {};
    valores?.forEach((v) => { map[v.conta_id] = { valor_realizado: v.valor_realizado, valor_meta: v.valor_meta }; });
    return map;
  }, [valores]);

  // KPI calculations
  const leafContas = useMemo(() => contas ? getLeafContas(contas as any) : [], [contas]);

  const faturamento = useMemo(() => {
    if (!leafContas.length) return { real: 0, meta: 0 };
    const receitaLeafs = leafContas.filter((c) => c.tipo === 'receita');
    let real = 0, meta = 0;
    receitaLeafs.forEach((c) => {
      const v = valoresMap[c.id];
      if (v?.valor_realizado) real += v.valor_realizado;
      if (v?.valor_meta) meta += v.valor_meta;
    });
    return { real, meta };
  }, [leafContas, valoresMap]);

  const custos = useMemo(() => {
    return leafContas.filter((c) => c.tipo === 'custo_variavel').reduce((s, c) => s + (valoresMap[c.id]?.valor_realizado || 0), 0);
  }, [leafContas, valoresMap]);

  const despesas = useMemo(() => {
    return leafContas.filter((c) => c.tipo === 'despesa_fixa').reduce((s, c) => s + (valoresMap[c.id]?.valor_realizado || 0), 0);
  }, [leafContas, valoresMap]);

  const margem = faturamento.real - custos;
  const lucro = margem - despesas;
  const clienteSel = clientes?.find((c) => c.id === clienteId);
  const compLabel = competencias.find((c) => c.value === competencia)?.label || '';
  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some((v) => v.valor_realizado != null);

  const kpis = [
    { label: 'Faturamento Bruto', value: faturamento.real, meta: faturamento.meta, ref: null },
    { label: 'Margem de Contribuição', value: margem, meta: null, ref: '> 40%', pct: faturamento.real ? (margem / faturamento.real * 100).toFixed(1) : '0' },
    { label: 'Lucro Operacional', value: lucro, meta: null, ref: null, pct: faturamento.real ? (lucro / faturamento.real * 100).toFixed(1) : '0' },
    { label: 'Geração de Caixa', value: lucro, meta: null, ref: '> 10%', pct: faturamento.real ? (lucro / faturamento.real * 100).toFixed(1) : '0' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-txt">Torre de Controle</h1>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Cliente</label>
          <Select value={clienteId} onValueChange={setClienteId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Selecionar cliente..." /></SelectTrigger>
            <SelectContent>
              {clientes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Competência</label>
          <Select value={competencia} onValueChange={setCompetencia}>
            <SelectTrigger className="w-52"><SelectValue /></SelectTrigger>
            <SelectContent>
              {competencias.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" disabled={!clienteId} onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />Importar Nibo
        </Button>
        {lastImport ? (
          <Badge variant="outline" className="text-xs text-txt-muted">
            Última importação: {new Date((lastImport as any).created_at).toLocaleDateString('pt-BR')}
          </Badge>
        ) : clienteId ? (
          <Badge variant="outline" className="text-xs text-amber">Nenhuma importação</Badge>
        ) : null}
      </div>

      {/* Empty states */}
      {clienteId && !hasContas && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <BookOpen className="h-16 w-16 text-txt-muted/40" />
          <p className="text-txt-sec font-medium">Plano de contas não configurado</p>
          <Button variant="outline" onClick={() => navigate(`/plano-de-contas/${clienteId}`)}>→ Configurar plano de contas</Button>
        </div>
      )}

      {clienteId && hasContas && !hasValores && (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <FileSpreadsheet className="h-16 w-16 text-txt-muted/40" />
          <p className="text-txt-sec font-medium">Nenhum valor importado para {compLabel}</p>
          <Button onClick={() => setImportOpen(true)}><Upload className="mr-2 h-4 w-4" />Importar planilha do Nibo</Button>
        </div>
      )}

      {/* KPI Cards */}
      {clienteId && hasContas && hasValores && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((kpi, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="h-[3px] bg-gradient-to-r from-primary to-transparent" />
                <div className="p-4 space-y-2">
                  <p className="text-xs text-txt-muted">{kpi.label}</p>
                  <p className="text-xl font-bold font-mono-data text-txt">
                    <AnimatedNumber value={kpi.value} prefix="" />
                  </p>
                  <div className="flex items-center gap-2">
                    {kpi.meta != null && <DeltaBadge realizado={kpi.value} meta={kpi.meta} />}
                    {kpi.pct && <span className="text-xs text-txt-sec">{kpi.pct}% s/ fat.</span>}
                    {kpi.ref && <Badge variant="outline" className="text-[10px] text-primary border-primary/30">Ref {kpi.ref}</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* DRE Table */}
          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-hi text-left text-xs text-txt-muted">
                  <th className="p-3">Conta DRE</th>
                  <th className="p-3 text-right">Realizado</th>
                  <th className="p-3 text-right">A.V.%</th>
                  <th className="p-3 text-right">Meta</th>
                  <th className="p-3 text-right">Δ vs Meta</th>
                  <th className="p-3 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {contas?.map((conta, idx) => {
                  const v = valoresMap[conta.id];
                  const real = v?.valor_realizado;
                  const meta = v?.valor_meta;
                  const av = real != null && faturamento.real ? ((real / faturamento.real) * 100).toFixed(1) : null;
                  const isHighlight = conta.is_total || conta.nivel === 1;
                  const borderColor = tipoBorderColors[conta.tipo] || 'border-l-transparent';
                  const metaAtingida = real != null && meta != null && conta.tipo === 'receita' ? real >= meta : real != null && meta != null ? real <= meta : false;

                  return (
                    <tr
                      key={conta.id}
                      className={`border-b border-border/50 border-l-[3px] ${borderColor} ${isHighlight ? 'bg-[hsl(220,60%,97%)] font-semibold' : ''}`}
                      style={{ animation: `waterfallIn 0.4s cubic-bezier(0.16,1,0.3,1) ${idx * 0.055}s both` }}
                    >
                      <td className="p-3 text-txt" style={{ paddingLeft: `${12 + conta.nivel * 20}px` }}>
                        {conta.nome}
                      </td>
                      <td className="p-3 text-right font-mono-data text-txt">
                        {real != null ? (
                          <div className="relative">
                            {formatCurrency(real)}
                            <div
                              className={`absolute bottom-0 left-0 h-[2px] origin-left ${conta.tipo === 'receita' ? 'bg-primary' : conta.tipo === 'custo_variavel' ? 'bg-red' : 'bg-amber'}`}
                              style={{ animation: 'barFill 0.6s ease-out forwards', width: '100%' }}
                            />
                          </div>
                        ) : (
                          <span className="text-txt-muted">—</span>
                        )}
                      </td>
                      <td className="p-3 text-right text-xs text-txt-sec">{av ? `${av}%` : '—'}</td>
                      <td className="p-3 text-right font-mono-data text-txt-sec">
                        {meta != null ? formatCurrency(meta) : '—'}
                      </td>
                      <td className="p-3 text-right">
                        <DeltaBadge realizado={real} meta={meta} />
                      </td>
                      <td className="p-3">
                        {metaAtingida && <CheckmarkSVG />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {clienteId && (
        <ImportNiboDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          clienteId={clienteId}
          clienteNome={clienteSel?.nome_empresa || ''}
          competencia={competencia}
          competenciaLabel={compLabel}
          contas={contas?.map((c) => ({ id: c.id, nome: c.nome })) || []}
        />
      )}
    </div>
  );
}
