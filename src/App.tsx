import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PortalRoute } from "@/components/PortalRoute";
import LoginPage from "./pages/LoginPage";
import AppLayout from "./layouts/AppLayout";
import ClienteLayout from "./layouts/ClienteLayout";
import PortalLayout from "./layouts/PortalLayout";
import DashboardPage from "./pages/DashboardPage";
import ClientesPage from "./pages/ClientesPage";
import ReunioesPage from "./pages/ReunioesPage";
import OnboardingPage from "./pages/OnboardingPage";
import MinhaAreaPage from "./pages/MinhaAreaPage";
import ClienteFichaPage from "./pages/ClienteFichaPage";
import KanbanPage from "./pages/KanbanPage";
import ReuniaoColetivaPrincipalPage from "./pages/ReuniaoColetivaPrincipalPage";
import ReuniaoColetivDetalhe from "./pages/ReuniaoColetivDetalhe";
import DiagnosticoPublicoPage from "./pages/DiagnosticoPublicoPage";
import DiagnosticoLeadsPage from "./pages/DiagnosticoLeadsPage";
import ClientePortalPage from "./pages/ClientePortalPage";
import ApresentacaoPage from "./pages/ApresentacaoPage";

import UsuariosPortalPage from "./pages/UsuariosPortalPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function RootRedirect() {
  const { session, profile, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (profile?.role === 'cliente') return <Navigate to="/minha-area" replace />;
  return <Navigate to="/dashboard" replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/diagnostico/publico" element={<DiagnosticoPublicoPage />} />
            <Route path="/" element={<RootRedirect />} />

            {/* Admin / Consultor routes */}
            <Route element={<ProtectedRoute allowedRoles={['admin', 'consultor']} />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/clientes" element={<ClientesPage />} />
                <Route path="/clientes/:clienteId" element={<ClienteFichaPage />} />
                <Route path="/kanban" element={<KanbanPage />} />
                <Route path="/reunioes" element={<ReunioesPage />} />
                <Route path="/reuniao-coletiva" element={<ReuniaoColetivaPrincipalPage />} />
                <Route path="/reuniao-coletiva/:id" element={<ReuniaoColetivDetalhe />} />
                <Route path="/diagnostico" element={<DiagnosticoLeadsPage />} />
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route path="/apresentacao/:clienteId" element={<ApresentacaoPage />} />
                <Route path="/usuarios-portal" element={<UsuariosPortalPage />} />
                
              </Route>
            </Route>

            {/* Cliente routes */}
            <Route element={<ProtectedRoute allowedRoles={['cliente']} />}>
              <Route element={<ClienteLayout />}>
                <Route path="/minha-area" element={<MinhaAreaPage />} />
              </Route>
            </Route>

            {/* Portal do Cliente (requires portal_ativo) */}
            <Route element={<PortalRoute />}>
              <Route element={<PortalLayout />}>
                <Route path="/cliente" element={<ClientePortalPage />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
