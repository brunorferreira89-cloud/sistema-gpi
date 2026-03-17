
CREATE TABLE public.painel_widgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  tipo text NOT NULL,
  conta_ids uuid[] DEFAULT '{}',
  meta_valor numeric,
  meta_direcao text DEFAULT 'menor_melhor',
  cor_destaque text DEFAULT '#1A3CFF',
  colunas integer DEFAULT 1,
  ordem integer DEFAULT 0,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX idx_painel_widgets_cliente ON public.painel_widgets(cliente_id);

ALTER TABLE public.painel_widgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access painel_widgets"
ON public.painel_widgets FOR ALL TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

CREATE POLICY "Cliente can read own painel_widgets"
ON public.painel_widgets FOR SELECT TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text
  AND cliente_id = get_user_cliente_id(auth.uid())
);
