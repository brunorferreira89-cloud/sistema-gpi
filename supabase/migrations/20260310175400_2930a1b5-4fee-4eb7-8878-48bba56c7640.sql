CREATE TABLE IF NOT EXISTS public.torre_metas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id    uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  conta_id      uuid NOT NULL REFERENCES public.plano_de_contas(id) ON DELETE CASCADE,
  competencia   date NOT NULL,
  meta_tipo     text NOT NULL DEFAULT 'pct',
  meta_valor    numeric,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now(),
  UNIQUE(cliente_id, conta_id, competencia)
);

ALTER TABLE public.torre_metas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "torre_metas_all" ON public.torre_metas FOR ALL USING (true) WITH CHECK (true);