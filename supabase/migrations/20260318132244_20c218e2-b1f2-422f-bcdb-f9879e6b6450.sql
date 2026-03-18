-- Enable Realtime for critical tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.torre_metas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.valores_mensais;
ALTER PUBLICATION supabase_realtime ADD TABLE public.analises_ia;
ALTER PUBLICATION supabase_realtime ADD TABLE public.competencias_liberadas;
ALTER PUBLICATION supabase_realtime ADD TABLE public.painel_widgets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sugestoes_metas_ia;
ALTER PUBLICATION supabase_realtime ADD TABLE public.kpi_indicadores;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alertas_semanais;
ALTER PUBLICATION supabase_realtime ADD TABLE public.clientes;

-- Set REPLICA IDENTITY FULL for complete payload on UPDATE/DELETE
ALTER TABLE public.torre_metas REPLICA IDENTITY FULL;
ALTER TABLE public.valores_mensais REPLICA IDENTITY FULL;
ALTER TABLE public.analises_ia REPLICA IDENTITY FULL;
ALTER TABLE public.competencias_liberadas REPLICA IDENTITY FULL;
ALTER TABLE public.painel_widgets REPLICA IDENTITY FULL;
ALTER TABLE public.sugestoes_metas_ia REPLICA IDENTITY FULL;
ALTER TABLE public.kpi_indicadores REPLICA IDENTITY FULL;
ALTER TABLE public.alertas_semanais REPLICA IDENTITY FULL;
ALTER TABLE public.clientes REPLICA IDENTITY FULL;