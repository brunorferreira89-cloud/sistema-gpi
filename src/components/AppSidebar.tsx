import { LayoutDashboard, Users, KanbanSquare, CalendarCheck, Users2, Stethoscope, ClipboardList, LogOut } from 'lucide-react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import gpiLogo from '@/assets/gpi-logo-dark.png';

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', to: '/dashboard' },
  { icon: Users, label: 'Clientes', to: '/clientes' },
  { icon: KanbanSquare, label: 'Kanban', to: '/kanban' },
  { icon: CalendarCheck, label: 'Reuniões', to: '/reunioes' },
  { icon: Users2, label: 'Reunião Coletiva', to: '/reuniao-coletiva' },
  { icon: Stethoscope, label: 'Diagnósticos', to: '/diagnostico' },
  { icon: ClipboardList, label: 'Onboarding', to: '/onboarding' },
  { icon: UserCog, label: 'Usuários', to: '/usuarios' },
  
];

export function AppSidebar() {
  const { profile, signOut } = useAuth();
  const location = useLocation();

  const initial = profile?.nome?.charAt(0)?.toUpperCase() || 'U';

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-border bg-surface">
      {/* Logo */}
      <div className="flex flex-col items-center gap-1.5 px-4 py-6">
        <img src={gpiLogo} alt="GPI" className="h-10 w-auto object-contain" />
        <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-txt-muted">
          Inteligência Financeira
        </span>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-3">
        {navItems.map((item) => {
          const active = location.pathname === item.to;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                active
                  ? 'border-l-2 border-primary bg-primary-lo text-primary'
                  : 'border-l-2 border-transparent text-txt-sec hover:bg-surface-hi'
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span>{item.label}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-cyan text-sm font-bold text-primary-foreground">
              {initial}
            </div>
            <div className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface bg-green" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-medium text-txt">{profile?.nome || 'Usuário'}</p>
            <p className="text-xs capitalize text-txt-muted">{profile?.role || '...'}</p>
          </div>
          <button
            onClick={signOut}
            className="rounded-md p-1.5 text-txt-muted transition-colors hover:bg-surface-hi hover:text-red"
            title="Sair"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
