
-- Create portal_usuario_clientes table
CREATE TABLE IF NOT EXISTS portal_usuario_clientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cliente_id uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  ativo boolean NOT NULL DEFAULT true,
  empresa_padrao boolean NOT NULL DEFAULT false,
  criado_em timestamptz DEFAULT now(),
  UNIQUE(usuario_id, cliente_id)
);

-- Enable RLS
ALTER TABLE portal_usuario_clientes ENABLE ROW LEVEL SECURITY;

-- RLS: Admin and consultor full access
CREATE POLICY "Admin and consultor full access portal_usuario_clientes"
ON portal_usuario_clientes
FOR ALL
TO authenticated
USING (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]))
WITH CHECK (get_user_role(auth.uid()) = ANY (ARRAY['admin'::text, 'consultor'::text]));

-- RLS: Cliente can read own links
CREATE POLICY "Cliente can read own portal_usuario_clientes"
ON portal_usuario_clientes
FOR SELECT
TO authenticated
USING (
  get_user_role(auth.uid()) = 'cliente'::text
  AND usuario_id = auth.uid()
);

-- Migrate existing data
INSERT INTO portal_usuario_clientes (usuario_id, cliente_id, ativo, empresa_padrao)
SELECT id, cliente_id, COALESCE(portal_ativo, false), true
FROM profiles
WHERE cliente_id IS NOT NULL
  AND role = 'cliente'
ON CONFLICT (usuario_id, cliente_id) DO NOTHING;
