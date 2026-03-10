
CREATE TABLE public.benchmark_configuracoes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE NOT NULL,
  conta_id uuid REFERENCES public.plano_de_contas(id) ON DELETE CASCADE NOT NULL,
  limite_verde numeric NOT NULL,
  limite_ambar numeric NOT NULL,
  direcao text NOT NULL DEFAULT 'menor_melhor',
  created_at timestamptz DEFAULT now(),
  UNIQUE(cliente_id, conta_id)
);

ALTER TABLE public.benchmark_configuracoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access benchmark_configuracoes"
ON public.benchmark_configuracoes
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

CREATE POLICY "Cliente can read own benchmark_configuracoes"
ON public.benchmark_configuracoes
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text
  AND cliente_id = get_user_cliente_id(auth.uid())
);
