import { randomInt } from 'node:crypto';
import {
  OUTCOMES,
  ROUND_STATUSES,
  type Entry,
  type EntryPatch,
  type GameState,
  type GameSummary,
  type Player,
  type Proof,
  type Role,
  type Goal,
  type Outcome,
  MAX_GOALS,
  GOAL_MAX_LENGTH,
  type Round,
  type RoundPatch,
  type RoundStatus,
  type User,
} from '../shared/types.ts';
import { combineOutcomes } from '../shared/scoring.ts';
import { friendly, HttpError, transaction, type Pool, type Queryable } from './db.ts';

const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newInviteCode = () => Array.from({ length: 6 }, () => INVITE_ALPHABET[randomInt(INVITE_ALPHABET.length)]).join('');

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface PlayerRow {
  id: number;
  game_id: number;
  user_id: number | null;
  name: string;
  role: Role;
  status: Player['status'];
  created_at: Date;
  email?: string | null;
}

const toRound = (r: any): Round => ({
  id: r.id,
  startDate: r.start_date,
  deadline: r.deadline.toISOString(),
  title: r.title,
  notes: r.notes,
  status: r.status,
});

function toEntry(r: any, hidden: boolean, proofs: Proof[] = [], goals: Goal[] = []): Entry {
  return {
    roundId: r.round_id,
    playerId: r.player_id,
    goals,
    outcome: r.outcome,
    excuse: r.excuse,
    notes: r.notes,
    excusePickId: hidden ? null : r.excuse_pick_id,
    excuseReason: hidden ? '' : r.excuse_reason,
    betPickId: hidden ? null : r.bet_pick_id,
    betReason: hidden ? '' : r.bet_reason,
    submitted: r.submitted_at != null,
    hidden,
    proofs,
  };
}

const ENTRY_COLUMNS = {
  outcome: 'outcome',
  excuse: 'excuse',
  notes: 'notes',
  excusePickId: 'excuse_pick_id',
  excuseReason: 'excuse_reason',
  betPickId: 'bet_pick_id',
  betReason: 'bet_reason',
} as const;

type EntryField = keyof EntryPatch;
const PICKS: EntryField[] = ['excusePickId', 'excuseReason', 'betPickId', 'betReason'];

/** What a player may change on their own entry in each phase. */
const SELF_EDITABLE: Record<RoundStatus, EntryField[]> = {
  planning: ['goals', ...PICKS, 'submitted', 'notes'],
  live: ['goalOutcomes', 'outcome', 'excuse', 'notes'],
  final: ['notes'],
};

/** A deadline from the client, or the end of the round's week (Saturday 23:59, server time). */
function parseDeadline(value: unknown, startDate: string): string {
  if (value == null || value === '') {
    const end = new Date(`${startDate}T00:00:00`);
    end.setDate(end.getDate() + 7);
    end.setMinutes(end.getMinutes() - 1);
    return end.toISOString();
  }
  const t = Date.parse(String(value));
  if (Number.isNaN(t)) throw new HttpError(400, 'invalid_deadline');
  return new Date(t).toISOString();
}

export const PROOF_MAX_BYTES = 5 * 1024 * 1024;
const PROOFS_PER_ENTRY = 6;

