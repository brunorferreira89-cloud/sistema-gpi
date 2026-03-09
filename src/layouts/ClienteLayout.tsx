import { Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LogOut } from 'lucide-react';
import gpiLogo from '@/assets/gpi-logo.png';

export default function ClienteLayout() {
  const { profile, signOut } = useAuth();

  return (
    <div className="flex min-h-screen flex-col items-center bg-background">
      <header className="sticky top-0 z-30 flex w-full max-w-[430px] items-center justify-between border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <img src={gpiLogo} alt="GPI" className="h-8 w-auto object-contain" />
          <span className="text-sm font-semibold text-txt">{profile?.nome || 'Cliente'}</span>
        </div>
        <button onClick={signOut} className="rounded-md p-1.5 text-txt-muted hover:text-red">
          <LogOut className="h-4 w-4" />
        </button>
      </header>
      <main className="w-full max-w-[430px] flex-1 p-4">
        <Outlet />
      </main>
    </div>
  );
}
