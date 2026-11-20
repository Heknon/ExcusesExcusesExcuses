/**
 * Parse / format the weekly round in the WhatsApp format the team already uses:
 *
 *   *א ביצועים, א תירוצים, א הימורים*
 *   *ביצועים*
 *   * מייקל - מכין פסטה עם חיה
 *   *מי תירוצים*
 *   * מייקל - אלי, כי הוא יפול איפה שהוא
 *   *מי יהיה ביצועים (הימורים)*
 *   * מייקל - רינגלר כי יש לו מה להוכיח
 */

export type Section = 'goals' | 'excuses' | 'bets';

export interface ParsedPick {
  /** Name of the member being picked, or null when no known/first word could be found. */
  target: string | null;
  reason: string;
  raw: string;
}

export interface ParsedRow {
  name: string;
  goal: string;
  excuse: ParsedPick | null;
  bet: ParsedPick | null;
}

export interface ParsedRound {
  rows: ParsedRow[];
  /** Lines that looked like content but could not be placed. */
  skipped: string[];
}

const KEYWORDS: Record<Section, string> = {
  goals: 'ביצועים',
  excuses: 'תירוצים',
  bets: 'הימורים',
};

/** Strip WhatsApp formatting characters and directional marks. */
function clean(s: string): string {
  return s
    .replace(/[‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectHeader(line: string): Section | 'title' | null {
  const hits = (Object.keys(KEYWORDS) as Section[]).filter((k) => line.includes(KEYWORDS[k]));
  if (hits.length === 0) return null;
  if (hits.length > 1) {
    // "מי יהיה ביצועים (הימורים)" names both, and means bets.
    if (hits.length === 2 && hits.includes('bets') && hits.includes('goals')) return 'bets';
    return 'title';
  }
  return hits[0];
}

const BULLET = /^\s*(?:[*•\-–·]|\d+[.)])\s+/;
const SEPARATOR = /\s+[-–—:]\s+|\s*[-–—:]\s+|\s+[-–—]\s*/;

function splitNameAndText(line: string): [string, string] | null {
  const body = line.replace(BULLET, '');
  const m = body.match(SEPARATOR);
  if (!m || m.index === undefined || m.index === 0) return null;
  const name = clean(body.slice(0, m.index));
  const text = clean(body.slice(m.index + m[0].length));
  if (!name || name.split(' ').length > 3) return null;
  return [name, text];
}

const norm = (s: string) => s.replace(/[\s'"׳״`]/g, '').toLowerCase();

/** Find a known name in the text: the first one by position, or the last one with `last`. */
function findName(text: string, names: string[], last = false): string | null {
  let best: { name: string; at: number } | null = null;
  for (const name of names) {
    const at = last ? text.lastIndexOf(name) : text.indexOf(name);
    if (at < 0) continue;
    const better = !best || (last ? at > best.at : at < best.at) || (at === best.at && name.length > best.name.length);
    if (better) best = { name, at };
  }
  return best?.name ?? null;
}

export function parsePick(text: string, names: string[]): ParsedPick {
  const raw = text;
  // The pick is the text before the reason ("כי ..."), usually followed by a comma.
  const reasonMatch = text.match(/(?:^|[\s,])כי\s+(.*)$/);
  const head = reasonMatch ? text.slice(0, reasonMatch.index) : text;
  let reason = reasonMatch ? reasonMatch[1].trim() : '';

  // Before the reason, the *last* name wins: "אורי, כולם קלים מדי אז אורי - רינגלר כי…" means רינגלר.
  let target = findName(head, names, true) ?? findName(text, names);
  if (!target) {
    const first = clean(head).split(/[\s,]/)[0];
    target = first || null;
  }
  if (!reasonMatch) {
    // No "כי": whatever follows the name is the reason.
    reason = clean(text.replace(target ?? '', '')).replace(/^[,.\-–\s]+/, '');
  }
  return { target, reason, raw };
}

export function parseRound(input: string, knownNames: string[] = []): ParsedRound {
  const lines = input.split(/\r?\n/);
  const order: string[] = [];
  const byName = new Map<string, ParsedRow>();
  const skipped: string[] = [];
  const pending: { section: Section; name: string; text: string }[] = [];
  let section: Section | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!clean(line)) continue;
    const isBullet = BULLET.test(line);
    const header = isBullet ? null : detectHeader(clean(line));
    if (header === 'title') continue;
    if (header) {
      section = header;
      continue;
    }
    const pair = splitNameAndText(line);
    if (!section || !pair) {
      skipped.push(clean(line));
      continue;
    }
    pending.push({ section, name: pair[0], text: pair[1] });
  }

  // Resolve names: reuse existing member names when they match loosely.
  const resolve = (name: string) => {
    const hit = [...knownNames, ...order].find((n) => norm(n) === norm(name));
    return hit ?? name;
  };

  for (const p of pending) {
    const name = resolve(p.name);
    if (!byName.has(name)) {
      byName.set(name, { name, goal: '', excuse: null, bet: null });
      order.push(name);
    }
  }

  const allNames = [...new Set([...knownNames, ...order])];
  for (const p of pending) {
    const row = byName.get(resolve(p.name))!;
    if (p.section === 'goals') row.goal = row.goal ? `${row.goal}, ${p.text}` : p.text;
    else {
      const pick = parsePick(p.text, allNames);
      if (pick.target) pick.target = resolve(pick.target);
      if (p.section === 'excuses') row.excuse = pick;
      else row.bet = pick;
    }
  }

  return { rows: order.map((n) => byName.get(n)!), skipped };
}

export interface FormatRow {
  name: string;
  goal: string;
  excuseTarget: string | null;
  excuseReason: string;
  betTarget: string | null;
  betReason: string;
}

function pickLine(name: string, target: string | null, reason: string): string | null {
  if (!target) return null;
  return `* ${name} - ${target}${reason ? ` כי ${reason.replace(/^כי\s+/, '')}` : ''}`;
}

/** Produce a message ready to paste back into the WhatsApp group. */
export function formatRound(rows: FormatRow[], title?: string): string {
  const out: string[] = [];
  out.push(`*${title?.trim() || 'א ביצועים, א תירוצים, א הימורים'}*`, '');
  out.push('*ביצועים*');
  for (const r of rows) if (r.goal) out.push(`* ${r.name} - ${r.goal}`);
  out.push('', '*מי תירוצים*');
  for (const r of rows) {
    const l = pickLine(r.name, r.excuseTarget, r.excuseReason);
    if (l) out.push(l);
  }
  out.push('', '*מי יהיה ביצועים (הימורים)*');
  for (const r of rows) {
    const l = pickLine(r.name, r.betTarget, r.betReason);
    if (l) out.push(l);
  }
  return out.join('\n');
}
