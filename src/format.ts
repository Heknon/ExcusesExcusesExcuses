import type { Outcome, RoundStatus } from '../shared/types.ts';

const pad = (n: number) => String(n).padStart(2, '0');

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Sunday of the week containing `d` (rounds run Sunday–Saturday). */
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

/** "Nov 15 – 21", "Nov 29 – Dec 5", with the year when it isn't this year. */
export function weekRange(startIso: string, { year = false } = {}): string {
  const start = parseIso(startIso);
  const end = parseIso(addDays(startIso, 6));
  const month = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' });
  const showYear = year || end.getFullYear() !== new Date().getFullYear();
  if (start.getFullYear() !== end.getFullYear()) {
    return `${month(start)} ${start.getDate()}, ${start.getFullYear()} – ${month(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  const endPart = start.getMonth() === end.getMonth() ? `${end.getDate()}` : `${month(end)} ${end.getDate()}`;
  return `${month(start)} ${start.getDate()} – ${endPart}${showYear ? `, ${end.getFullYear()}` : ''}`;
}

export function shortDate(iso: string): string {
  return parseIso(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Days left in the round's week, counting today. Negative once the week is over. */
export function daysLeft(startIso: string, today = new Date()): number {
  const end = parseIso(addDays(startIso, 7));
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - t.getTime()) / 86_400_000);
}

export const OUTCOME_LABEL: Record<Outcome, string> = {
  pending: 'Waiting',
  done: 'Done',
  partial: 'Partly',
  failed: 'Missed',
};

export const PHASE_LABEL: Record<RoundStatus, string> = {
  planning: 'Planning',
  live: 'In progress',
  final: 'Final',
};

export function percent(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}
