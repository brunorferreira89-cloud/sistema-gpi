CREATE TABLE IF NOT EXISTS sugestoes_metas_ia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    uuid NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  competencia   date NOT NULL,
  sugestoes     jsonb NOT NULL,
  gerado_em     timestamptz DEFAULT now(),
  UNIQUE(cliente_id, competencia)
);

ALTER TABLE sugestoes_metas_ia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sugestoes_metas_ia_all" ON sugestoes_metas_ia FOR ALL USING (true);