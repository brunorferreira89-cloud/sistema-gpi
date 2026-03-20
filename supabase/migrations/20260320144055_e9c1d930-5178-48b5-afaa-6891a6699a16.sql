CREATE OR REPLACE FUNCTION public.user_can_access_cliente(_user_id uuid, _cliente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = _user_id
      AND (
        p.role IN ('admin', 'consultor')
        OR (
          p.role = 'cliente'
          AND (
            p.cliente_id = _cliente_id
            OR EXISTS (
              SELECT 1
              FROM public.portal_usuario_clientes puc
              WHERE puc.usuario_id = _user_id
                AND puc.cliente_id = _cliente_id
                AND puc.ativo = true
            )
          )
        )
      )
  );
$$;

DROP POLICY IF EXISTS "Cliente can read own onboarding_checklist" ON public.onboarding_checklist;
CREATE POLICY "Cliente can read accessible onboarding_checklist"
ON public.onboarding_checklist
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own benchmark_config" ON public.benchmark_config;
CREATE POLICY "Cliente can read accessible benchmark_config"
ON public.benchmark_config
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own competencias_liberadas" ON public.competencias_liberadas;
CREATE POLICY "Cliente can read accessible competencias_liberadas"
ON public.competencias_liberadas
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own reunioes" ON public.reunioes;
CREATE POLICY "Cliente can read accessible reunioes"
ON public.reunioes
FOR SELECT
TO authenticated
USING (
  public.user_can_access_cliente(auth.uid(), cliente_id)
  AND ((status = 'realizada') OR (data_reuniao >= CURRENT_DATE))
);

DROP POLICY IF EXISTS "Cliente can read own saldos_contas" ON public.saldos_contas;
CREATE POLICY "Cliente can read accessible saldos_contas"
ON public.saldos_contas
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own analises_ia" ON public.analises_ia;
CREATE POLICY "Cliente can read accessible analises_ia"
ON public.analises_ia
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own painel_widgets" ON public.painel_widgets;
CREATE POLICY "Cliente can read accessible painel_widgets"
ON public.painel_widgets
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own kpi_ciclo_financeiro" ON public.kpi_ciclo_financeiro;
CREATE POLICY "Cliente can read accessible kpi_ciclo_financeiro"
ON public.kpi_ciclo_financeiro
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own plano_de_contas" ON public.plano_de_contas;
CREATE POLICY "Cliente can read accessible plano_de_contas"
ON public.plano_de_contas
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own valores_mensais" ON public.valores_mensais;
CREATE POLICY "Cliente can read accessible valores_mensais"
ON public.valores_mensais
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.plano_de_contas pc
    WHERE pc.id = valores_mensais.conta_id
      AND public.user_can_access_cliente(auth.uid(), pc.cliente_id)
  )
);

DROP POLICY IF EXISTS "Cliente can read own apresentacao_preparacao" ON public.apresentacao_preparacao;
CREATE POLICY "Cliente can read accessible apresentacao_preparacao"
ON public.apresentacao_preparacao
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own apresentacoes" ON public.apresentacoes;
CREATE POLICY "Cliente can read accessible apresentacoes"
ON public.apresentacoes
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own caminho_a_seguir" ON public.caminho_a_seguir;
CREATE POLICY "Cliente can read accessible caminho_a_seguir"
ON public.caminho_a_seguir
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own sent alertas" ON public.alertas_semanais;
CREATE POLICY "Cliente can read accessible sent alertas"
ON public.alertas_semanais
FOR SELECT
TO authenticated
USING (
  public.user_can_access_cliente(auth.uid(), cliente_id)
  AND status = 'enviado'
);

DROP POLICY IF EXISTS "Cliente can read own treinamento_progresso" ON public.treinamento_progresso;
CREATE POLICY "Cliente can read accessible treinamento_progresso"
ON public.treinamento_progresso
FOR SELECT
TO authenticated
USING (public.user_can_access_cliente(auth.uid(), cliente_id));

DROP POLICY IF EXISTS "Cliente can read own or default kpi_indicadores" ON public.kpi_indicadores;
CREATE POLICY "Cliente can read accessible or default kpi_indicadores"
ON public.kpi_indicadores
FOR SELECT
TO authenticated
USING (
  cliente_id IS NULL
  OR public.user_can_access_cliente(auth.uid(), cliente_id)
);