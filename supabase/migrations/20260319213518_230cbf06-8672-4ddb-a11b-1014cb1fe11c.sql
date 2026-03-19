
DROP POLICY IF EXISTS "Cliente can read own cliente" ON public.clientes;

CREATE POLICY "Cliente can read own cliente"
ON public.clientes
FOR SELECT
TO authenticated
USING (
  (get_user_role(auth.uid()) = 'cliente'::text)
  AND (
    id = get_user_cliente_id(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.portal_usuario_clientes puc
      WHERE puc.cliente_id = clientes.id
        AND puc.usuario_id = auth.uid()
        AND puc.ativo = true
    )
  )
);
