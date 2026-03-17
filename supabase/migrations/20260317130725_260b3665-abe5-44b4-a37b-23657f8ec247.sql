ALTER TABLE painel_widgets
  ADD COLUMN IF NOT EXISTS ocultar_zeros boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS ordenacao_lista text DEFAULT 'maior_primeiro';