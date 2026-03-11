ALTER TABLE sugestoes_metas_ia
  ADD COLUMN IF NOT EXISTS coordenada_comandante text,
  ADD COLUMN IF NOT EXISTS coordenada_gerada_em timestamptz;