import { Outlet } from 'react-router-dom';

export default function PortalLayout() {
  return (
    <div className="min-h-screen" style={{ background: '#F0F4FA' }}>
      <main style={{ width: '100%' }}>
        <Outlet />
      </main>
    </div>
  );
}
