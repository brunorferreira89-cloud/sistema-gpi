
-- 3a. Add portal_ativo to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS portal_ativo boolean DEFAULT false;

-- 3b. apresentacao_preparacao
CREATE TABLE IF NOT EXISTS apresentacao_preparacao (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id      uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  competencia     date NOT NULL,
  diagnostico     text,
  objetivos       text,
  riscos          text,
  proximos_passos text,
  gerado_em       timestamptz,
  editado_em      timestamptz,
  editado_por     uuid REFERENCES profiles(id),
  UNIQUE(cliente_id, competencia)
);

ALTER TABLE apresentacao_preparacao ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access apresentacao_preparacao"
  ON apresentacao_preparacao FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin','consultor'))
  WITH CHECK (get_user_role(auth.uid()) IN ('admin','consultor'));

CREATE POLICY "Cliente can read own apresentacao_preparacao"
  ON apresentacao_preparacao FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = 'cliente' AND cliente_id = get_user_cliente_id(auth.uid()));

-- 3c. apresentacoes
CREATE TABLE IF NOT EXISTS apresentacoes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id          uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  consultor_id        uuid REFERENCES profiles(id),
  competencia         date NOT NULL,
  iniciada_em         timestamptz,
  metas_validadas_em  timestamptz,
  encerrada_em        timestamptz,
  slide_atual         integer DEFAULT 1
);

ALTER TABLE apresentacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access apresentacoes"
  ON apresentacoes FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin','consultor'))
  WITH CHECK (get_user_role(auth.uid()) IN ('admin','consultor'));

CREATE POLICY "Cliente can read own apresentacoes"
  ON apresentacoes FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = 'cliente' AND cliente_id = get_user_cliente_id(auth.uid()));

-- 3d. caminho_a_seguir
CREATE TABLE IF NOT EXISTS caminho_a_seguir (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apresentacao_id  uuid REFERENCES apresentacoes(id),
  cliente_id       uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  competencia      date NOT NULL,
  acoes            jsonb DEFAULT '[]',
  gerado_em        timestamptz,
  UNIQUE(cliente_id, competencia)
);

ALTER TABLE caminho_a_seguir ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access caminho_a_seguir"
  ON caminho_a_seguir FOR ALL TO authenticated
  USING (get_user_role(auth.uid()) IN ('admin','consultor'))
  WITH CHECK (get_user_role(auth.uid()) IN ('admin','consultor'));

CREATE POLICY "Cliente can read own caminho_a_seguir"
  ON caminho_a_seguir FOR SELECT TO authenticated
  USING (get_user_role(auth.uid()) = 'cliente' AND cliente_id = get_user_cliente_id(auth.uid()));
