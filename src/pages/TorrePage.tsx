import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BookOpen, FileSpreadsheet, Upload, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from 'lucide-react';
import { formatCurrency, type ContaRow } from '@/lib/plano-contas-utils';
import { getCompetenciaOptions } from '@/lib/nibo-import-utils';
import { getLeafContas, sumLeafByTipo, calcIndicador, sumChildrenOfGroup, sumChildrenOfSection, indicadorAfterType } from '@/lib/dre-indicadores';
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

function DeltaBadge({ realizado, meta }: { realizado: number | null; meta: number | null }) {
  if (realizado == null || meta == null || meta === 0) return null;
  const delta = ((realizado - meta) / Math.abs(meta)) * 100;
  const positive = delta >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${positive ? 'bg-green/10 text-green' : 'bg-red/10 text-red'}`}>
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {positive ? '+' : ''}{delta.toFixed(1)}%
    </span>
  );
}

export default function TorrePage() {
  const [clienteId, setClienteId] = useState('');
  const [competencia, setCompetencia] = useState(competencias[0]?.value || '');
  const [importOpen, setImportOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
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
      return (data || []) as ContaRow[];
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
      const { data } = await supabase.from('importacoes_nibo').select('created_at').eq('cliente_id', clienteId).order('created_at', { ascending: false }).limit(1);
      return (data as any)?.[0] || null;
    },
  });

  const realizadoMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valores?.forEach((v) => { map[v.conta_id] = v.valor_realizado; });
    return map;
  }, [valores]);

  const metaMap = useMemo(() => {
    const map: Record<string, number | null> = {};
    valores?.forEach((v) => { map[v.conta_id] = v.valor_meta; });
    return map;
  }, [valores]);

  const leafContas = useMemo(() => contas ? getLeafContas(contas) : [], [contas]);

  const faturamento = useMemo(() => {
    if (!leafContas.length) return { real: 0, meta: 0 };
    const receitaLeafs = leafContas.filter((c) => c.tipo === 'receita');
    let real = 0, meta = 0;
    receitaLeafs.forEach((c) => {
      const r = realizadoMap[c.id];
      if (r != null) real += r;
      const m = metaMap[c.id];
      if (m != null) meta += m;
    });
    return { real, meta };
  }, [leafContas, realizadoMap, metaMap]);

  const custosTotal = useMemo(() => sumLeafByTipo(contas || [], realizadoMap, 'custo_variavel'), [contas, realizadoMap]);
  const despesasTotal = useMemo(() => sumLeafByTipo(contas || [], realizadoMap, 'despesa_fixa'), [contas, realizadoMap]);
  const investTotal = useMemo(() => sumLeafByTipo(contas || [], realizadoMap, 'investimento'), [contas, realizadoMap]);

  const margem = faturamento.real - custosTotal;
  const resultOp = margem - despesasTotal;
  const geracaoCaixa = resultOp - investTotal;
  const clienteSel = clientes?.find((c) => c.id === clienteId);
  const compLabel = competencias.find((c) => c.value === competencia)?.label || '';
  const hasContas = contas && contas.length > 0;
  const hasValores = valores && valores.some((v) => v.valor_realizado != null);

  const kpis = [
    { label: 'Faturamento Bruto', value: faturamento.real, meta: faturamento.meta, pct: null },
    { label: 'Margem de Contribuição', value: margem, meta: null, pct: faturamento.real ? (margem / faturamento.real * 100).toFixed(1) : '0' },
    { label: 'Resultado Operacional', value: resultOp, meta: null, pct: faturamento.real ? (resultOp / faturamento.real * 100).toFixed(1) : '0' },
    { label: 'Geração de Caixa', value: geracaoCaixa, meta: null, pct: faturamento.real ? (geracaoCaixa / faturamento.real * 100).toFixed(1) : '0' },
  ];

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Build visible rows with hierarchy
  const visibleContas = useMemo(() => {
    if (!contas) return [];
    return contas.filter((conta) => {
      if (conta.nivel === 2 && conta.conta_pai_id && collapsed.has(conta.conta_pai_id)) return false;
      if (conta.nivel === 1 && conta.conta_pai_id && collapsed.has(conta.conta_pai_id)) return false;
      if (conta.nivel === 2 && conta.conta_pai_id) {
        const parent = contas.find((c) => c.id === conta.conta_pai_id);
        if (parent?.conta_pai_id && collapsed.has(parent.conta_pai_id)) return false;
      }
      return true;
    });
  }, [contas, collapsed]);

  // Build rows with indicators
  const dreRows = useMemo(() => {
    const rows: ({ type: 'conta'; conta: ContaRow } | { type: 'indicador'; indicador: any })[] = [];
    let lastTipo = '';
    for (const conta of visibleContas) {
      if (lastTipo && lastTipo !== conta.tipo) {
        const ind = indicadorAfterType[lastTipo];
        if (ind) rows.push({ type: 'indicador', indicador: ind });
      }
      rows.push({ type: 'conta', conta });
      lastTipo = conta.tipo;
    }
    if (lastTipo) {
      const ind = indicadorAfterType[lastTipo];
      if (ind) rows.push({ type: 'indicador', indicador: ind });
    }
    return rows;
  }, [visibleContas]);

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-txt">Torre de Controle</h1></div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label className="text-xs text-txt-muted">Cliente</label>
          <Select value={clienteId} onValueChange={(v) => { setClienteId(v); setCollapsed(new Set()); }}>
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

      {clienteId && hasContas && hasValores && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {kpis.map((kpi, i) => (
              <div key={i} className="rounded-xl border border-border bg-surface overflow-hidden">
                <div className="h-[3px] bg-gradient-to-r from-primary to-transparent" />
                <div className="p-4 space-y-2">
                  <p className="text-xs text-txt-muted">{kpi.label}</p>
                  <p className="text-xl font-bold font-mono-data text-txt">
                    <AnimatedNumber value={kpi.value} />
                  </p>
                  <div className="flex items-center gap-2">
                    {kpi.meta != null && <DeltaBadge realizado={kpi.value} meta={kpi.meta} />}
                    {kpi.pct && <span className="text-xs text-txt-sec">{kpi.pct}% s/ fat.</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-surface overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-hi text-left text-xs text-txt-muted">
                  <th className="p-3">Conta DRE</th>
                  <th className="p-3 text-right">Realizado</th>
                  <th className="p-3 text-right">A.V.%</th>
                  <th className="p-3 text-right">Meta</th>
                  <th className="p-3 text-right">Δ vs Meta</th>
                </tr>
              </thead>
              <tbody>
                {dreRows.map((row, idx) => {
                  if (row.type === 'indicador') {
                    const ind = row.indicador;
                    const realVal = calcIndicador(contas!, realizadoMap, ind.acumula);
                    const metaVal = calcIndicador(contas!, metaMap, ind.acumula);
                    const av = faturamento.real ? ((realVal / faturamento.real) * 100).toFixed(1) : null;
                    return (
                      <tr key={ind.key} className={`border-b-2 border-border border-l-[3px] ${ind.borderColor} bg-primary/5 font-bold`}>
                        <td className="p-3 text-txt">{ind.nome}</td>
                        <td className="p-3 text-right font-mono-data">
                          <span className={realVal >= 0 ? 'text-green' : 'text-destructive'}>{formatCurrency(realVal)}</span>
                        </td>
                        <td className="p-3 text-right text-xs text-txt-sec">{av ? `${av}%` : '—'}</td>
                        <td className="p-3 text-right font-mono-data text-txt-sec">{metaVal !== 0 ? formatCurrency(metaVal) : '—'}</td>
                        <td className="p-3 text-right"><DeltaBadge realizado={realVal} meta={metaVal !== 0 ? metaVal : null} /></td>
                      </tr>
                    );
                  }

                  const conta = row.conta;
                  const isSecao = conta.nivel === 0;
                  const isGrupo = conta.nivel === 1;

                  let displayReal: number | null = null;
                  let displayMeta: number | null = null;
                  if (conta.nivel === 2) {
                    displayReal = realizadoMap[conta.id] ?? null;
                    displayMeta = metaMap[conta.id] ?? null;
                  } else if (isGrupo) {
                    displayReal = sumChildrenOfGroup(contas!, realizadoMap, conta.id);
                    displayMeta = sumChildrenOfGroup(contas!, metaMap, conta.id);
                  } else if (isSecao) {
                    displayReal = sumChildrenOfSection(contas!, realizadoMap, conta.id);
                    displayMeta = sumChildrenOfSection(contas!, metaMap, conta.id);
                  }

                  const av = displayReal != null && faturamento.real ? ((displayReal / faturamento.real) * 100).toFixed(1) : null;
                  const borderColor = tipoBorderColors[conta.tipo] || 'border-l-transparent';
                  const hasChildren = contas!.some((c) => c.conta_pai_id === conta.id);
                  const isCollapsed = collapsed.has(conta.id);

                  return (
                    <tr
                      key={conta.id}
                      className={`border-b border-border/50 border-l-[3px] ${borderColor} ${
                        isSecao ? 'bg-muted font-bold uppercase text-xs' :
                        isGrupo ? 'bg-muted/50 font-semibold' : ''
                      }`}
                      style={{ animation: `waterfallIn 0.4s cubic-bezier(0.16,1,0.3,1) ${idx * 0.03}s both` }}
                    >
                      <td className="p-3 text-txt" style={{ paddingLeft: `${12 + conta.nivel * 20}px` }}>
                        <div className="flex items-center gap-1.5">
                          {hasChildren && (isSecao || isGrupo) && (
                            <button onClick={() => toggleCollapse(conta.id)} className="p-0.5 rounded hover:bg-surface-hi">
                              {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                            </button>
                          )}
                          {conta.nome}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono-data text-txt">
                        {displayReal != null ? formatCurrency(displayReal) : '—'}
                      </td>
                      <td className="p-3 text-right text-xs text-txt-sec">{av ? `${av}%` : '—'}</td>
                      <td className="p-3 text-right font-mono-data text-txt-sec">
                        {displayMeta != null ? formatCurrency(displayMeta) : '—'}
                      </td>
                      <td className="p-3 text-right"><DeltaBadge realizado={displayReal} meta={displayMeta} /></td>
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
          contas={contas?.filter((c) => c.nivel === 2).map((c) => ({ id: c.id, nome: c.nome })) || []}
        />
      )}
    </div>
  );
}
