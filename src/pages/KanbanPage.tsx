import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { DndContext, DragOverlay, closestCorners, PointerSensor, useSensor, useSensors, type DragStartEvent, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useDroppable } from '@dnd-kit/core';
import { Plus, ChevronLeft, ChevronRight, MoreVertical, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { TarefaDialog } from '@/components/kanban/TarefaDialog';
import { ClienteSheet } from '@/components/kanban/ClienteSheet';
import { segmentColors, segmentLabels } from '@/lib/clientes-utils';
import { todayDiaUtil, nextDiaUtil, formatDateBR, toDateString, isSextaFeira } from '@/lib/kanban-utils';
import { toast } from '@/hooks/use-toast';

const COLUMNS = [
  { id: 'pendente', label: 'Pendente', border: 'border-amber', headerBg: 'bg-amber/5', headerText: 'text-amber' },
  { id: 'em_andamento', label: 'Em Andamento', border: 'border-primary', headerBg: 'bg-primary-lo', headerText: 'text-primary' },
  { id: 'concluido', label: 'Concluído', border: 'border-green', headerBg: 'bg-green/5', headerText: 'text-green' },
  { id: 'bloqueado', label: 'Bloqueado', border: 'border-red', headerBg: 'bg-red/5', headerText: 'text-red' },
];

const TIPO_BADGES: Record<string, { label: string; cls: string }> = {
  auditoria_diaria: { label: 'Auditoria', cls: 'bg-primary-lo text-primary' },
  alerta_semanal: { label: 'Alerta', cls: 'bg-[#FDF4FF] text-[#9333EA]' },
  suporte: { label: 'Suporte', cls: 'bg-[hsl(199,100%,45%,0.1)] text-cyan' },
  reuniao: { label: 'Reunião', cls: 'bg-green/10 text-green' },
  outro: { label: 'Outro', cls: 'bg-muted text-txt-muted' },
};

const PRIORIDADE_BAR: Record<string, string> = {
  normal: 'bg-muted',
  alta: 'bg-amber',
  critica: 'bg-red animate-pulse',
};

export default function KanbanPage() {
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(todayDiaUtil);
  const dateStr = toDateString(selectedDate);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTarefa, setEditingTarefa] = useState<any>(null);
  const [sheetClienteId, setSheetClienteId] = useState<string | null>(null);
  const [filtroResponsavel, setFiltroResponsavel] = useState('todos');
  const [filtroTipo, setFiltroTipo] = useState('todos');
  const [filtroPrioridade, setFiltroPrioridade] = useState('todos');
  const [activeDragId, setActiveDragId] = useState<string | null>(null);

  // Queries
  const { data: clientes = [] } = useQuery({
    queryKey: ['clientes-ativos-kanban'],
    queryFn: async () => {
      const { data, error } = await supabase.from('clientes').select('id, nome_empresa, segmento, status');
      if (error) throw error;
      return data;
    },
  });

  const { data: analistas = [] } = useQuery({
    queryKey: ['analistas'],
    queryFn: async () => {
      const { data, error } = await supabase.from('profiles').select('id, nome, role').in('role', ['admin', 'consultor']);
      if (error) throw error;
      return data;
    },
  });

  const { data: tarefas = [], isLoading } = useQuery({
    queryKey: ['tarefas', dateStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tarefas_operacionais' as any)
        .select('*')
        .eq('data_tarefa', dateStr)
        .order('created_at');
      if (error) throw error;
      return data as any[];
    },
  });

  // Auto-generate tasks
  useEffect(() => {
    if (isLoading || !clientes.length) return;
    const clientesAtivos = clientes.filter((c) => c.status === 'ativo');
    if (!clientesAtivos.length) return;

    const auditorias = tarefas.filter((t: any) => t.tipo === 'auditoria_diaria');
    const alertas = tarefas.filter((t: any) => t.tipo === 'alerta_semanal');

    const generate = async () => {
      const toInsert: any[] = [];

      if (auditorias.length === 0) {
        clientesAtivos.forEach((c) => {
          toInsert.push({
            cliente_id: c.id,
            tipo: 'auditoria_diaria',
            titulo: `Auditoria — ${c.razao_social || c.nome_empresa}`,
            status: 'pendente',
            prioridade: 'normal',
            data_tarefa: dateStr,
          });
        });
      }

      if (isSextaFeira(selectedDate) && alertas.length === 0) {
        clientesAtivos.forEach((c) => {
          toInsert.push({
            cliente_id: c.id,
            tipo: 'alerta_semanal',
            titulo: `Alerta Semanal — ${c.nome_empresa}`,
            status: 'pendente',
            prioridade: 'alta',
            data_tarefa: dateStr,
          });
        });
      }

      if (toInsert.length) {
        await supabase.from('tarefas_operacionais' as any).insert(toInsert);
        queryClient.invalidateQueries({ queryKey: ['tarefas', dateStr] });
        toast({ title: `${toInsert.length} tarefas geradas automaticamente para hoje.` });
      }
    };

    generate();
  }, [isLoading, clientes, dateStr, tarefas.length]);

  // Filtered tarefas
  const filtered = useMemo(() => tarefas.filter((t: any) => {
    if (filtroResponsavel !== 'todos' && t.responsavel_id !== filtroResponsavel) return false;
    if (filtroTipo !== 'todos' && t.tipo !== filtroTipo) return false;
    if (filtroPrioridade !== 'todos' && t.prioridade !== filtroPrioridade) return false;
    return true;
  }), [tarefas, filtroResponsavel, filtroTipo, filtroPrioridade]);

  const clienteMap = useMemo(() => {
    const m: Record<string, any> = {};
    clientes.forEach((c) => { m[c.id] = c; });
    return m;
  }, [clientes]);

  const analistaMap = useMemo(() => {
    const m: Record<string, any> = {};
    analistas.forEach((a) => { m[a.id] = a; });
    return m;
  }, [analistas]);

  // DnD
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const handleDragStart = (event: DragStartEvent) => setActiveDragId(event.active.id as string);

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = event;
    if (!over) return;
    const tarefa = filtered.find((t: any) => t.id === active.id);
    if (!tarefa) return;

    const newStatus = over.id as string;
    if (!COLUMNS.find((c) => c.id === newStatus) || tarefa.status === newStatus) return;

    const updates: any = { status: newStatus };
    if (newStatus === 'concluido') updates.concluido_em = new Date().toISOString();
    else updates.concluido_em = null;

    await supabase.from('tarefas_operacionais' as any).update(updates).eq('id', tarefa.id);
    queryClient.invalidateQueries({ queryKey: ['tarefas', dateStr] });
  };

  const handleDelete = async (id: string) => {
    await supabase.from('tarefas_operacionais' as any).delete().eq('id', id);
    queryClient.invalidateQueries({ queryKey: ['tarefas', dateStr] });
    toast({ title: 'Tarefa excluída' });
  };

  const pendentes = filtered.filter((t: any) => t.status === 'pendente').length;

  // Productivity stats
  const totalTarefas = filtered.length;
  const concluidas = filtered.filter((t: any) => t.status === 'concluido').length;
  const auditoriasTotal = filtered.filter((t: any) => t.tipo === 'auditoria_diaria').length;
  const auditoriasConcluidas = filtered.filter((t: any) => t.tipo === 'auditoria_diaria' && t.status === 'concluido').length;
  const alertasTotal = filtered.filter((t: any) => t.tipo === 'alerta_semanal').length;
  const alertasConcluidas = filtered.filter((t: any) => t.tipo === 'alerta_semanal' && t.status === 'concluido').length;
  const taxaConclusao = totalTarefas ? Math.round((concluidas / totalTarefas) * 100) : 0;
  const taxaColor = taxaConclusao >= 80 ? 'text-green' : taxaConclusao >= 50 ? 'text-amber' : 'text-red';

  const activeTarefa = activeDragId ? filtered.find((t: any) => t.id === activeDragId) : null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="space-y-4 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-txt">Kanban Operacional</h2>
            <div className="flex items-center gap-2 mt-1">
              <button onClick={() => setSelectedDate(nextDiaUtil(selectedDate, -1))} className="rounded-md p-1 hover:bg-surface-hi"><ChevronLeft className="h-4 w-4 text-txt-muted" /></button>
              <span className="text-sm text-txt-sec capitalize">{formatDateBR(selectedDate)}</span>
              <button onClick={() => setSelectedDate(nextDiaUtil(selectedDate, 1))} className="rounded-md p-1 hover:bg-surface-hi"><ChevronRight className="h-4 w-4 text-txt-muted" /></button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-amber/10 px-3 py-1 text-xs font-medium text-amber">{pendentes} pendentes</span>
            <Button onClick={() => { setEditingTarefa(null); setDialogOpen(true); }}>
              <Plus className="mr-1.5 h-4 w-4" /> Nova tarefa
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-3">
          <Select value={filtroResponsavel} onValueChange={setFiltroResponsavel}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos analistas</SelectItem>
              {analistas.map((a) => <SelectItem key={a.id} value={a.id}>{a.nome || 'Sem nome'}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filtroTipo} onValueChange={setFiltroTipo}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos os tipos</SelectItem>
              <SelectItem value="auditoria_diaria">Auditoria Diária</SelectItem>
              <SelectItem value="alerta_semanal">Alerta Semanal</SelectItem>
              <SelectItem value="suporte">Suporte</SelectItem>
              <SelectItem value="reuniao">Reunião</SelectItem>
              <SelectItem value="outro">Outro</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filtroPrioridade} onValueChange={setFiltroPrioridade}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas prioridades</SelectItem>
              <SelectItem value="normal">Normal</SelectItem>
              <SelectItem value="alta">Alta</SelectItem>
              <SelectItem value="critica">Crítica</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Kanban Board */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="grid flex-1 grid-cols-4 gap-4 overflow-hidden">
          {COLUMNS.map((col) => {
            const colTarefas = filtered.filter((t: any) => t.status === col.id);
            return (
              <KanbanColumn key={col.id} col={col} tarefas={colTarefas} clienteMap={clienteMap} analistaMap={analistaMap}
                onEdit={(t) => { setEditingTarefa(t); setDialogOpen(true); }}
                onDelete={handleDelete}
                onClienteClick={setSheetClienteId}
              />
            );
          })}
        </div>
        <DragOverlay>
          {activeTarefa ? (
            <TarefaCardContent tarefa={activeTarefa} cliente={clienteMap[activeTarefa.cliente_id]} analista={analistaMap[activeTarefa.responsavel_id]} />
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Productivity bar */}
      <div className="mt-4 flex items-center gap-6 rounded-xl border border-border bg-surface px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-txt-sec">{auditoriasConcluidas} de {auditoriasTotal} auditorias</span>
          <Progress value={auditoriasTotal ? (auditoriasConcluidas / auditoriasTotal) * 100 : 0} className="h-1.5 w-24" />
        </div>
        {alertasTotal > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-txt-sec">{alertasConcluidas} de {alertasTotal} alertas</span>
            <Progress value={(alertasConcluidas / alertasTotal) * 100} className="h-1.5 w-24" />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-txt-sec">Taxa de conclusão:</span>
          <span className={`text-sm font-bold ${taxaColor}`}>{taxaConclusao}%</span>
          <Progress value={taxaConclusao} className="h-1.5 w-24" />
        </div>
      </div>

      <TarefaDialog
        open={dialogOpen} onOpenChange={setDialogOpen} tarefa={editingTarefa}
        clientes={clientes.filter((c) => c.status === 'ativo').map((c) => ({ id: c.id, nome_empresa: c.nome_empresa }))}
        analistas={analistas.map((a) => ({ id: a.id, nome: a.nome }))}
        defaultDate={selectedDate} onSaved={() => queryClient.invalidateQueries({ queryKey: ['tarefas', dateStr] })}
      />
      <ClienteSheet clienteId={sheetClienteId} open={!!sheetClienteId} onOpenChange={(o) => { if (!o) setSheetClienteId(null); }} />
    </div>
  );
}

