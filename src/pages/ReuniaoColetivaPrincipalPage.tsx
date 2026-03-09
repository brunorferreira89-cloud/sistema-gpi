import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Plus, CalendarCheck, FileText, Users2, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { NovaEdicaoDialog } from '@/components/reuniao-coletiva/NovaEdicaoDialog';

const statusBadge: Record<string, { className: string; label: string }> = {
  planejando: { className: 'border-amber/30 bg-amber/10 text-amber', label: 'Planejando' },
  pronta: { className: 'border-green/30 bg-green/10 text-green', label: 'Pronta' },
  realizada: { className: 'border-green/30 bg-green/10 text-green', label: 'Realizada' },
  cancelada: { className: 'border-muted bg-muted/50 text-txt-muted', label: 'Cancelada' },
};

export default function ReuniaoColetivaPrincipalPage() {
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: reunioes, isLoading } = useQuery({
    queryKey: ['reunioes-coletivas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reunioes_coletivas' as any)
        .select('*')
        .order('data_reuniao', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const proxima = reunioes?.find((r: any) => r.status === 'planejando' || r.status === 'pronta');
  const historico = reunioes?.filter((r: any) => r.status === 'realizada' || r.status === 'cancelada') || [];

  const diasRestantes = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    return Math.ceil((d.getTime() - hoje.getTime()) / 86400000);
  };

  const fmtDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const groupBySemester = (items: any[]) => {
    const groups: Record<string, any[]> = {};
    items.forEach((r) => {
      const d = new Date(r.data_reuniao + 'T00:00:00');
      const sem = d.getMonth() < 6 ? '1º' : '2º';
      const key = `${sem} Semestre ${d.getFullYear()}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    return Object.entries(groups);
  };

  const [expandedAta, setExpandedAta] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-txt">Reunião Coletiva Mensal</h1>
          <p className="text-sm text-txt-muted mt-1">Superentrega GPI · Conduzida por Lula Fylho · Dias 15–20 de cada mês</p>
        </div>
        <Button onClick={() => setDialogOpen(true)} className="gap-1.5">
          <Plus className="h-4 w-4" /> Planejar nova edição
        </Button>
      </div>

      {/* Próxima edição */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      ) : proxima ? (
        <Card className="border-primary/40 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary to-primary/30" />
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Users2 className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-txt">{proxima.titulo}</h2>
                <Badge variant="outline" className={statusBadge[proxima.status]?.className}>
                  {statusBadge[proxima.status]?.label}
                </Badge>
              </div>
              {diasRestantes(proxima.data_reuniao) > 0 && (
                <Badge variant="outline" className="text-xs border-primary/30 bg-primary-lo text-primary">
                  Faltam {diasRestantes(proxima.data_reuniao)} dias
                </Badge>
              )}
            </div>
            <p className="text-sm text-txt-sec">{fmtDate(proxima.data_reuniao)}</p>
            {proxima.tema_principal && (
              <p className="text-sm text-txt-muted">Tema: {proxima.tema_principal}</p>
            )}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={() => navigate(`/reuniao-coletiva/${proxima.id}`)}>
                Preparar material
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate(`/reuniao-coletiva/${proxima.id}?tab=roteiro`)}>
                Ver roteiro completo
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center py-12 text-txt-muted">
            <CalendarCheck className="mb-3 h-12 w-12 opacity-30" />
            <p>Nenhuma edição planejada</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setDialogOpen(true)}>
              <Plus className="h-3 w-3 mr-1" /> Planejar próxima edição
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Histórico */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-txt">Histórico de edições</h2>
        {historico.length === 0 ? (
          <p className="text-sm text-txt-muted py-6 text-center">Nenhuma edição anterior registrada.</p>
        ) : (
          groupBySemester(historico).map(([sem, items]) => (
            <div key={sem} className="space-y-2">
              <h3 className="text-sm font-semibold text-txt-sec capitalize">{sem}</h3>
              {items.map((r: any) => {
                const st = statusBadge[r.status] || statusBadge.planejando;
                return (
                  <div key={r.id} className="group rounded-xl border border-border bg-surface p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-txt">{r.titulo}</span>
                        <Badge variant="outline" className={`text-xs ${st.className}`}>{st.label}</Badge>
                        {r.participantes_confirmados > 0 && (
                          <Badge variant="outline" className="text-xs">
                            <Users2 className="h-3 w-3 mr-1" /> {r.participantes_confirmados} participantes
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        {r.status === 'realizada' && r.ata && (
                          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpandedAta(expandedAta === r.id ? null : r.id)}>
                            <FileText className="h-3 w-3 mr-1" /> {expandedAta === r.id ? 'Fechar ata' : 'Ver ata'}
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate(`/reuniao-coletiva/${r.id}`)}>
                          Ver detalhes <ChevronRight className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                    </div>
                    <p className="text-xs text-txt-muted">{fmtDate(r.data_reuniao)}</p>
                    {r.tema_principal && <p className="text-xs text-txt-sec">Tema: {r.tema_principal}</p>}
                    {expandedAta === r.id && r.ata && (
                      <div className="mt-2 rounded-lg bg-surface-hi p-3 text-sm text-txt whitespace-pre-wrap border border-border">
                        {r.ata}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <NovaEdicaoDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}
