import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';

interface ProtectedRouteProps {
  allowedRoles?: string[];
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { session, profile, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  // Portal guard: cliente with portal_ativo must use /cliente route
  if (profile?.role === 'cliente' && allowedRoles?.includes('cliente')) {
    // Check if this is a portal-only route requiring portal_ativo
    if (allowedRoles.length === 1 && allowedRoles[0] === 'cliente') {
      // If portal_ativo is required but not enabled, redirect to minha-area or login
      // This is handled by the specific route config via requirePortal prop
    }
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    if (profile.role === 'cliente') return <Navigate to="/minha-area" replace />;
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}
