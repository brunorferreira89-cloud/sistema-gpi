
-- Create reunioes_coletivas table
CREATE TABLE public.reunioes_coletivas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo text NOT NULL,
  data_reuniao date NOT NULL,
  horario time without time zone,
  formato text DEFAULT 'hibrido',
  status text DEFAULT 'planejando',
  tema_principal text,
  descricao_tema text,
  dados_anonimizados jsonb,
  participantes_confirmados integer DEFAULT 0,
  ata text,
  realizada_por uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.reunioes_coletivas ENABLE ROW LEVEL SECURITY;

-- Admin and consultor full access
CREATE POLICY "Admin and consultor full access reunioes_coletivas"
  ON public.reunioes_coletivas
  FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
  WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

-- Cliente can read realized meetings only
CREATE POLICY "Cliente can read realized reunioes_coletivas"
  ON public.reunioes_coletivas
  FOR SELECT
  TO authenticated
  USING (
    get_user_role(auth.uid()) = 'cliente'::text
    AND status = 'realizada'::text
  );
