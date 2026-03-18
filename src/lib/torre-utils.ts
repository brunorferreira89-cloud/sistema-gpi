export interface TorreMeta {
  conta_id: string;
  meta_tipo: 'pct' | 'valor' | 'delta';
  meta_valor: number | null;
}

export function calcProjetado(anterior: number, meta: TorreMeta | null, contaTipo?: string): number | null {
  if (!meta || meta.meta_valor === null) return null;
  if (meta.meta_tipo === 'pct') return anterior * (1 + meta.meta_valor / 100);
  if (meta.meta_tipo === 'delta') {
    const result = anterior + meta.meta_valor;
    // When anterior=0, delta>0 for costs should be negative
    if (anterior === 0 && result > 0 && contaTipo && contaTipo !== 'receita') {
      return -result;
    }
    return result;
  }
  // valor absoluto: infer sign from account type when anterior is zero
  const sign = anterior === 0
    ? (contaTipo && contaTipo !== 'receita' ? -1 : 1)
    : (anterior < 0 ? -1 : 1);
  return sign * Math.abs(meta.meta_valor);
}

export function calcStatus(realizado: number, projetado: number | null, isReceita: boolean): 'ok' | 'atencao' | 'critico' | 'neutro' {
  if (projetado === null) return 'neutro';
  // For receita (positive values): higher is better
  // For custos/despesas (negative values): closer to zero is better (less negative = less cost)
  const diff = isReceita ? realizado - projetado : projetado - realizado;
  const base = Math.abs(projetado) || 1;
  const pct = Math.abs(diff) / base;
  if (diff >= 0) return 'ok';
  if (pct <= 0.1) return 'atencao';
  return 'critico';
}

export function fmtTorre(v: number | null): string {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const s = abs >= 1000 ? abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) : abs.toFixed(0);
  return v < 0 ? `(${s})` : s;
}

export function mesAnterior(competencia: string): string {
  const d = new Date(competencia + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function mesSeguinte(competencia: string): string {
  const d = new Date(competencia + 'T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function fmtCompetencia(comp: string): string {
  const d = new Date(comp + 'T12:00:00Z');
  return d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '').toUpperCase();
}

// --- NCG (Necessidade de Capital de Giro) ---

export function calcNCG(params: {
  faturamento: number;
  cmv: number;
  pmr: number;
  pme: number;
  pmp: number;
}): number {
  const receber = (params.faturamento / 30) * params.pmr;
  const estoques = (params.cmv / 30) * params.pme;
  const pagar = (params.cmv / 30) * params.pmp;
  return receber + estoques - pagar;
}

export function calcNCGPct(ncg: number, faturamento: number): number {
  if (!faturamento) return 0;
  return (ncg / faturamento) * 100;
}

export function calcNCGStatus(ncgPct: number): 'ok' | 'atencao' | 'critico' {
  if (ncgPct <= 0) return 'ok';
  if (ncgPct <= 15) return 'atencao';
  return 'critico';
}

// --- GAP de Capital de Giro ---

export function calcGapNCG(ncg: number, caixaDisponivel: number): number {
  // positivo = sobra caixa / negativo = falta caixa
  return caixaDisponivel - ncg;
}

export function calcGapStatus(gap: number): 'ok' | 'atencao' | 'critico' {
  if (gap >= 0) return 'ok';
  if (gap > -50000) return 'atencao';
  return 'critico';
}
