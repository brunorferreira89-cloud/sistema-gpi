ALTER TABLE painel_widgets
  ADD COLUMN IF NOT EXISTS analise_ia text,
  ADD COLUMN IF NOT EXISTS analise_gerada_em timestamptz,
  ADD COLUMN IF NOT EXISTS analise_hash text,
  ADD COLUMN IF NOT EXISTS periodo_meses integer DEFAULT 6,
  ADD COLUMN IF NOT EXISTS meta_valor_b numeric,
  ADD COLUMN IF NOT EXISTS conta_ids_b uuid[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS formato_resultado text DEFAULT 'percentual';