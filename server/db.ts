import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AppState, Entry, EntryPatch, Member, Outcome, Week } from '../shared/types.ts';

const OUTCOMES: Outcome[] = ['pending', 'done', 'partial', 'failed'];

export function openDb(file: string) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS weeks (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      closed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS entries (
      week_id INTEGER NOT NULL REFERENCES weeks(id) ON DELETE CASCADE,
      member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
      goal TEXT NOT NULL DEFAULT '',
      outcome TEXT NOT NULL DEFAULT 'pending',
      excuse TEXT NOT NULL DEFAULT '',
      excuse_pick_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      excuse_reason TEXT NOT NULL DEFAULT '',
      bet_pick_id INTEGER REFERENCES members(id) ON DELETE SET NULL,
      bet_reason TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (week_id, member_id)
    );
  `);

  const toMember = (r: any): Member => ({ id: r.id, name: r.name, active: !!r.active });
  const toWeek = (r: any): Week => ({ id: r.id, title: r.title, startDate: r.start_date, closed: !!r.closed });
  const toEntry = (r: any): Entry => ({
    weekId: r.week_id,
    memberId: r.member_id,
    goal: r.goal,
    outcome: r.outcome,
    excuse: r.excuse,
    excusePickId: r.excuse_pick_id,
    excuseReason: r.excuse_reason,
    betPickId: r.bet_pick_id,
    betReason: r.bet_reason,
  });

  const columns: Record<keyof EntryPatch, string> = {
    goal: 'goal',
    outcome: 'outcome',
    excuse: 'excuse',
    excusePickId: 'excuse_pick_id',
    excuseReason: 'excuse_reason',
    betPickId: 'bet_pick_id',
    betReason: 'bet_reason',
  };

  const api = {
    state(): AppState {
      return {
        members: db.prepare('SELECT * FROM members ORDER BY id').all().map(toMember),
        weeks: db.prepare('SELECT * FROM weeks ORDER BY start_date DESC, id DESC').all().map(toWeek),
        entries: db.prepare('SELECT * FROM entries').all().map(toEntry),
      };
    },

    addMember(name: string): Member {
      const clean = name.trim();
      if (!clean) throw new HttpError(400, 'Name is required');
      const existing = db.prepare('SELECT * FROM members WHERE name = ?').get(clean);
      if (existing) return toMember(existing);
      const r = db.prepare('INSERT INTO members (name) VALUES (?) RETURNING *').get(clean);
      return toMember(r);
    },

    updateMember(id: number, patch: { name?: string; active?: boolean }) {
      if (patch.name !== undefined) {
        if (!patch.name.trim()) throw new HttpError(400, 'Name is required');
        db.prepare('UPDATE members SET name = ? WHERE id = ?').run(patch.name.trim(), id);
      }
      if (patch.active !== undefined) db.prepare('UPDATE members SET active = ? WHERE id = ?').run(patch.active ? 1 : 0, id);
    },

    deleteMember(id: number) {
      db.prepare('DELETE FROM members WHERE id = ?').run(id);
    },

    addWeek(input: { title?: string; startDate: string; entries?: (EntryPatch & { memberId: number })[] }): Week {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate ?? '')) throw new HttpError(400, 'startDate must be YYYY-MM-DD');
      db.exec('BEGIN');
      try {
        const week = toWeek(
          db.prepare('INSERT INTO weeks (title, start_date) VALUES (?, ?) RETURNING *').get(input.title?.trim() ?? '', input.startDate),
        );
        const rows = input.entries ?? db.prepare('SELECT id AS memberId FROM members WHERE active = 1').all() as any[];
        for (const e of rows) {
          db.prepare('INSERT INTO entries (week_id, member_id) VALUES (?, ?)').run(week.id, e.memberId);
          api.updateEntry(week.id, e.memberId, e);
        }
        db.exec('COMMIT');
        return week;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },

    updateWeek(id: number, patch: { title?: string; startDate?: string; closed?: boolean }) {
      if (patch.title !== undefined) db.prepare('UPDATE weeks SET title = ? WHERE id = ?').run(patch.title.trim(), id);
      if (patch.startDate !== undefined) db.prepare('UPDATE weeks SET start_date = ? WHERE id = ?').run(patch.startDate, id);
      if (patch.closed !== undefined) db.prepare('UPDATE weeks SET closed = ? WHERE id = ?').run(patch.closed ? 1 : 0, id);
    },

    deleteWeek(id: number) {
      db.prepare('DELETE FROM weeks WHERE id = ?').run(id);
    },

    updateEntry(weekId: number, memberId: number, patch: EntryPatch) {
      db.prepare('INSERT OR IGNORE INTO entries (week_id, member_id) VALUES (?, ?)').run(weekId, memberId);
      for (const [key, col] of Object.entries(columns) as [keyof EntryPatch, string][]) {
        if (!(key in patch)) continue;
        let value = patch[key] as any;
        if (key === 'outcome' && !OUTCOMES.includes(value)) throw new HttpError(400, 'Bad outcome');
        if ((key === 'excusePickId' || key === 'betPickId') && value !== null) value = Number(value);
        if (typeof value === 'string') value = value.trim();
        db.prepare(`UPDATE entries SET ${col} = ? WHERE week_id = ? AND member_id = ?`).run(value ?? null, weekId, memberId);
      }
    },

    removeEntry(weekId: number, memberId: number) {
      db.prepare('DELETE FROM entries WHERE week_id = ? AND member_id = ?').run(weekId, memberId);
    },
  };
  return api;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type Db = ReturnType<typeof openDb>;
