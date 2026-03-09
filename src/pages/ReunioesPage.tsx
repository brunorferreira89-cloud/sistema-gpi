import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CalendarCheck, Plus, FileText, Video, MapPin, Pencil, X, Users2 } from 'lucide-react';
import { segmentColors, segmentLabels } from '@/lib/clientes-utils';
import { toast } from '@/hooks/use-toast';
import { ReuniaoDialog } from '@/components/reunioes/ReuniaoDialog';
import { AtaSheet } from '@/components/reunioes/AtaSheet';
import { useNavigate } from 'react-router-dom';

const statusBadge: Record<string, { className: string; label: string }> = {
  agendada: { className: 'border-amber/30 bg-amber/10 text-amber', label: 'Agendada' },
  realizada: { className: 'border-green/30 bg-green/10 text-green', label: 'Realizada' },
  cancelada: { className: 'border-muted bg-muted/50 text-txt-muted', label: 'Cancelada' },
};

export default function ReunioesPage() {
  const [tab, setTab] = useState('individuais');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editReuniao, setEditReuniao] = useState<any>(null);
  const [ataReuniao, setAtaReuniao] = useState<any>(null);
  const [filtroCliente, setFiltroCliente] = useState('todos');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: clientes } = useQuery({
    queryKey: ['clientes-ativos'],
    queryFn: async () => {
      const { data } = await supabase.from('clientes').select('id, nome_empresa, segmento').eq('status', 'ativo').order('nome_empresa');
      return data || [];
    },
  });

  const { data: reunioes, isLoading } = useQuery({
    queryKey: ['reunioes'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('reunioes' as any)
        .select('*')
        .order('data_reuniao', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('reunioes' as any).update({ status: 'cancelada' } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reunioes'] });
      toast({ title: 'Reunião cancelada.' });
    },
  });

  const getClienteNome = (id: string) => clientes?.find((c) => c.id === id)?.nome_empresa || '—';
  const getClienteSegmento = (id: string) => clientes?.find((c) => c.id === id)?.segmento || 'outro';

  const filterReunioes = (tipo: string) => {
    if (!reunioes) return [];
    let filtered = reunioes.filter((r: any) => r.tipo === tipo);
    if (tipo === 'individual') {
      if (filtroCliente !== 'todos') filtered = filtered.filter((r: any) => r.cliente_id === filtroCliente);
      if (filtroStatus !== 'todos') filtered = filtered.filter((r: any) => r.status === filtroStatus);
    }
    return filtered;
  };

  // Group by month
  const groupByMonth = (items: any[]) => {
    const groups: Record<string, any[]> = {};
    items.forEach((r) => {
      const d = new Date(r.data_reuniao + 'T00:00:00');
      const key = d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    });
    return Object.entries(groups);
  };

  const fmtDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const weekday = d.toLocaleDateString('pt-BR', { weekday: 'long' });
    const day = d.getDate();
    const month = d.toLocaleDateString('pt-BR', { month: 'long' });
    return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${day} de ${month}`;
  };

  const fmtTime = (t: string | null) => {
    if (!t) return '';
    return ` · ${t.slice(0, 5).replace(':', 'h')}`;
  };

  const [expandedAta, setExpandedAta] = useState<string | null>(null);

  const renderReuniaoCard = (r: any) => {
    const st = statusBadge[r.status] || statusBadge.agendada;
    const seg = r.cliente_id ? getClienteSegmento(r.cliente_id) : null;
    const segColor = seg ? segmentColors[seg] || segmentColors.outro : null;

    return (
      <div key={r.id} className="group rounded-xl border border-border bg-surface p-4 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-txt">{fmtDate(r.data_reuniao)}{fmtTime(r.horario)}</span>
            {r.cliente_id && (
              <Badge variant="outline" className={`text-xs ${segColor?.bg} ${segColor?.text}`}>
                {getClienteNome(r.cliente_id)}
              </Badge>
            )}
            {r.tipo === 'coletiva' && (
              <Badge variant="outline" className="text-xs border-primary/30 bg-primary-lo text-primary">
                Reunião Coletiva
              </Badge>
            )}
            <Badge variant="outline" className={`text-xs ${r.formato === 'video' ? 'text-[#9333EA]' : 'text-primary'}`}>
              {r.formato === 'video' ? <Video className="h-3 w-3 mr-1" /> : <MapPin className="h-3 w-3 mr-1" />}
              {r.formato === 'video' ? 'Vídeo' : 'Presencial'}
            </Badge>
            <Badge variant="outline" className={`text-xs ${st.className}`}>{st.label}</Badge>
          </div>

          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            {r.status === 'agendada' && (
              <>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditReuniao(r); setDialogOpen(true); }}>
                  <Pencil className="h-3 w-3 mr-1" /> Editar
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setAtaReuniao(r)}>
                  <FileText className="h-3 w-3 mr-1" /> Registrar ata
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs text-red" onClick={() => cancelMutation.mutate(r.id)}>
                  <X className="h-3 w-3 mr-1" /> Cancelar
                </Button>
              </>
            )}
            {r.status === 'realizada' && r.ata && (
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setExpandedAta(expandedAta === r.id ? null : r.id)}>
                <FileText className="h-3 w-3 mr-1" /> {expandedAta === r.id ? 'Fechar ata' : 'Ver ata'}
              </Button>
            )}
          </div>
        </div>

        <p className="text-xs text-txt-muted">{r.titulo}</p>

        {expandedAta === r.id && r.ata && (
          <div className="mt-2 rounded-lg bg-surface-hi p-3 text-sm text-txt whitespace-pre-wrap border border-border">
            {r.ata}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-txt">Reuniões</h1>
        <Button onClick={() => { setEditReuniao(null); setDialogOpen(true); }} className="gap-1.5">
          <Plus className="h-4 w-4" /> Agendar reunião
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="individuais">Individuais</TabsTrigger>
          <TabsTrigger value="coletivas">Coletivas</TabsTrigger>
        </TabsList>

        <TabsContent value="individuais" className="space-y-4">
          <div className="flex gap-3">
            <Select value={filtroCliente} onValueChange={setFiltroCliente}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos os clientes</SelectItem>
                {clientes?.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome_empresa}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filtroStatus} onValueChange={setFiltroStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="agendada">Agendada</SelectItem>
                <SelectItem value="realizada">Realizada</SelectItem>
                <SelectItem value="cancelada">Cancelada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            groupByMonth(filterReunioes('individual')).length === 0 ? (
              <div className="flex flex-col items-center py-16 text-txt-muted">
                <CalendarCheck className="mb-3 h-12 w-12 opacity-30" />
                <p>Nenhuma reunião individual encontrada</p>
              </div>
            ) : (
              groupByMonth(filterReunioes('individual')).map(([month, items]) => (
                <div key={month} className="space-y-2">
                  <h3 className="text-sm font-semibold text-txt-sec capitalize">{month}</h3>
                  {items.map(renderReuniaoCard)}
                </div>
              ))
            )
          )}
        </TabsContent>

        <TabsContent value="coletivas" className="space-y-4">
          {isLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : (
            groupByMonth(filterReunioes('coletiva')).length === 0 ? (
              <div className="flex flex-col items-center py-16 text-txt-muted">
                <CalendarCheck className="mb-3 h-12 w-12 opacity-30" />
                <p>Nenhuma reunião coletiva encontrada</p>
              </div>
            ) : (
              groupByMonth(filterReunioes('coletiva')).map(([month, items]) => (
                <div key={month} className="space-y-2">
                  <h3 className="text-sm font-semibold text-txt-sec capitalize">{month}</h3>
                  {items.map(renderReuniaoCard)}
                </div>
              ))
            )
          )}
        </TabsContent>
      </Tabs>

      <ReuniaoDialog
        open={dialogOpen}
        onOpenChange={(v) => { setDialogOpen(v); if (!v) setEditReuniao(null); }}
        reuniao={editReuniao}
      />

      {ataReuniao && (
        <AtaSheet
          open={!!ataReuniao}
          onOpenChange={(v) => { if (!v) setAtaReuniao(null); }}
          reuniao={ataReuniao}
        />
      )}
    </div>
  );
}
