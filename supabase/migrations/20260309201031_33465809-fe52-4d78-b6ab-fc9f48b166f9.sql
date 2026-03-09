
CREATE TABLE public.importacoes_nibo (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  arquivo_nome text,
  status text DEFAULT 'processado',
  total_contas_importadas integer DEFAULT 0,
  total_contas_nao_mapeadas integer DEFAULT 0,
  observacao text,
  importado_por uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.importacoes_nibo ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access importacoes_nibo"
  ON public.importacoes_nibo
  FOR ALL
  TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin', 'consultor'))
  WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'consultor'));
