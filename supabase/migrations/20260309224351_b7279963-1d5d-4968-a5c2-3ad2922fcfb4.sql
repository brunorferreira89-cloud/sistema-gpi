
CREATE TABLE public.diagnostico_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_empresa text NOT NULL,
  responsavel_nome text,
  email text NOT NULL UNIQUE,
  cnpj text,
  segmento text,
  faturamento numeric,
  dados_diagnostico jsonb,
  score integer,
  status text DEFAULT 'lead',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.diagnostico_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anon can insert diagnostico_leads"
ON public.diagnostico_leads
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Anon can update diagnostico_leads"
ON public.diagnostico_leads
FOR UPDATE
TO anon
USING (true)
WITH CHECK (true);

CREATE POLICY "Admin and consultor full access diagnostico_leads"
ON public.diagnostico_leads
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

CREATE POLICY "Anon can select diagnostico_leads"
ON public.diagnostico_leads
FOR SELECT
TO anon
USING (true);
