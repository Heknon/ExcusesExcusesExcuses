/** Date math and small text helpers. Locale-aware formatting lives in i18n.tsx. */

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

/** Default deadline: the last day of the week (Saturday) at 23:59, local time. */
export function defaultDeadline(startIso: string): string {
  const [y, m, d] = startIso.split('-').map(Number);
  return new Date(y, m - 1, d + 6, 23, 59).toISOString();
}

/** ISO timestamp ⇄ the value of an <input type="datetime-local"> (local time, minutes). */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${toIsoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  // Hebrew names read best as a single letter.
  if (/[֐-׿]/.test(parts[0])) return parts[0].charAt(0);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}
