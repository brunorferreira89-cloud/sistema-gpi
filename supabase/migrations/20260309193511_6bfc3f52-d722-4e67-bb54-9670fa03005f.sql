
-- Plano de Contas table
CREATE TABLE public.plano_de_contas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  conta_pai_id UUID REFERENCES public.plano_de_contas(id),
  nome TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('receita', 'custo_variavel', 'despesa_fixa', 'investimento', 'financeiro')),
  nivel INTEGER NOT NULL DEFAULT 1,
  ordem INTEGER NOT NULL DEFAULT 0,
  is_total BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Valores Mensais table
CREATE TABLE public.valores_mensais (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id UUID NOT NULL REFERENCES public.plano_de_contas(id) ON DELETE CASCADE,
  competencia DATE NOT NULL,
  valor_realizado NUMERIC,
  valor_meta NUMERIC,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(conta_id, competencia)
);

-- Enable RLS
ALTER TABLE public.plano_de_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.valores_mensais ENABLE ROW LEVEL SECURITY;

-- RLS for plano_de_contas
CREATE POLICY "Admin and consultor full access plano_de_contas"
  ON public.plano_de_contas FOR ALL
  TO authenticated
  USING (public.get_user_role(auth.uid()) IN ('admin', 'consultor'))
  WITH CHECK (public.get_user_role(auth.uid()) IN ('admin', 'consultor'));

CREATE POLICY "Cliente can read own plano_de_contas"
  ON public.plano_de_contas FOR SELECT
  TO authenticated
  USING (
    public.get_user_role(auth.uid()) = 'cliente'
    AND cliente_id = public.get_user_cliente_id(auth.uid())
  );

-- RLS for valores_mensais
CREATE POLICY "Admin and consultor full access valores_mensais"
  ON public.valores_mensais FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plano_de_contas pc
      WHERE pc.id = conta_id
      AND public.get_user_role(auth.uid()) IN ('admin', 'consultor')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.plano_de_contas pc
      WHERE pc.id = conta_id
      AND public.get_user_role(auth.uid()) IN ('admin', 'consultor')
    )
  );

CREATE POLICY "Cliente can read own valores_mensais"
  ON public.valores_mensais FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.plano_de_contas pc
      WHERE pc.id = conta_id
      AND public.get_user_role(auth.uid()) = 'cliente'
      AND pc.cliente_id = public.get_user_cliente_id(auth.uid())
    )
  );

-- Indexes for performance
CREATE INDEX idx_plano_de_contas_cliente_id ON public.plano_de_contas(cliente_id);
CREATE INDEX idx_plano_de_contas_conta_pai_id ON public.plano_de_contas(conta_pai_id);
CREATE INDEX idx_valores_mensais_conta_id ON public.valores_mensais(conta_id);
CREATE INDEX idx_valores_mensais_competencia ON public.valores_mensais(competencia);
