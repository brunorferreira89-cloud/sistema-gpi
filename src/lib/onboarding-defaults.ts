export const ONBOARDING_ITEMS = [
  // Semana 1 — Acessos e Configuração Nibo
  { semana: 1, ordem: 1, item: 'Solicitar acesso de somente leitura a todas as contas bancárias' },
  { semana: 1, ordem: 2, item: 'Solicitar acesso de somente leitura a todas as operadoras de cartão' },
  { semana: 1, ordem: 3, item: 'Criar empresa no Nibo e configurar dados básicos' },
  { semana: 1, ordem: 4, item: 'Configurar plano de contas no Nibo (baseado no plano GPI)' },
  { semana: 1, ordem: 5, item: 'Conectar contas bancárias ao Nibo (OFX)' },
  { semana: 1, ordem: 6, item: 'Conectar operadoras de cartão ao Nibo' },
  { semana: 1, ordem: 7, item: 'Verificar saldo inicial importado vs. extrato real' },
  { semana: 1, ordem: 8, item: 'Confirmar que operador tem acesso ao Nibo como usuário ativo' },
  // Semana 2 — Treinamento do Operador (2 dias)
  { semana: 2, ordem: 1, item: 'Realizar Dia 1 do treinamento — conceitos financeiros' },
  { semana: 2, ordem: 2, item: 'Realizar Dia 2 do treinamento — operação prática do Nibo' },
  { semana: 2, ordem: 3, item: 'Operador consegue lançar receitas corretamente sem auxílio' },
  { semana: 2, ordem: 4, item: 'Operador consegue lançar despesas e categorizar corretamente' },
  { semana: 2, ordem: 5, item: 'Operador consegue conferir saldo bancário vs. Nibo' },
  { semana: 2, ordem: 6, item: 'Entregar Guia Rápido do Operador impresso ou digital' },
  { semana: 2, ordem: 7, item: 'Confirmar canal de comunicação WhatsApp ativo com operador' },
  // Semana 3 — Auditoria Intensiva
  { semana: 3, ordem: 1, item: 'Realizar auditoria completa do Dia 1 da semana 3' },
  { semana: 3, ordem: 2, item: 'Realizar auditoria completa do Dia 2 da semana 3' },
  { semana: 3, ordem: 3, item: 'Realizar auditoria completa do Dia 3 da semana 3' },
  { semana: 3, ordem: 4, item: 'Realizar auditoria completa do Dia 4 da semana 3' },
  { semana: 3, ordem: 5, item: 'Realizar auditoria completa do Dia 5 da semana 3' },
  { semana: 3, ordem: 6, item: 'Enviar feedback consolidado ao operador ao final da semana' },
  { semana: 3, ordem: 7, item: 'Registrar principais erros identificados e orientações dadas' },
  // Semana 4 — Conclusão do Onboarding
  { semana: 4, ordem: 1, item: 'Realizar auditoria completa dos 5 dias úteis da semana 4' },
  { semana: 4, ordem: 2, item: 'Operador sem erro crítico por 5 dias consecutivos ✓' },
  { semana: 4, ordem: 3, item: 'Primeiro relatório parcial gerado e revisado' },
  { semana: 4, ordem: 4, item: 'Gerar primeira DRE parcial do período' },
  { semana: 4, ordem: 5, item: 'Reunião de alinhamento com o dono da empresa realizada' },
  { semana: 4, ordem: 6, item: 'Confirmar que cliente conhece o ciclo mensal (prazos e entregas)' },
  { semana: 4, ordem: 7, item: 'Marcar status do cliente como "Ativo" no sistema' },
];

export const TREINAMENTO_MODULOS = [
  { modulo: 'M1', titulo: 'O papel do operador financeiro', ordem: 1 },
  { modulo: 'M2', titulo: 'Receita bruta vs. receita líquida', ordem: 2 },
  { modulo: 'M3', titulo: 'Custos variáveis e margem de contribuição', ordem: 3 },
  { modulo: 'M4', titulo: 'Despesas fixas e ponto de equilíbrio', ordem: 4 },
  { modulo: 'M5', titulo: 'Resultado operacional e geração de caixa', ordem: 5 },
  { modulo: 'M6', titulo: 'O que é o Nibo e para que serve', ordem: 6 },
  { modulo: 'M7', titulo: 'Como lançar receitas no Nibo', ordem: 7 },
  { modulo: 'M8', titulo: 'Como lançar despesas e categorizar', ordem: 8 },
  { modulo: 'M9', titulo: 'Conferência de saldo e conciliação', ordem: 9 },
];

export const SEMANA_TITULOS: Record<number, string> = {
  1: 'Acessos e Configuração Nibo',
  2: 'Treinamento do Operador',
  3: 'Auditoria Intensiva',
  4: 'Conclusão do Onboarding',
};
