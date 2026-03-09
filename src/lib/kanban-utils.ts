// Fixed national holidays (MM-DD)
const FERIADOS_FIXOS = [
  '01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25',
];

export function isFeriado(d: Date): boolean {
  const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return FERIADOS_FIXOS.includes(mmdd);
}

export function isDiaUtil(d: Date): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !isFeriado(d);
}

export function nextDiaUtil(d: Date, direction: 1 | -1 = 1): Date {
  const next = new Date(d);
  do {
    next.setDate(next.getDate() + direction);
  } while (!isDiaUtil(next));
  return next;
}

export function todayDiaUtil(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (isDiaUtil(today)) return today;
  return nextDiaUtil(today, -1);
}

export function formatDateBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function toDateString(d: Date): string {
  return d.toISOString().split('T')[0];
}

export function isSextaFeira(d: Date): boolean {
  return d.getDay() === 5;
}
