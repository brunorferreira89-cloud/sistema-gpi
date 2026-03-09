
-- Table: alertas_semanais
CREATE TABLE public.alertas_semanais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  semana_inicio date NOT NULL,
  semana_fim date NOT NULL,
  status text DEFAULT 'rascunho',
  conteudo jsonb,
  enviado_em timestamptz,
  enviado_por uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(cliente_id, semana_inicio)
);

ALTER TABLE public.alertas_semanais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access alertas_semanais"
  ON public.alertas_semanais FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin', 'consultor'))
  WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'consultor'));

CREATE POLICY "Cliente can read own sent alertas"
  ON public.alertas_semanais FOR SELECT TO authenticated
  USING (
    get_user_role(auth.uid()) = 'cliente'
    AND cliente_id = get_user_cliente_id(auth.uid())
    AND status = 'enviado'
  );

-- Table: reunioes
CREATE TABLE public.reunioes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid REFERENCES public.clientes(id),
  tipo text NOT NULL,
  titulo text NOT NULL,
  data_reuniao date NOT NULL,
  horario time,
  formato text DEFAULT 'video',
  status text DEFAULT 'agendada',
  pauta text,
  ata text,
  realizada_por uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.reunioes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access reunioes"
  ON public.reunioes FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin', 'consultor'))
  WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'consultor'));

CREATE POLICY "Cliente can read own reunioes"
  ON public.reunioes FOR SELECT TO authenticated
  USING (
    get_user_role(auth.uid()) = 'cliente'
    AND cliente_id = get_user_cliente_id(auth.uid())
    AND (status = 'realizada' OR data_reuniao >= CURRENT_DATE)
  );
