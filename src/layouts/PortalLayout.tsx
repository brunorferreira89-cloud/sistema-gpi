import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { LogOut, LayoutDashboard, FileText, Users, User } from 'lucide-react';
import gpiLogo from '@/assets/gpi-logo-dark.png';

const navItems = [
  { label: 'Início', icon: LayoutDashboard, path: '/cliente', enabled: true },
  { label: 'Relatórios', icon: FileText, path: '#', enabled: false },
  { label: 'Reuniões', icon: Users, path: '#', enabled: false },
  { label: 'Minha Área', icon: User, path: '/minha-area', enabled: true },
];

export default function PortalLayout() {
  const { profile, signOut } = useAuth();
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-[#F0F4FA]">
      {/* Sidebar */}
      <aside className="sticky top-0 flex h-screen w-[72px] flex-col items-center border-r border-[#DDE4F0] bg-white py-5 gap-6">
        <img src={gpiLogo} alt="GPI" className="h-8 w-auto object-contain mb-2" />
        <nav className="flex flex-1 flex-col items-center gap-1">
          {navItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.label}
                onClick={() => item.enabled && item.path !== '#' && (window.location.href = item.path)}
                disabled={!item.enabled}
                className={`flex flex-col items-center gap-0.5 rounded-lg px-2 py-2 text-[10px] font-medium transition-colors w-[62px] ${
                  active
                    ? 'bg-[#EBF0FF] text-[#1A3CFF]'
                    : item.enabled
                    ? 'text-[#4A5E80] hover:bg-[#F0F4FA]'
                    : 'text-[#B0BEDC] cursor-not-allowed'
                }`}
              >
                <item.icon className="h-5 w-5" />
                <span>{item.label}</span>
                {!item.enabled && (
                  <span className="text-[7px] text-[#B0BEDC]">em breve</span>
                )}
              </button>
            );
          })}
        </nav>
        <button onClick={signOut} className="rounded-md p-2 text-[#4A5E80] hover:text-[#DC2626] transition-colors">
          <LogOut className="h-5 w-5" />
        </button>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <main className="flex-1 p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
