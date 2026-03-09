import { useLocation } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

const routeTitles: Record<string, { title: string; subtitle: string }> = {
  '/dashboard': { title: 'Dashboard', subtitle: 'Visão geral da consultoria' },
  '/clientes': { title: 'Clientes', subtitle: 'Gestão de clientes' },
  '/torre-de-controle': { title: 'Torre de Controle / DRE', subtitle: 'Análise financeira detalhada' },
  '/kpis': { title: 'KPIs', subtitle: 'Indicadores de performance' },
  '/reunioes': { title: 'Reuniões', subtitle: 'Agenda e histórico' },
  '/onboarding': { title: 'Onboarding', subtitle: 'Integração de novos clientes' },
  '/plano-de-contas': { title: 'Plano de Contas', subtitle: 'Estrutura DRE por cliente' },
};

export function AppTopbar() {
  const location = useLocation();
  const info = routeTitles[location.pathname] || { title: 'Página', subtitle: '' };
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-surface/[0.93] px-6 backdrop-blur-[12px]"
      style={{ boxShadow: '0 1px 8px 0 hsl(233 100% 55% / 0.04)' }}
    >
      <div className="flex items-center gap-3">
        <div className="h-8 w-[3px] rounded-full bg-primary" />
        <div>
          <h1 className="text-lg font-bold text-txt leading-tight">{info.title}</h1>
          <p className="text-xs text-txt-muted">{today} {info.subtitle && `· ${info.subtitle}`}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-surface-hi px-3 py-1.5">
          <div className="h-2 w-2 rounded-full bg-green" />
          <span className="text-xs font-medium text-txt-sec">Sistemas operacionais</span>
        </div>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          Novo Cliente
        </Button>
      </div>
    </header>
  );
}
