import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stethoscope, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScoreRing } from '@/components/ui/score-ring';
import { fmtBRL, fmtPct, getScoreLabel, calcularDRE, type DiagnosticoInputs } from '@/lib/diagnostico-calculos';
import NovoClienteDialog from '@/components/clientes/NovoClienteDialog';

interface Lead {
  id: string;
  nome_empresa: string;
  responsavel_nome: string | null;
  email: string;
  cnpj: string | null;
  segmento: string | null;
  faturamento: number | null;
  dados_diagnostico: any;
  score: number | null;
  status: string | null;
  created_at: string;
}

export default function DiagnosticoLeadsPage() {
  const [segmentoFilter, setSegmentoFilter] = useState('all');
  const [scoreFilter, setScoreFilter] = useState('all');
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showNovoCliente, setShowNovoCliente] = useState(false);

  const { data: leads = [] } = useQuery({
    queryKey: ['diagnostico-leads'],
    queryFn: async () => {
      const { data } = await (supabase as any).from('diagnostico_leads').select('*').order('created_at', { ascending: false });
      return (data || []) as Lead[];
    },
  });

  const filtered = leads.filter(l => {
    if (segmentoFilter !== 'all' && l.segmento !== segmentoFilter) return false;
    if (scoreFilter === 'high' && (l.score == null || l.score < 70)) return false;
    if (scoreFilter === 'mid' && (l.score == null || l.score < 40 || l.score >= 70)) return false;
    if (scoreFilter === 'low' && (l.score == null || l.score >= 40)) return false;
    return true;
  });

  const now = new Date();
  const mesAtual = leads.filter(l => {
    const d = new Date(l.created_at);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const scoreMedio = leads.filter(l => l.score != null).length > 0
    ? Math.round(leads.filter(l => l.score != null).reduce((s, l) => s + (l.score || 0), 0) / leads.filter(l => l.score != null).length)
    : 0;
  const risco = leads.filter(l => l.score != null && l.score < 40).length;

  const segmentos = [...new Set(leads.map(l => l.segmento).filter(Boolean))];

  const getLeadPenalties = (lead: Lead): string[] => {
    if (!lead.dados_diagnostico) return [];
    try {
      const dre = calcularDRE(lead.dados_diagnostico as DiagnosticoInputs);
      return dre.penalidades.slice(0, 2);
    } catch { return []; }
  };

  const scoreColor = (s: number | null) => {
    if (s == null) return '#94A3B8';
    if (s >= 70) return '#00A86B';
    if (s >= 40) return '#D97706';
    return '#DC2626';
  };

  const fmtFat = (v: number | null) => {
    if (v == null) return '—';
    if (v >= 1000000) return `R$ ${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000) return `R$ ${(v / 1000).toFixed(0)}k`;
    return fmtBRL(v);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-txt">Diagnósticos Capturados</h1>
          <Badge variant="secondary" className="font-mono-data">{leads.length}</Badge>
        </div>
        <p className="text-sm text-txt-muted mt-1">Leads do Mini-Diagnóstico Financeiro</p>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Select value={segmentoFilter} onValueChange={setSegmentoFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Segmento" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos segmentos</SelectItem>
            {segmentos.map(s => <SelectItem key={s!} value={s!}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={scoreFilter} onValueChange={setScoreFilter}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Score" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos scores</SelectItem>
            <SelectItem value="high">≥70 Saudável</SelectItem>
            <SelectItem value="mid">40–69 Atenção</SelectItem>
            <SelectItem value="low">&lt;40 Risco</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total diagnósticos', value: leads.length, color: 'hsl(var(--primary))' },
          { label: 'Score médio', value: scoreMedio, color: scoreColor(scoreMedio) },
          { label: 'Score < 40 (risco)', value: risco, color: '#DC2626' },
          { label: 'Leads do mês', value: mesAtual, color: 'hsl(var(--primary))' },
        ].map(k => (
          <div key={k.label} className="rounded-lg border border-border bg-card p-4">
            <p className="text-[10px] font-semibold uppercase text-txt-muted">{k.label}</p>
            <p className="font-mono-data text-2xl font-bold mt-1" style={{ color: k.color }}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-hi">
              <th className="px-4 py-3 text-left text-xs font-semibold text-txt-muted">Empresa</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-txt-muted">Segmento</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-txt-muted">Faturamento</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-txt-muted">Score</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-txt-muted">Pontos Críticos</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-txt-muted">Data</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(lead => {
              const penalties = getLeadPenalties(lead);
              return (
                <tr key={lead.id} className="border-b border-border hover:bg-surface-hi cursor-pointer transition-colors"
                  onClick={() => setSelectedLead(lead)}>
                  <td className="px-4 py-3 font-medium text-txt">{lead.nome_empresa}</td>
                  <td className="px-4 py-3">
                    {lead.segmento && <Badge variant="secondary" className="text-[10px]">{lead.segmento}</Badge>}
                  </td>
                  <td className="px-4 py-3 font-mono-data text-xs">{fmtFat(lead.faturamento)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-12 rounded-full overflow-hidden" style={{ background: '#E2E8F0' }}>
                        <div className="h-full rounded-full" style={{ width: `${lead.score ?? 0}%`, background: scoreColor(lead.score) }} />
                      </div>
                      <span className="font-mono-data text-xs font-bold" style={{ color: scoreColor(lead.score) }}>
                        {lead.score ?? '—'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      {penalties.map((p, i) => (
                        <span key={i} className="rounded-full px-2 py-0.5 text-[9px] font-medium" style={{ background: '#FEF2F2', color: '#DC2626' }}>
                          {p.length > 30 ? p.slice(0, 30) + '…' : p}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-txt-muted">
                    {new Date(lead.created_at).toLocaleDateString('pt-BR')}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-txt-muted">Nenhum diagnóstico encontrado</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedLead} onOpenChange={o => { if (!o) setSelectedLead(null); }}>
        <SheetContent className="overflow-y-auto w-[420px]">
          {selectedLead && <LeadDetail lead={selectedLead} onConvert={() => { setShowNovoCliente(true); }} />}
        </SheetContent>
      </Sheet>

      <NovoClienteDialog open={showNovoCliente} onOpenChange={setShowNovoCliente} />
    </div>
  );
}

function LeadDetail({ lead, onConvert }: { lead: Lead; onConvert: () => void }) {
  const hasDados = !!lead.dados_diagnostico;
  let dre: any = null;
  if (hasDados) {
    try { dre = calcularDRE(lead.dados_diagnostico as DiagnosticoInputs); } catch {}
  }

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle>{lead.nome_empresa}</SheetTitle>
      </SheetHeader>
      <div className="flex items-center gap-2">
        {lead.segmento && <Badge variant="secondary">{lead.segmento}</Badge>}
        <span className="text-xs text-txt-muted">{new Date(lead.created_at).toLocaleDateString('pt-BR')}</span>
      </div>

      {lead.score != null && (
        <div className="flex justify-center">
          <ScoreRing score={lead.score} size={100} />
        </div>
      )}

      {dre && (
        <>
          <div className="rounded-lg p-4" style={{ border: '1px solid hsl(var(--border))' }}>
            <p className="text-xs font-semibold text-txt-muted mb-2">DRE Resumida</p>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between"><span>Faturamento</span><span className="font-mono-data">{fmtBRL(dre.faturamento)}</span></div>
              <div className="flex justify-between font-semibold" style={{ color: dre.mc_pct >= 40 ? '#00A86B' : '#D97706' }}>
                <span>MC</span><span className="font-mono-data">{fmtBRL(dre.margem_contribuicao)} ({fmtPct(dre.mc_pct)})</span>
              </div>
              <div className="flex justify-between"><span>Lucro Op.</span><span className="font-mono-data">{fmtBRL(dre.lucro_operacional)}</span></div>
              <div className="flex justify-between font-semibold" style={{ color: dre.gc_pct >= 10 ? '#00A86B' : '#DC2626' }}>
                <span>Geração Caixa</span><span className="font-mono-data">{fmtBRL(dre.geracao_caixa)} ({fmtPct(dre.gc_pct)})</span>
              </div>
            </div>
          </div>
          {dre.penalidades.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-txt-muted mb-1">Pontos Críticos</p>
              <ul className="space-y-1">
                {dre.penalidades.map((p: string, i: number) => (
                  <li key={i} className="text-xs text-txt flex items-start gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full mt-1 shrink-0" style={{ background: '#DC2626' }} />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      <Button className="w-full" onClick={onConvert}>Converter em cliente</Button>
    </div>
  );
}
