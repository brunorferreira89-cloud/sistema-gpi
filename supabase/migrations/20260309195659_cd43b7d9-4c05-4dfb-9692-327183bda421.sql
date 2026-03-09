
CREATE TABLE public.tarefas_operacionais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  tipo text NOT NULL,
  titulo text NOT NULL,
  descricao text,
  status text NOT NULL DEFAULT 'pendente',
  prioridade text NOT NULL DEFAULT 'normal',
  responsavel_id uuid REFERENCES public.profiles(id),
  data_tarefa date NOT NULL,
  concluido_em timestamptz,
  observacao text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.tarefas_operacionais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and consultor full access tarefas_operacionais"
ON public.tarefas_operacionais FOR ALL TO authenticated
USING (get_user_role(auth.uid()) IN ('admin', 'consultor'))
WITH CHECK (get_user_role(auth.uid()) IN ('admin', 'consultor'));
