import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import LoginPage from "./pages/LoginPage";
import AppLayout from "./layouts/AppLayout";
import ClienteLayout from "./layouts/ClienteLayout";
import DashboardPage from "./pages/DashboardPage";
import ClientesPage from "./pages/ClientesPage";
import TorrePage from "./pages/TorrePage";
import KPIsPage from "./pages/KPIsPage";
import ReunioesPage from "./pages/ReunioesPage";
import OnboardingPage from "./pages/OnboardingPage";
import MinhaAreaPage from "./pages/MinhaAreaPage";
import PlanoDeContasPage from "./pages/PlanoDeContasPage";
import PlanoDeContasClientePage from "./pages/PlanoDeContasClientePage";
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
            <Route path="/" element={<RootRedirect />} />

            {/* Admin / Consultor routes */}
            <Route element={<ProtectedRoute allowedRoles={['admin', 'consultor']} />}>
              <Route element={<AppLayout />}>
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/clientes" element={<ClientesPage />} />
                <Route path="/torre-de-controle" element={<TorrePage />} />
                <Route path="/kpis" element={<KPIsPage />} />
                <Route path="/reunioes" element={<ReunioesPage />} />
                <Route path="/onboarding" element={<OnboardingPage />} />
                <Route path="/plano-de-contas" element={<PlanoDeContasPage />} />
                <Route path="/plano-de-contas/:clienteId" element={<PlanoDeContasClientePage />} />
              </Route>
            </Route>

            {/* Cliente routes */}
            <Route element={<ProtectedRoute allowedRoles={['cliente']} />}>
              <Route element={<ClienteLayout />}>
                <Route path="/minha-area" element={<MinhaAreaPage />} />
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