// Droppable Column
function KanbanColumn({ col, tarefas, clienteMap, analistaMap, onEdit, onDelete, onClienteClick }: {
  col: typeof COLUMNS[number];
  tarefas: any[];
  clienteMap: Record<string, any>;
  analistaMap: Record<string, any>;
  onEdit: (t: any) => void;
  onDelete: (id: string) => void;
  onClienteClick: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });

  return (
    <div ref={setNodeRef} className={`flex flex-col rounded-xl border-2 ${col.border} ${isOver ? 'ring-2 ring-primary/30' : ''} bg-background overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-2.5 ${col.headerBg}`}>
        <span className={`text-xs font-bold uppercase tracking-wide ${col.headerText}`}>{col.label}</span>
        <span className={`rounded-full bg-background px-2 py-0.5 text-[10px] font-semibold ${col.headerText}`}>{tarefas.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        <SortableContext items={tarefas.map((t: any) => t.id)} strategy={verticalListSortingStrategy}>
          {tarefas.map((t: any) => (
            <SortableTarefaCard key={t.id} tarefa={t} cliente={clienteMap[t.cliente_id]} analista={analistaMap[t.responsavel_id]}
              onEdit={() => onEdit(t)} onDelete={() => onDelete(t.id)} onClienteClick={() => onClienteClick(t.cliente_id)} />
          ))}
        </SortableContext>
        {tarefas.length === 0 && (
          <p className="py-8 text-center text-xs text-txt-muted">Nenhuma tarefa</p>
        )}
      </div>
    </div>
  );
}

