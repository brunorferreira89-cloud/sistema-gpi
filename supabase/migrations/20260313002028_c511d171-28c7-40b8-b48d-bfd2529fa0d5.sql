
-- Create competencias_liberadas table
CREATE TABLE IF NOT EXISTS public.competencias_liberadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  status text NOT NULL DEFAULT 'rascunho',
  liberado_por uuid REFERENCES public.profiles(id),
  liberado_em timestamptz,
  revogado_por uuid REFERENCES public.profiles(id),
  revogado_em timestamptz,
  observacao text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(cliente_id, competencia)
);

-- Enable RLS
ALTER TABLE public.competencias_liberadas ENABLE ROW LEVEL SECURITY;

-- Admin and consultor full access
CREATE POLICY "Admin and consultor full access competencias_liberadas"
ON public.competencias_liberadas
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

-- Cliente can read own liberadas
CREATE POLICY "Cliente can read own competencias_liberadas"
ON public.competencias_liberadas
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text 
  AND cliente_id = get_user_cliente_id(auth.uid())
);
