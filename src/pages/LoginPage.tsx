import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useEffect } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { session, profile } = useAuth();

  useEffect(() => {
    if (session && profile) {
      if (profile.role === 'cliente') {
        navigate('/minha-area', { replace: true });
      } else {
        navigate('/dashboard', { replace: true });
      }
    }
  }, [session, profile, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError('E-mail ou senha incorretos. Tente novamente.');
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm space-y-8 rounded-xl border border-border bg-surface p-8 shadow-lg shadow-primary-md">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-20 items-center justify-center rounded-full bg-txt">
            <span className="text-lg font-bold text-primary-foreground tracking-wider">GPI</span>
          </div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.2em] text-txt-muted">
            Inteligência Financeira
          </p>
        </div>

        <form onSubmit={handleLogin} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-txt-sec text-sm font-medium">E-mail</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              required
              className="bg-surface-hi border-border"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-txt-sec text-sm font-medium">Senha</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              className="bg-surface-hi border-border"
            />
          </div>

          {error && (
            <p className="text-sm text-red font-medium">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  );
}
