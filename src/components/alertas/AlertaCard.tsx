import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Eye, Send } from 'lucide-react';

interface AlertaCardProps {
  alerta: any;
  clienteId: string;
  profileName: (id: string) => string;
  onMarcarEnviado: () => void;
  onEdit: () => void;
}

export function AlertaCard({ alerta, profileName, onMarcarEnviado, onEdit }: AlertaCardProps) {
  const inicio = new Date(alerta.semana_inicio + 'T00:00:00');
  const fim = new Date(alerta.semana_fim + 'T00:00:00');
  const fmtDate = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const fmtDateFull = (d: Date) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const conteudo = alerta.conteudo as any;
  const indicadores = conteudo?.indicadores || [];

  return (
    <div className="rounded-xl border border-border bg-surface p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-txt">
            Semana de {fmtDate(inicio)} a {fmtDateFull(fim)}
          </h3>
          <Badge
            variant="outline"
            className={alerta.status === 'enviado'
              ? 'border-green/30 bg-green/10 text-green'
              : 'border-amber/30 bg-amber/10 text-amber'}
          >
            {alerta.status === 'enviado' ? 'Enviado' : 'Rascunho'}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={onEdit}>
            <Eye className="h-3.5 w-3.5" /> Ver / Editar
          </Button>
          {alerta.status === 'rascunho' && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onMarcarEnviado}>
              <Send className="h-3.5 w-3.5" /> Marcar como enviado
            </Button>
          )}
        </div>
      </div>

      {alerta.status === 'enviado' && alerta.enviado_em && (
        <p className="text-xs text-txt-muted">
          Enviado em {new Date(alerta.enviado_em).toLocaleDateString('pt-BR')} às{' '}
          {new Date(alerta.enviado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}{' '}
          por {profileName(alerta.enviado_por)}
        </p>
      )}

      {indicadores.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {indicadores.map((ind: any, i: number) => (
            <Badge key={i} variant="secondary" className="text-xs font-normal">
              {ind.nome}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
