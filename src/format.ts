import type { Outcome } from '../shared/types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Sunday of the week containing `d` (weeks run Sunday–Saturday). */
export function weekStart(d = new Date()): string {
  const s = new Date(d);
  s.setDate(s.getDate() - s.getDay());
  return toIsoDate(s);
}

export function addDays(iso: string, days: number): string {
  const d = parseIso(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

/** "Nov 15 – 21, 2026", "Nov 29 – Dec 5, 2026", "Dec 27, 2026 – Jan 2, 2027". */
export function weekRange(startIso: string): string {
  const start = parseIso(startIso);
  const end = parseIso(addDays(startIso, 6));
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  if (start.getFullYear() !== end.getFullYear()) {
    return `${month(start)} ${start.getDate()}, ${start.getFullYear()} – ${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  const endPart = start.getMonth() === end.getMonth() ? `${end.getDate()}` : `${month(end)} ${end.getDate()}`;
  return `${month(start)} ${start.getDate()} – ${endPart}, ${end.getFullYear()}`;
}

/** "Nov 15" — compact label for grids and lists. */
export function shortDate(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function weekLabel(week: { title: string; startDate: string }): string {
  return week.title || `Week of ${shortDate(week.startDate)}`;
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  pending: 'Open',
  done: 'Done',
  partial: 'Partial',
  failed: 'Missed',
};

export function percent(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
