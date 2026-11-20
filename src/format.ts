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

/** Days left in the round's week, counting today. Zero or less once the week is over. */
export function daysLeft(startIso: string, today = new Date()): number {
  const end = parseIso(addDays(startIso, 7));
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - t.getTime()) / 86_400_000);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  // Hebrew names read best as a single letter.
  if (/[֐-׿]/.test(parts[0])) return parts[0].charAt(0);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}
