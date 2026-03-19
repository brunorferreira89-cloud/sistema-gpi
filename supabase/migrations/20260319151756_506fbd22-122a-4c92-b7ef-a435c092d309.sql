
-- Create torre_simulacoes table
CREATE TABLE public.torre_simulacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES public.plano_de_contas(id) ON DELETE CASCADE,
  competencia date NOT NULL,
  meta_tipo text NOT NULL DEFAULT 'pct',
  meta_valor numeric,
  nome_cenario text DEFAULT 'Minha Simulação',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(usuario_id, cliente_id, conta_id, competencia)
);

-- Index for fast user+client lookups
CREATE INDEX idx_torre_simulacoes_usuario ON public.torre_simulacoes(usuario_id, cliente_id);

-- Enable RLS
ALTER TABLE public.torre_simulacoes ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own rows
CREATE POLICY "Users can manage own simulacoes"
  ON public.torre_simulacoes
  FOR ALL
  TO authenticated
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

-- Admin/consultor can read all (for espelho view)
CREATE POLICY "Admin and consultor can read all simulacoes"
  ON public.torre_simulacoes
  FOR SELECT
  TO authenticated
  USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

-- Add alerta_portal column to kpi_indicadores
ALTER TABLE public.kpi_indicadores
  ADD COLUMN IF NOT EXISTS alerta_portal boolean DEFAULT false;
