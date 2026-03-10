export interface TorreMeta {
  conta_id: string;
  meta_tipo: 'pct' | 'valor';
  meta_valor: number | null;
}

export function calcProjetado(anterior: number, meta: TorreMeta | null): number | null {
  if (!meta || meta.meta_valor === null) return null;
  if (meta.meta_tipo === 'pct') return Math.abs(anterior) * (1 + meta.meta_valor / 100);
  return Math.abs(meta.meta_valor);
}

export function calcStatus(realizado: number, projetado: number | null, isReceita: boolean): 'ok' | 'atencao' | 'critico' | 'neutro' {
  if (projetado === null) return 'neutro';
  const diff = isReceita ? realizado - projetado : projetado - Math.abs(realizado);
  const pct = projetado !== 0 ? Math.abs(diff / projetado) : 0;
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
