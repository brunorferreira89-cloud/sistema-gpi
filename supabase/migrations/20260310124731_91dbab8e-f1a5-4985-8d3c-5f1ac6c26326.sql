ALTER TABLE kpi_indicadores ADD COLUMN conta_ids uuid[] DEFAULT '{}';

UPDATE kpi_indicadores SET conta_ids = ARRAY[conta_id] WHERE conta_id IS NOT NULL;