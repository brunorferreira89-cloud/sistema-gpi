
CREATE TABLE public.analises_ia (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE,
  indicador text NOT NULL,
  competencia date NOT NULL,
  titulo text,
  analise text,
  acao text,
  gerado_em timestamptz DEFAULT now(),
  UNIQUE(cliente_id, indicador, competencia)
);

ALTER TABLE public.analises_ia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access analises_ia"
ON public.analises_ia
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

CREATE POLICY "Cliente can read own analises_ia"
ON public.analises_ia
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text
  AND cliente_id = get_user_cliente_id(auth.uid())
);