/** Identify an image by its first bytes, never by what the client claims. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'image/gif';
  return null;
}

const LIMITS: Partial<Record<EntryField, number>> = {
  excuse: 1000,
  notes: 4000,
  excuseReason: 500,
  betReason: 500,
};

export function gameService(pool: Pool) {
  /** The caller's seat in a game, or 403/404. */
  async function seat(q: Queryable, userId: number, gameId: number, opts: { admin?: boolean } = {}): Promise<PlayerRow> {
    const { rows } = await q.query<PlayerRow>('SELECT * FROM players WHERE game_id = $1 AND user_id = $2', [gameId, userId]);
    const me = rows[0];
    if (!me || me.status === 'removed') throw new HttpError(404, 'game_not_found');
    if (me.status === 'pending') throw new HttpError(403, 'request_pending');
    if (opts.admin && me.role !== 'admin') throw new HttpError(403, 'admin_only');
    return me;
  }

  async function roundInGame(q: Queryable, gameId: number, roundId: number): Promise<Round> {
    const { rows } = await q.query('SELECT * FROM rounds WHERE id = $1 AND game_id = $2', [roundId, gameId]);
    if (!rows[0]) throw new HttpError(404, 'round_not_found');
    return toRound(rows[0]);
  }

  async function playerInGame(q: Queryable, gameId: number, playerId: number): Promise<PlayerRow> {
    const { rows } = await q.query<PlayerRow>('SELECT * FROM players WHERE id = $1 AND game_id = $2', [playerId, gameId]);
    if (!rows[0]) throw new HttpError(404, 'player_not_found');
    return rows[0];
  }

  async function adminCount(q: Queryable, gameId: number): Promise<number> {
    const { rows } = await q.query(
      `SELECT count(*)::int AS n FROM players WHERE game_id = $1 AND role = 'admin' AND status = 'active' AND user_id IS NOT NULL`,
      [gameId],
    );
    return rows[0].n;
  }

  /** Give a newly active player a seat in a round that's still being planned. */
  async function seatInPlanningRound(q: Queryable, gameId: number, playerId: number) {
    await q.query(
      `INSERT INTO round_entries (round_id, player_id)
       SELECT id, $2 FROM rounds WHERE game_id = $1 AND status = 'planning'
       ON CONFLICT DO NOTHING`,
      [gameId, playerId],
    );
  }

  function cleanName(name: unknown): string {
    const n = String(name ?? '').trim();
    if (!n) throw new HttpError(400, 'name_required');
    if (n.length > 40) throw new HttpError(400, 'name_too_long');
    return n;
  }

  return {
    async listForUser(userId: number): Promise<GameSummary[]> {
      const { rows } = await pool.query(
        `SELECT g.id, g.name, p.id AS player_id, p.role, p.status,
           (SELECT json_agg(json_build_object('id', o.id, 'name', o.name) ORDER BY o.id)
              FROM players o WHERE o.game_id = g.id AND o.status = 'active') AS players,
           (SELECT row_to_json(r) FROM (
              SELECT id, status, start_date AS "startDate" FROM rounds
              WHERE game_id = g.id ORDER BY start_date DESC, id DESC LIMIT 1) r) AS round,
           (SELECT count(*)::int FROM players o WHERE o.game_id = g.id AND o.status = 'pending') AS pending
         FROM players p JOIN games g ON g.id = p.game_id
         WHERE p.user_id = $1 AND p.status <> 'removed'
         ORDER BY g.created_at DESC`,
        [userId],
      );
      const summaries: GameSummary[] = [];
      for (const r of rows) {
        let todo: GameSummary['todo'] = null;
        if (r.status === 'active' && r.round && r.round.status !== 'final') {
          const { rows: e } = await pool.query(
            'SELECT outcome, submitted_at FROM round_entries WHERE round_id = $1 AND player_id = $2',
            [r.round.id, r.player_id],
          );
          if (e[0] && r.round.status === 'planning' && !e[0].submitted_at) todo = 'submit';
          if (e[0] && r.round.status === 'live' && e[0].outcome === 'pending') todo = 'report';
        }
        const isAdmin = r.role === 'admin' && r.status === 'active';
        if (!todo && isAdmin && r.pending > 0) todo = 'requests';
        summaries.push({
          id: r.id,
          name: r.name,
          role: r.role,
          status: r.status,
          players: r.status === 'active' ? r.players ?? [] : [],
          round: r.status === 'active' ? r.round : null,
          todo,
          pendingRequests: isAdmin ? r.pending : 0,
        });
      }
      return summaries;
    },

    async create(user: User, input: { name?: unknown }) {
      const name = cleanName(input.name);
      return transaction(pool, async (c) => {
        const { rows } = await c.query('INSERT INTO games (name, invite_code) VALUES ($1, $2) RETURNING id', [name, newInviteCode()]);
        await c.query(`INSERT INTO players (game_id, user_id, name, role) VALUES ($1, $2, $3, 'admin')`, [rows[0].id, user.id, user.name]);
        return { id: rows[0].id as number };
      });
    },

    async lookupInvite(userId: number, code: string) {
      const { rows } = await pool.query(
        `SELECT g.id, g.name,
           (SELECT count(*)::int FROM players p WHERE p.game_id = g.id AND p.status = 'active') AS players,
           (SELECT status FROM players p WHERE p.game_id = g.id AND p.user_id = $2) AS my_status
         FROM games g WHERE g.invite_code = $1`,
        [code.trim().toUpperCase(), userId],
      );
      if (!rows[0]) throw new HttpError(404, 'invite_not_found');
      const r = rows[0];
      return { id: r.id as number, name: r.name as string, players: r.players as number, status: (r.my_status ?? null) as Player['status'] | null };
    },

    async requestJoin(user: User, code: string) {
      const { rows } = await pool.query('SELECT id FROM games WHERE invite_code = $1', [code.trim().toUpperCase()]);
      if (!rows[0]) throw new HttpError(404, 'invite_not_found');
      const gameId = rows[0].id as number;
      const existing = await pool.query<PlayerRow>('SELECT * FROM players WHERE game_id = $1 AND user_id = $2', [gameId, user.id]);
      const row = existing.rows[0];
      if (row?.status === 'active') return { id: gameId, status: 'active' as const };
      if (row?.status === 'pending') return { id: gameId, status: 'pending' as const };
      if (row?.status === 'removed') {
        await pool.query(`UPDATE players SET status = 'pending', role = 'player' WHERE id = $1`, [row.id]);
      } else {
        await pool.query(`INSERT INTO players (game_id, user_id, name, status) VALUES ($1, $2, $3, 'pending')`, [gameId, user.id, user.name]);
      }
      return { id: gameId, status: 'pending' as const };
    },

    async cancelRequest(userId: number, gameId: number) {
      await pool.query(`DELETE FROM players WHERE game_id = $1 AND user_id = $2 AND status = 'pending'`, [gameId, userId]);
    },

    async state(userId: number, gameId: number): Promise<GameState> {
      const me = await seat(pool, userId, gameId);
      const isAdmin = me.role === 'admin';
      const [game, players, rounds, entries, proofs, goals] = await Promise.all([
        pool.query('SELECT * FROM games WHERE id = $1', [gameId]),
        pool.query<PlayerRow>(
          `SELECT p.*, u.email FROM players p LEFT JOIN users u ON u.id = p.user_id
           WHERE p.game_id = $1 ORDER BY p.created_at, p.id`,
          [gameId],
        ),
        pool.query('SELECT * FROM rounds WHERE game_id = $1 ORDER BY start_date DESC, id DESC', [gameId]),
        pool.query(
          `SELECT e.*, p.user_id IS NULL AS is_guest
           FROM round_entries e JOIN rounds r ON r.id = e.round_id JOIN players p ON p.id = e.player_id
           WHERE r.game_id = $1 ORDER BY e.round_id, e.player_id`,
          [gameId],
        ),
        pool.query(
          `SELECT pr.id, pr.round_id, pr.player_id, pr.created_at
           FROM proofs pr JOIN rounds r ON r.id = pr.round_id WHERE r.game_id = $1 ORDER BY pr.id`,
          [gameId],
        ),
        pool.query(
          `SELECT g.* FROM entry_goals g JOIN rounds r ON r.id = g.round_id WHERE r.game_id = $1 ORDER BY g.position, g.id`,
          [gameId],
        ),
      ]);
      const goalsByEntry = new Map<string, Goal[]>();
      for (const g of goals.rows) {
        const key = `${g.round_id}:${g.player_id}`;
        if (!goalsByEntry.has(key)) goalsByEntry.set(key, []);
        goalsByEntry.get(key)!.push({ id: g.id, text: g.text, outcome: g.outcome });
      }
      const proofsByEntry = new Map<string, Proof[]>();
      for (const p of proofs.rows) {
        const key = `${p.round_id}:${p.player_id}`;
        if (!proofsByEntry.has(key)) proofsByEntry.set(key, []);
        proofsByEntry.get(key)!.push({ id: p.id, createdAt: p.created_at.toISOString() });
      }
      const roundStatus = new Map(rounds.rows.map((r) => [r.id, r.status as RoundStatus]));
      return {
        game: {
          id: game.rows[0].id,
          name: game.rows[0].name,
          inviteCode: isAdmin ? game.rows[0].invite_code : null,
          createdAt: game.rows[0].created_at.toISOString(),
        },
        me: { playerId: me.id, role: me.role },
        players: players.rows
          .filter((p) => p.status !== 'pending' || isAdmin)
          .map((p) => ({
            id: p.id,
            name: p.name,
            role: p.role,
            status: p.status,
            hasAccount: p.user_id != null,
            isMe: p.id === me.id,
            ...(isAdmin && p.status === 'pending' && p.email ? { email: p.email } : {}),
            joinedAt: p.created_at.toISOString(),
          })),
        rounds: rounds.rows.map(toRound),
        // Calls and bets stay secret until the round goes live — from admins too, except for
        // guests (no account), whose picks an admin enters on their behalf.
        entries: entries.rows.map((e) =>
          toEntry(
            e,
            roundStatus.get(e.round_id) === 'planning' && e.player_id !== me.id && !(isAdmin && e.is_guest),
            proofsByEntry.get(`${e.round_id}:${e.player_id}`),
            goalsByEntry.get(`${e.round_id}:${e.player_id}`),
          ),
        ),
      };
    },

    async update(userId: number, gameId: number, input: { name?: unknown; regenerateCode?: boolean }) {
      await seat(pool, userId, gameId, { admin: true });
      if (input.name !== undefined) await pool.query('UPDATE games SET name = $2 WHERE id = $1', [gameId, cleanName(input.name)]);
      if (input.regenerateCode) await pool.query('UPDATE games SET invite_code = $2 WHERE id = $1', [gameId, newInviteCode()]);
    },

    async remove(userId: number, gameId: number) {
      await seat(pool, userId, gameId, { admin: true });
      await pool.query('DELETE FROM games WHERE id = $1', [gameId]);
    },

    async addGuest(userId: number, gameId: number, input: { name?: unknown }) {
      await seat(pool, userId, gameId, { admin: true });
      const name = cleanName(input.name);
      return transaction(pool, async (c) => {
        const { rows } = await c.query('INSERT INTO players (game_id, name) VALUES ($1, $2) RETURNING id', [gameId, name]);
        await seatInPlanningRound(c, gameId, rows[0].id);
        return { id: rows[0].id as number };
      });
    },

    /**
     * Admin actions on a seat: approve/reject a join request (optionally taking over a guest's
     * history), change role, rename, remove or restore.
     */
    async updatePlayer(
      userId: number,
      gameId: number,
      playerId: number,
      input: { action?: string; role?: unknown; name?: unknown; guestId?: unknown },
    ) {
      await seat(pool, userId, gameId, { admin: true });
      return transaction(pool, async (c) => {
        const target = await playerInGame(c, gameId, playerId);
        switch (input.action) {
          case 'approve': {
            if (target.status !== 'pending') throw new HttpError(400, 'no_pending_request');
            if (input.guestId != null) {
              const guest = await playerInGame(c, gameId, Number(input.guestId));
              if (guest.user_id != null) throw new HttpError(400, 'guest_has_account');
              // The account takes over the guest seat and its history; the request row goes away.
              await c.query('DELETE FROM players WHERE id = $1', [target.id]);
              await c.query(`UPDATE players SET user_id = $2, status = 'active' WHERE id = $1`, [guest.id, target.user_id]);
              await seatInPlanningRound(c, gameId, guest.id);
              return { id: guest.id };
            }
            await c.query(`UPDATE players SET status = 'active' WHERE id = $1`, [target.id]);
            await seatInPlanningRound(c, gameId, target.id);
            return { id: target.id };
          }
          case 'reject':
            if (target.status !== 'pending') throw new HttpError(400, 'no_pending_request');
            await c.query('DELETE FROM players WHERE id = $1', [target.id]);
            return { id: target.id };
          case 'remove':
            if (target.role === 'admin' && target.user_id != null && (await adminCount(c, gameId)) <= 1) {
              throw new HttpError(400, 'last_admin_remove');
            }
            await c.query(`UPDATE players SET status = 'removed', role = 'player' WHERE id = $1`, [target.id]);
            // Drop them from a round that hasn't started; keep history.
            await c.query(
              `DELETE FROM round_entries e USING rounds r
               WHERE e.round_id = r.id AND r.game_id = $1 AND r.status = 'planning' AND e.player_id = $2`,
              [gameId, target.id],
            );
            return { id: target.id };
          case 'restore':
            if (target.status !== 'removed') throw new HttpError(400, 'player_not_removed');
            await c.query(`UPDATE players SET status = 'active' WHERE id = $1`, [target.id]);
            await seatInPlanningRound(c, gameId, target.id);
            return { id: target.id };
          case 'update': {
            if (input.name !== undefined) {
              await c.query('UPDATE players SET name = $2 WHERE id = $1', [target.id, cleanName(input.name)]);
            }
            if (input.role !== undefined) {
              const role = input.role === 'admin' ? 'admin' : 'player';
              if (role === 'admin' && (target.user_id == null || target.status !== 'active')) {
                throw new HttpError(400, 'admin_needs_account');
              }
              if (role === 'player' && target.role === 'admin' && (await adminCount(c, gameId)) <= 1) {
                throw new HttpError(400, 'last_admin_demote');
              }
              await c.query('UPDATE players SET role = $2 WHERE id = $1', [target.id, role]);
            }
            return { id: target.id };
          }
          default:
            throw new HttpError(400, 'unknown_action');
        }
      });
    },

    async leave(userId: number, gameId: number) {
      const me = await seat(pool, userId, gameId);
      if (me.role === 'admin' && (await adminCount(pool, gameId)) <= 1) {
        const { rows } = await pool.query(
          `SELECT count(*)::int AS n FROM players WHERE game_id = $1 AND status = 'active' AND user_id IS NOT NULL`,
          [gameId],
        );
        if (rows[0].n > 1) throw new HttpError(400, 'last_admin_leave');
      }
      await pool.query(`UPDATE players SET status = 'removed', role = 'player' WHERE id = $1`, [me.id]);
    },

    async createRound(userId: number, gameId: number, input: { startDate?: unknown; title?: unknown; deadline?: unknown }) {
      await seat(pool, userId, gameId, { admin: true });
      const startDate = String(input.startDate ?? '');
      if (!ISO_DATE.test(startDate)) throw new HttpError(400, 'invalid_date');
      const deadline = parseDeadline(input.deadline, startDate);
      return transaction(pool, async (c) => {
        const open = await c.query(`SELECT 1 FROM rounds WHERE game_id = $1 AND status <> 'final'`, [gameId]);
        if (open.rows.length) throw new HttpError(409, 'round_open');
        const { rows } = await c
          .query('INSERT INTO rounds (game_id, start_date, title, deadline) VALUES ($1, $2, $3, $4) RETURNING *', [
            gameId,
            startDate,
            String(input.title ?? '').trim(),
            deadline,
          ])
          .catch((err) => {
            if (err?.code === '23505') throw new HttpError(409, 'round_exists');
            friendly(err);
          });
        await c.query(
          `INSERT INTO round_entries (round_id, player_id)
           SELECT $1, id FROM players WHERE game_id = $2 AND status = 'active'`,
          [rows[0].id, gameId],
        );
        return toRound(rows[0]);
      });
    },

    async updateRound(userId: number, gameId: number, roundId: number, patch: RoundPatch) {
      const me = await seat(pool, userId, gameId);
      const round = await roundInGame(pool, gameId, roundId);
      const adminOnly =
        patch.status !== undefined || patch.title !== undefined || patch.startDate !== undefined || patch.deadline !== undefined;
      const deadline = patch.deadline !== undefined ? parseDeadline(patch.deadline, round.startDate) : null;
      if (adminOnly && me.role !== 'admin') throw new HttpError(403, 'admin_only');
      if (patch.status !== undefined && !ROUND_STATUSES.includes(patch.status)) throw new HttpError(400, 'invalid_status');
      if (patch.startDate !== undefined && !ISO_DATE.test(patch.startDate)) throw new HttpError(400, 'invalid_date');
      if (patch.status && patch.status !== 'final' && round.status === 'final') {
        const open = await pool.query(`SELECT 1 FROM rounds WHERE game_id = $1 AND status <> 'final' AND id <> $2`, [gameId, roundId]);
        if (open.rows.length) throw new HttpError(409, 'another_round_open');
      }
      // Notes are shared: any player can add context to the round.
      await pool
        .query(
          `UPDATE rounds SET
             title = COALESCE($3, title), notes = COALESCE($4, notes),
             status = COALESCE($5, status), start_date = COALESCE($6::date, start_date),
             deadline = COALESCE($7::timestamptz, deadline)
           WHERE id = $1 AND game_id = $2`,
          [
            roundId,
            gameId,
            patch.title?.trim() ?? null,
            patch.notes?.trim().slice(0, 8000) ?? null,
            patch.status ?? null,
            patch.startDate ?? null,
            deadline,
          ],
        )
        .catch(friendly);
    },

    async deleteRound(userId: number, gameId: number, roundId: number) {
      await seat(pool, userId, gameId, { admin: true });
      await roundInGame(pool, gameId, roundId);
      await pool.query('DELETE FROM rounds WHERE id = $1', [roundId]);
    },

    async updateEntry(userId: number, gameId: number, roundId: number, playerId: number, patch: EntryPatch) {
      const me = await seat(pool, userId, gameId);
      const round = await roundInGame(pool, gameId, roundId);
      const target = await playerInGame(pool, gameId, playerId);
      const isSelf = target.id === me.id;
      const fields = Object.keys(patch).filter(
        (k) => k in ENTRY_COLUMNS || k === 'submitted' || k === 'goals' || k === 'goalOutcomes',
      ) as EntryField[];

      for (const f of fields) {
        if (isSelf && SELF_EDITABLE[round.status].includes(f)) continue;
        // Admins can fix anything, except another account's secret picks before the reveal.
        // Guests have no account, so the admin plays their picks for them.
        const secret = round.status === 'planning' && !isSelf && target.user_id != null && (PICKS.includes(f) || f === 'submitted');
        if (me.role === 'admin' && !secret) continue;
        throw new HttpError(403, isSelf ? 'locked_phase' : 'own_entry_only');
      }

      // Validate plain columns up front, before anything is written.
      const sets: string[] = [];
      const values: unknown[] = [roundId, playerId];
      for (const f of fields) {
        if (f === 'goals' || f === 'goalOutcomes') continue;
        if (f === 'submitted') {
          sets.push(patch.submitted ? 'submitted_at = COALESCE(submitted_at, now())' : 'submitted_at = NULL');
          continue;
        }
        let value: unknown = patch[f];
        if (f === 'outcome') {
          if (!OUTCOMES.includes(value as Outcome)) throw new HttpError(400, 'invalid_outcome');
        } else if (f === 'excusePickId' || f === 'betPickId') {
          if (value != null) {
            const pick = await playerInGame(pool, gameId, Number(value));
            if (pick.id === playerId) throw new HttpError(400, 'self_pick');
            if (pick.status !== 'active') throw new HttpError(400, 'pick_not_playing');
            value = pick.id;
          } else value = null;
        } else {
          value = String(value ?? '').trim();
          if ((value as string).length > (LIMITS[f] ?? 1000)) throw new HttpError(400, 'too_long');
        }
        values.push(value);
        sets.push(`${ENTRY_COLUMNS[f as keyof typeof ENTRY_COLUMNS]} = $${values.length}`);
      }

      let goalList: { id?: number; text: string }[] | null = null;
      if (patch.goals !== undefined) {
        if (!Array.isArray(patch.goals)) throw new HttpError(400, 'invalid_json');
        goalList = patch.goals
          .map((g) => ({ id: g?.id == null ? undefined : Number(g.id), text: String(g?.text ?? '').trim() }))
          .filter((g) => g.text);
        if (goalList.length > MAX_GOALS) throw new HttpError(400, 'too_many_goals');
        if (goalList.some((g) => g.text.length > GOAL_MAX_LENGTH)) throw new HttpError(400, 'too_long');
      }
      let goalOutcomes: [number, Outcome][] = [];
      if (patch.goalOutcomes !== undefined) {
        if (typeof patch.goalOutcomes !== 'object' || patch.goalOutcomes === null) throw new HttpError(400, 'invalid_json');
        goalOutcomes = Object.entries(patch.goalOutcomes).map(([id, o]) => [Number(id), o as Outcome]);
        if (goalOutcomes.some(([, o]) => !OUTCOMES.includes(o))) throw new HttpError(400, 'invalid_outcome');
      }

      await transaction(pool, async (c) => {
        await c.query('INSERT INTO round_entries (round_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roundId, playerId]);
        const { rows: existing } = await c.query<{ id: number }>(
          'SELECT id FROM entry_goals WHERE round_id = $1 AND player_id = $2 FOR UPDATE',
          [roundId, playerId],
        );
        const existingIds = new Set(existing.map((g) => g.id));

        if (goalList) {
          // Keep ids (and their results) for goals that were edited; add new ones; drop the rest.
          const keep = new Set<number>();
          for (const [position, g] of goalList.entries()) {
            if (g.id != null && existingIds.has(g.id)) {
              keep.add(g.id);
              await c.query('UPDATE entry_goals SET text = $2, position = $3 WHERE id = $1', [g.id, g.text, position]);
            } else {
              const { rows } = await c.query(
                'INSERT INTO entry_goals (round_id, player_id, position, text) VALUES ($1, $2, $3, $4) RETURNING id',
                [roundId, playerId, position, g.text],
              );
              keep.add(rows[0].id);
            }
          }
          const drop = [...existingIds].filter((id) => !keep.has(id));
          if (drop.length) await c.query('DELETE FROM entry_goals WHERE id = ANY($1::int[])', [drop]);
          existingIds.clear();
          keep.forEach((id) => existingIds.add(id));
        }

        for (const [id, outcome] of goalOutcomes) {
          if (!existingIds.has(id)) throw new HttpError(404, 'goal_not_found');
          await c.query('UPDATE entry_goals SET outcome = $2 WHERE id = $1', [id, outcome]);
        }

        if (patch.outcome !== undefined && existingIds.size > 0) throw new HttpError(400, 'outcome_from_goals');
        if (patch.submitted && existingIds.size === 0) throw new HttpError(400, 'goal_required');

        if (sets.length) {
          await c.query(`UPDATE round_entries SET ${sets.join(', ')} WHERE round_id = $1 AND player_id = $2`, values);
        }
        // The week's result follows the goals.
        if (existingIds.size > 0 && (goalList || goalOutcomes.length)) {
          const { rows: g } = await c.query<{ outcome: Outcome }>(
            'SELECT outcome FROM entry_goals WHERE round_id = $1 AND player_id = $2',
            [roundId, playerId],
          );
          await c.query('UPDATE round_entries SET outcome = $3 WHERE round_id = $1 AND player_id = $2', [
            roundId,
            playerId,
            combineOutcomes(g.map((x) => x.outcome)),
          ]);
        }
      });
    },

    /** Attach a photo to an entry. The player themselves, or an admin, once the week has started. */
    async addProof(user: User, gameId: number, roundId: number, playerId: number, bytes: Buffer): Promise<Proof> {
      const me = await seat(pool, user.id, gameId);
      const round = await roundInGame(pool, gameId, roundId);
      const target = await playerInGame(pool, gameId, playerId);
      if (target.id !== me.id && me.role !== 'admin') throw new HttpError(403, 'own_entry_only');
      if (round.status === 'planning') throw new HttpError(400, 'proof_phase');
      if (bytes.length > PROOF_MAX_BYTES) throw new HttpError(413, 'proof_too_large');
      const mime = sniffImage(bytes);
      if (!mime) throw new HttpError(415, 'proof_not_image');
      return transaction(pool, async (c) => {
        const entry = await c.query('SELECT 1 FROM round_entries WHERE round_id = $1 AND player_id = $2 FOR UPDATE', [roundId, playerId]);
        if (!entry.rows.length) throw new HttpError(404, 'player_not_found');
        const { rows: count } = await c.query('SELECT count(*)::int AS n FROM proofs WHERE round_id = $1 AND player_id = $2', [roundId, playerId]);
        if (count[0].n >= PROOFS_PER_ENTRY) throw new HttpError(400, 'proof_limit');
        const { rows } = await c.query(
          'INSERT INTO proofs (round_id, player_id, uploaded_by, mime, bytes) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at',
          [roundId, playerId, user.id, mime, bytes],
        );
        return { id: rows[0].id, createdAt: rows[0].created_at.toISOString() };
      });
    },

    /** A proof's bytes, for anyone seated in its game. */
    async proof(userId: number, proofId: number) {
      const { rows } = await pool.query(
        `SELECT pr.mime, pr.bytes, r.game_id FROM proofs pr JOIN rounds r ON r.id = pr.round_id WHERE pr.id = $1`,
        [proofId],
      );
      if (!rows[0]) throw new HttpError(404, 'proof_not_found');
      await seat(pool, userId, rows[0].game_id).catch(() => {
        throw new HttpError(404, 'proof_not_found');
      });
      return { mime: rows[0].mime as string, bytes: rows[0].bytes as Buffer };
    },

    async deleteProof(userId: number, proofId: number) {
      const { rows } = await pool.query(
        `SELECT pr.player_id, pr.uploaded_by, r.game_id FROM proofs pr JOIN rounds r ON r.id = pr.round_id WHERE pr.id = $1`,
        [proofId],
      );
      if (!rows[0]) throw new HttpError(404, 'proof_not_found');
      const me = await seat(pool, userId, rows[0].game_id).catch(() => {
        throw new HttpError(404, 'proof_not_found');
      });
      const allowed = me.role === 'admin' || me.id === rows[0].player_id || rows[0].uploaded_by === userId;
      if (!allowed) throw new HttpError(403, 'own_entry_only');
      await pool.query('DELETE FROM proofs WHERE id = $1', [proofId]);
    },

    async removeEntry(userId: number, gameId: number, roundId: number, playerId: number) {
      await seat(pool, userId, gameId, { admin: true });
      await roundInGame(pool, gameId, roundId);
      await pool.query('DELETE FROM round_entries WHERE round_id = $1 AND player_id = $2', [roundId, playerId]);
    },

    /**
     * Import a round posted in the WhatsApp group. Unknown names become guest players.
     * The message is posted once everyone has committed, so the round starts live.
     */
    async importRound(
      userId: number,
      gameId: number,
      input: {
        startDate?: unknown;
        title?: unknown;
        rows?: { name: string; goals?: string[]; excuseTarget?: string; excuseReason?: string; betTarget?: string; betReason?: string }[];
        deadline?: unknown;
      },
    ) {
      await seat(pool, userId, gameId, { admin: true });
      const startDate = String(input.startDate ?? '');
      if (!ISO_DATE.test(startDate)) throw new HttpError(400, 'invalid_date');
      const rows = Array.isArray(input.rows) ? input.rows.filter((r) => r?.name?.trim()) : [];
      if (!rows.length) throw new HttpError(400, 'nothing_to_import');
      const deadline = parseDeadline(input.deadline, startDate);
      const goalsOf = (r: (typeof rows)[number]) =>
        (Array.isArray(r.goals) ? r.goals : []).map((g) => String(g ?? '').trim().slice(0, GOAL_MAX_LENGTH)).filter(Boolean).slice(0, MAX_GOALS);

      return transaction(pool, async (c) => {
        const open = await c.query(`SELECT 1 FROM rounds WHERE game_id = $1 AND status <> 'final'`, [gameId]);
        if (open.rows.length) throw new HttpError(409, 'round_open');

        const { rows: existing } = await c.query<PlayerRow>(`SELECT * FROM players WHERE game_id = $1 AND status <> 'pending'`, [gameId]);
        const ids = new Map(existing.map((p) => [p.name, p.id]));
        const idFor = async (name: string) => {
          const n = cleanName(name);
          if (!ids.has(n)) {
            const { rows: r } = await c.query('INSERT INTO players (game_id, name) VALUES ($1, $2) RETURNING id', [gameId, n]);
            ids.set(n, r[0].id);
          }
          return ids.get(n)!;
        };
        // Participants first so seats follow the message order.
        for (const r of rows) await idFor(r.name);

        const { rows: round } = await c
          .query(`INSERT INTO rounds (game_id, start_date, title, status, deadline) VALUES ($1, $2, $3, 'live', $4) RETURNING *`, [
            gameId,
            startDate,
            String(input.title ?? '').trim(),
            deadline,
          ])
          .catch((err) => {
            if (err?.code === '23505') throw new HttpError(409, 'round_exists');
            friendly(err);
          });
        for (const r of rows) {
          const pid = await idFor(r.name);
          const excuse = r.excuseTarget?.trim() ? await idFor(r.excuseTarget) : null;
          const bet = r.betTarget?.trim() ? await idFor(r.betTarget) : null;
          const inserted = await c.query(
            `INSERT INTO round_entries (round_id, player_id, excuse_pick_id, excuse_reason, bet_pick_id, bet_reason, submitted_at)
             VALUES ($1, $2, $3, $4, $5, $6, now())
             ON CONFLICT (round_id, player_id) DO NOTHING`,
            [
              round[0].id,
              pid,
              excuse === pid ? null : excuse,
              String(r.excuseReason ?? '').trim(),
              bet === pid ? null : bet,
              String(r.betReason ?? '').trim(),
            ],
          );
          if (!inserted.rowCount) continue; // the same name twice: keep the first
          for (const [position, text] of goalsOf(r).entries()) {
            await c.query('INSERT INTO entry_goals (round_id, player_id, position, text) VALUES ($1, $2, $3, $4)', [
              round[0].id,
              pid,
              position,
              text,
            ]);
          }
        }
        return toRound(round[0]);
      });
    },
  };
}

export type GameService = ReturnType<typeof gameService>;
