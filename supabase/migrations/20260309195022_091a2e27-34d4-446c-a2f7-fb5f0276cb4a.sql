
-- 1. Create onboarding_checklist table
CREATE TABLE public.onboarding_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  semana integer NOT NULL,
  item text NOT NULL,
  concluido boolean DEFAULT false,
  concluido_em timestamptz,
  concluido_por uuid REFERENCES public.profiles(id),
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 2. Create treinamento_progresso table
CREATE TABLE public.treinamento_progresso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  modulo text NOT NULL,
  titulo text NOT NULL,
  concluido boolean DEFAULT false,
  concluido_em timestamptz,
  observacao text,
  ordem integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- 3. Add contact columns to clientes (additive only)
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS responsavel_nome text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS responsavel_email text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS responsavel_whatsapp text;
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS observacoes text;

-- 4. Enable RLS
ALTER TABLE public.onboarding_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treinamento_progresso ENABLE ROW LEVEL SECURITY;

-- 5. RLS for onboarding_checklist
CREATE POLICY "Admin and consultor full access onboarding_checklist"
ON public.onboarding_checklist FOR ALL TO authenticated
USING (get_user_role(auth.uid()) IN ('admin', 'consultor'))
WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'consultor'));

CREATE POLICY "Cliente can read own onboarding_checklist"
ON public.onboarding_checklist FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'cliente' AND cliente_id = get_user_cliente_id(auth.uid()));

-- 6. RLS for treinamento_progresso
CREATE POLICY "Admin and consultor full access treinamento_progresso"
ON public.treinamento_progresso FOR ALL TO authenticated
USING (get_user_role(auth.uid()) IN ('admin', 'consultor'))
WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'consultor'));

CREATE POLICY "Cliente can read own treinamento_progresso"
ON public.treinamento_progresso FOR SELECT TO authenticated
USING (get_user_role(auth.uid()) = 'cliente' AND cliente_id = get_user_cliente_id(auth.uid()));

-- 7. Add INSERT/UPDATE/DELETE policies for clientes (admin/consultor)
CREATE POLICY "Admin and consultor can insert clientes"
ON public.clientes FOR INSERT TO authenticated
WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'consultor'));

CREATE POLICY "Admin and consultor can update clientes"
ON public.clientes FOR UPDATE TO authenticated
USING (get_user_role(auth.uid()) IN ('admin', 'consultor'));

CREATE POLICY "Admin and consultor can delete clientes"
ON public.clientes FOR DELETE TO authenticated
USING (get_user_role(auth.uid()) IN ('admin', 'consultor'));