// Sortable Card
function SortableTarefaCard({ tarefa, cliente, analista, onEdit, onDelete, onClienteClick }: {
  tarefa: any; cliente: any; analista: any; onEdit: () => void; onDelete: () => void; onClienteClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tarefa.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <div className="group relative">
        <TarefaCardContent tarefa={tarefa} cliente={cliente} analista={analista} />
        {/* Actions overlay on hover */}
        <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded-md bg-surface p-1 shadow-sm hover:bg-surface-hi"><MoreVertical className="h-3.5 w-3.5 text-txt-muted" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>Editar</DropdownMenuItem>
              <DropdownMenuItem onClick={onDelete} className="text-red">Excluir</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Clickable client name */}
        {cliente && (
          <button onClick={(e) => { e.stopPropagation(); onClienteClick(); }}
            className="absolute left-7 top-2.5 z-10" title="Ver cliente">
            {/* transparent overlay on the badge area — handled by the card render */}
          </button>
        )}
      </div>
    </div>
  );
}

// Card content (used in both card and drag overlay)
function TarefaCardContent({ tarefa, cliente, analista }: { tarefa: any; cliente?: any; analista?: any }) {
  const seg = cliente ? (segmentColors[cliente.segmento] || segmentColors.outro) : null;
  const tipo = TIPO_BADGES[tarefa.tipo] || TIPO_BADGES.outro;
  const prioBar = PRIORIDADE_BAR[tarefa.prioridade] || PRIORIDADE_BAR.normal;

  return (
    <div className="flex overflow-hidden rounded-lg border border-border bg-surface shadow-sm">
      <div className={`w-1 shrink-0 ${prioBar}`} />
      <div className="flex-1 p-3 space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {seg && (
            <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${seg.bg} ${seg.text}`}>
              {cliente.nome_empresa}
            </span>
          )}
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${tipo.cls}`}>{tipo.label}</span>
        </div>
        <p className="text-sm font-medium text-txt leading-tight">{tarefa.titulo}</p>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {analista && (
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary-lo text-[9px] font-bold text-primary">
                {analista.nome?.charAt(0)?.toUpperCase() || '?'}
              </div>
            )}
            {tarefa.observacao && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <MessageSquare className="h-3.5 w-3.5 text-txt-muted" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">{tarefa.observacao}</TooltipContent>
              </Tooltip>
            )}
          </div>
          {tarefa.status === 'concluido' && tarefa.concluido_em && (
            <span className="text-[9px] text-txt-muted">
              Concluído às {new Date(tarefa.concluido_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h')}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
