
-- Create clientes table first (referenced by profiles)
CREATE TABLE public.clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_empresa TEXT NOT NULL,
  segmento TEXT NOT NULL CHECK (segmento IN ('alimentacao', 'saude', 'estetica', 'varejo', 'servicos', 'outro')),
  faturamento_faixa TEXT NOT NULL CHECK (faturamento_faixa IN ('faixa1', 'faixa2', 'faixa3', 'faixa4')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'onboarding')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome TEXT,
  role TEXT NOT NULL DEFAULT 'consultor' CHECK (role IN ('admin', 'consultor', 'cliente')),
  cliente_id UUID REFERENCES public.clientes(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Profiles RLS: user reads/updates own profile
CREATE POLICY "Users can read own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

-- Security definer function to get user role without recursion
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE id = _user_id;
$$;

-- Security definer function to get user cliente_id
CREATE OR REPLACE FUNCTION public.get_user_cliente_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT cliente_id FROM public.profiles WHERE id = _user_id;
$$;

-- Clientes RLS
CREATE POLICY "Admin and consultor can read all clientes"
  ON public.clientes FOR SELECT
  TO authenticated
  USING (
    public.get_user_role(auth.uid()) IN ('admin', 'consultor')
  );

CREATE POLICY "Cliente can read own cliente"
  ON public.clientes FOR SELECT
  TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'cliente'
    AND id = public.get_user_cliente_id(auth.uid())
  );

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, nome, role)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'nome', NEW.email), 'consultor');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Allow profiles insert for the trigger (service role)
CREATE POLICY "Service role can insert profiles"
  ON public.profiles FOR INSERT
  TO service_role
  WITH CHECK (true);
