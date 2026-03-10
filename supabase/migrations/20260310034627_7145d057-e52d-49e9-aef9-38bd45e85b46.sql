
CREATE TABLE public.saldos_contas (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE NOT NULL,
  nome_conta text NOT NULL,
  competencia date NOT NULL,
  saldo_inicial numeric,
  saldo_final numeric,
  ordem integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(cliente_id, nome_conta, competencia)
);

ALTER TABLE public.saldos_contas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access saldos_contas"
ON public.saldos_contas
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

CREATE POLICY "Cliente can read own saldos_contas"
ON public.saldos_contas
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text
  AND cliente_id = get_user_cliente_id(auth.uid())
);
