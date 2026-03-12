
CREATE TABLE public.kpi_ciclo_financeiro (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id  uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  pmr         integer NOT NULL DEFAULT 30,
  pme         integer NOT NULL DEFAULT 15,
  pmp         integer NOT NULL DEFAULT 30,
  updated_at  timestamptz DEFAULT now(),
  UNIQUE(cliente_id)
);

ALTER TABLE public.kpi_ciclo_financeiro ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access kpi_ciclo_financeiro"
ON public.kpi_ciclo_financeiro
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

CREATE POLICY "Cliente can read own kpi_ciclo_financeiro"
ON public.kpi_ciclo_financeiro
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text
  AND cliente_id = get_user_cliente_id(auth.uid())
);
