export const segmentColors: Record<string, { bg: string; text: string }> = {
  alimentacao: { bg: 'bg-[#FFF7ED]', text: 'text-amber' },
  saude: { bg: 'bg-[#F0FDF4]', text: 'text-green' },
  estetica: { bg: 'bg-[#FDF4FF]', text: 'text-[#9333EA]' },
  varejo: { bg: 'bg-surface-hi', text: 'text-primary' },
  servicos: { bg: 'bg-surface-hi', text: 'text-cyan' },
  outro: { bg: 'bg-surface-hi', text: 'text-txt-sec' },
};

export const segmentLabels: Record<string, string> = {
  alimentacao: 'Alimentação',
  saude: 'Saúde',
  estetica: 'Beleza & Estética',
  varejo: 'Varejo',
  servicos: 'Serviços',
  outro: 'Outro',
};

export const faixaLabels: Record<string, string> = {
  faixa1: 'R$ 80k – 150k',
  faixa2: 'R$ 150k – 300k',
  faixa3: 'R$ 300k – 500k',
  faixa4: 'Acima de R$ 500k',
};

export const statusColors: Record<string, { bg: string; text: string }> = {
  ativo: { bg: 'bg-green/10', text: 'text-green' },
  onboarding: { bg: 'bg-primary-lo', text: 'text-primary' },
  inativo: { bg: 'bg-muted', text: 'text-txt-muted' },
};

export const statusLabels: Record<string, string> = {
  ativo: 'Ativo',
  onboarding: 'Onboarding',
  inativo: 'Inativo',
};
