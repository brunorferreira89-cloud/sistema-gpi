
CREATE TABLE public.kpi_indicadores (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  cliente_id uuid REFERENCES public.clientes(id) ON DELETE CASCADE,
  nome text NOT NULL,
  descricao text,
  tipo_fonte text NOT NULL,
  conta_id uuid REFERENCES public.plano_de_contas(id) ON DELETE SET NULL,
  totalizador_key text,
  limite_verde numeric NOT NULL,
  limite_ambar numeric NOT NULL,
  direcao text NOT NULL DEFAULT 'menor_melhor',
  ativo boolean NOT NULL DEFAULT true,
  ordem integer DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.kpi_indicadores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access kpi_indicadores"
ON public.kpi_indicadores
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

CREATE POLICY "Cliente can read own or default kpi_indicadores"
ON public.kpi_indicadores
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text
  AND (cliente_id IS NULL OR cliente_id = get_user_cliente_id(auth.uid()))
);

INSERT INTO public.kpi_indicadores
  (cliente_id, nome, descricao, tipo_fonte, totalizador_key, limite_verde, limite_ambar, direcao, ordem)
VALUES
  (null, 'CMV', 'Custo da Mercadoria Vendida sobre o Faturamento', 'subgrupo', null, 38, 50, 'menor_melhor', 1),
  (null, 'CMO', 'Custo com Mão de Obra sobre o Faturamento', 'subgrupo', null, 25, 35, 'menor_melhor', 2),
  (null, 'Margem de Contribuição', 'MC sobre o Faturamento', 'totalizador', 'MC', 40, 30, 'maior_melhor', 3),
  (null, 'Resultado Operacional', 'RO sobre o Faturamento', 'totalizador', 'RO', 10, 5, 'maior_melhor', 4),
  (null, 'Geração de Caixa', 'GC sobre o Faturamento', 'totalizador', 'GC', 10, 3, 'maior_melhor', 5);

DROP TABLE IF EXISTS public.benchmark_configuracoes;
