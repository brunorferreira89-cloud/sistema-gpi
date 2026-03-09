
ALTER TABLE public.clientes
  ADD COLUMN IF NOT EXISTS cnpj text,
  ADD COLUMN IF NOT EXISTS razao_social text,
  ADD COLUMN IF NOT EXISTS endereco_completo text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS administrador_nome text,
  ADD COLUMN IF NOT EXISTS administrador_cpf text;
