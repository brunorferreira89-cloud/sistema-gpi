
CREATE TABLE public.benchmark_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE NOT NULL,
  tipo text NOT NULL,
  limite_verde numeric NOT NULL,
  limite_amarelo numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(cliente_id, tipo)
);

ALTER TABLE public.benchmark_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access benchmark_config"
ON public.benchmark_config
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

CREATE POLICY "Cliente can read own benchmark_config"
ON public.benchmark_config
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text
  AND cliente_id = get_user_cliente_id(auth.uid())
);
