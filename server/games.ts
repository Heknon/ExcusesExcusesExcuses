import { randomInt } from 'node:crypto';
import {
  OUTCOMES,
  ROUND_STATUSES,
  type Entry,
  type EntryPatch,
  type GameState,
  type GameSummary,
  type Player,
  type Role,
  type Round,
  type RoundPatch,
  type RoundStatus,
  type User,
} from '../shared/types.ts';
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

const toRound = (r: any): Round => ({ id: r.id, startDate: r.start_date, title: r.title, notes: r.notes, status: r.status });

function toEntry(r: any, hidden: boolean): Entry {
  return {
    roundId: r.round_id,
    playerId: r.player_id,
    goal: r.goal,
    outcome: r.outcome,
    excuse: r.excuse,
    notes: r.notes,
    excusePickId: hidden ? null : r.excuse_pick_id,
    excuseReason: hidden ? '' : r.excuse_reason,
    betPickId: hidden ? null : r.bet_pick_id,
    betReason: hidden ? '' : r.bet_reason,
    submitted: r.submitted_at != null,
    hidden,
  };
}

const ENTRY_COLUMNS = {
  goal: 'goal',
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
  planning: ['goal', ...PICKS, 'submitted', 'notes'],
  live: ['outcome', 'excuse', 'notes'],
  final: ['notes'],
};

const LIMITS: Partial<Record<EntryField, number>> = {
  goal: 500,
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
    if (!me || me.status === 'removed') throw new HttpError(404, 'Game not found');
    if (me.status === 'pending') throw new HttpError(403, 'Your request to join is waiting for approval');
    if (opts.admin && me.role !== 'admin') throw new HttpError(403, 'Only admins can do that');
    return me;
  }

  async function roundInGame(q: Queryable, gameId: number, roundId: number): Promise<Round> {
    const { rows } = await q.query('SELECT * FROM rounds WHERE id = $1 AND game_id = $2', [roundId, gameId]);
    if (!rows[0]) throw new HttpError(404, 'Round not found');
    return toRound(rows[0]);
  }

  async function playerInGame(q: Queryable, gameId: number, playerId: number): Promise<PlayerRow> {
    const { rows } = await q.query<PlayerRow>('SELECT * FROM players WHERE id = $1 AND game_id = $2', [playerId, gameId]);
    if (!rows[0]) throw new HttpError(404, 'Player not found');
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
    if (!n) throw new HttpError(400, 'Name is required');
    if (n.length > 40) throw new HttpError(400, 'Name is too long');
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
      if (!rows[0]) throw new HttpError(404, 'That invite code doesn’t match any game');
      const r = rows[0];
      return { id: r.id as number, name: r.name as string, players: r.players as number, status: (r.my_status ?? null) as Player['status'] | null };
    },

    async requestJoin(user: User, code: string) {
      const { rows } = await pool.query('SELECT id FROM games WHERE invite_code = $1', [code.trim().toUpperCase()]);
      if (!rows[0]) throw new HttpError(404, 'That invite code doesn’t match any game');
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
      const [game, players, rounds, entries] = await Promise.all([
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
      ]);
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
          toEntry(e, roundStatus.get(e.round_id) === 'planning' && e.player_id !== me.id && !(isAdmin && e.is_guest)),
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
            if (target.status !== 'pending') throw new HttpError(400, 'No pending request');
            if (input.guestId != null) {
              const guest = await playerInGame(c, gameId, Number(input.guestId));
              if (guest.user_id != null) throw new HttpError(400, 'That player already has an account');
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
            if (target.status !== 'pending') throw new HttpError(400, 'No pending request');
            await c.query('DELETE FROM players WHERE id = $1', [target.id]);
            return { id: target.id };
          case 'remove':
            if (target.role === 'admin' && target.user_id != null && (await adminCount(c, gameId)) <= 1) {
              throw new HttpError(400, 'Make someone else an admin first');
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
            if (target.status !== 'removed') throw new HttpError(400, 'Player isn’t removed');
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
                throw new HttpError(400, 'Only active players with an account can be admins');
              }
              if (role === 'player' && target.role === 'admin' && (await adminCount(c, gameId)) <= 1) {
                throw new HttpError(400, 'A game needs at least one admin');
              }
              await c.query('UPDATE players SET role = $2 WHERE id = $1', [target.id, role]);
            }
            return { id: target.id };
          }
          default:
            throw new HttpError(400, 'Unknown action');
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
        if (rows[0].n > 1) throw new HttpError(400, 'You’re the only admin. Make someone else an admin before leaving.');
      }
      await pool.query(`UPDATE players SET status = 'removed', role = 'player' WHERE id = $1`, [me.id]);
    },

    async createRound(userId: number, gameId: number, input: { startDate?: unknown; title?: unknown }) {
      await seat(pool, userId, gameId, { admin: true });
      const startDate = String(input.startDate ?? '');
      if (!ISO_DATE.test(startDate)) throw new HttpError(400, 'startDate must be YYYY-MM-DD');
      return transaction(pool, async (c) => {
        const open = await c.query(`SELECT 1 FROM rounds WHERE game_id = $1 AND status <> 'final'`, [gameId]);
        if (open.rows.length) throw new HttpError(409, 'Finish the current round before starting a new one');
        const { rows } = await c
          .query('INSERT INTO rounds (game_id, start_date, title) VALUES ($1, $2, $3) RETURNING *', [
            gameId,
            startDate,
            String(input.title ?? '').trim(),
          ])
          .catch((err) => {
            if (err?.code === '23505') throw new HttpError(409, 'There’s already a round for that week');
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
      const adminOnly = patch.status !== undefined || patch.title !== undefined || patch.startDate !== undefined;
      if (adminOnly && me.role !== 'admin') throw new HttpError(403, 'Only admins can do that');
      if (patch.status !== undefined && !ROUND_STATUSES.includes(patch.status)) throw new HttpError(400, 'Invalid status');
      if (patch.startDate !== undefined && !ISO_DATE.test(patch.startDate)) throw new HttpError(400, 'Invalid date');
      if (patch.status && patch.status !== 'final' && round.status === 'final') {
        const open = await pool.query(`SELECT 1 FROM rounds WHERE game_id = $1 AND status <> 'final' AND id <> $2`, [gameId, roundId]);
        if (open.rows.length) throw new HttpError(409, 'Another round is already open');
      }
      // Notes are shared: any player can add context to the round.
      await pool
        .query(
          `UPDATE rounds SET
             title = COALESCE($3, title), notes = COALESCE($4, notes),
             status = COALESCE($5, status), start_date = COALESCE($6::date, start_date)
           WHERE id = $1 AND game_id = $2`,
          [roundId, gameId, patch.title?.trim() ?? null, patch.notes?.trim().slice(0, 8000) ?? null, patch.status ?? null, patch.startDate ?? null],
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
      const fields = Object.keys(patch).filter((k) => k in ENTRY_COLUMNS || k === 'submitted') as EntryField[];

      for (const f of fields) {
        if (isSelf && SELF_EDITABLE[round.status].includes(f)) continue;
        // Admins can fix anything, except another account's secret picks before the reveal.
        // Guests have no account, so the admin plays their picks for them.
        const secret = round.status === 'planning' && !isSelf && target.user_id != null && (PICKS.includes(f) || f === 'submitted');
        if (me.role === 'admin' && !secret) continue;
        throw new HttpError(403, isSelf ? 'That can’t be changed at this stage of the round' : 'You can only edit your own entry');
      }

      const sets: string[] = [];
      const values: unknown[] = [roundId, playerId];
      for (const f of fields) {
        if (f === 'submitted') {
          sets.push(patch.submitted ? 'submitted_at = COALESCE(submitted_at, now())' : 'submitted_at = NULL');
          continue;
        }
        let value: unknown = patch[f];
        if (f === 'outcome') {
          if (!OUTCOMES.includes(value as any)) throw new HttpError(400, 'Invalid outcome');
        } else if (f === 'excusePickId' || f === 'betPickId') {
          if (value != null) {
            const pick = await playerInGame(pool, gameId, Number(value));
            if (pick.id === playerId) throw new HttpError(400, 'You can’t pick yourself');
            if (pick.status !== 'active') throw new HttpError(400, 'That player isn’t in the game');
            value = pick.id;
          } else value = null;
        } else {
          value = String(value ?? '').trim();
          if ((value as string).length > (LIMITS[f] ?? 1000)) throw new HttpError(400, 'That’s too long');
        }
        values.push(value);
        sets.push(`${ENTRY_COLUMNS[f as keyof typeof ENTRY_COLUMNS]} = $${values.length}`);
      }
      if (!sets.length) return;

      await transaction(pool, async (c) => {
        await c.query('INSERT INTO round_entries (round_id, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roundId, playerId]);
        await c.query(`UPDATE round_entries SET ${sets.join(', ')} WHERE round_id = $1 AND player_id = $2`, values);
      });
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
        rows?: { name: string; goal?: string; excuseTarget?: string; excuseReason?: string; betTarget?: string; betReason?: string }[];
      },
    ) {
      await seat(pool, userId, gameId, { admin: true });
      const startDate = String(input.startDate ?? '');
      if (!ISO_DATE.test(startDate)) throw new HttpError(400, 'startDate must be YYYY-MM-DD');
      const rows = Array.isArray(input.rows) ? input.rows.filter((r) => r?.name?.trim()) : [];
      if (!rows.length) throw new HttpError(400, 'Nothing to import');

      return transaction(pool, async (c) => {
        const open = await c.query(`SELECT 1 FROM rounds WHERE game_id = $1 AND status <> 'final'`, [gameId]);
        if (open.rows.length) throw new HttpError(409, 'Finish the current round before importing another');

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
          .query(`INSERT INTO rounds (game_id, start_date, title, status) VALUES ($1, $2, $3, 'live') RETURNING *`, [
            gameId,
            startDate,
            String(input.title ?? '').trim(),
          ])
          .catch((err) => {
            if (err?.code === '23505') throw new HttpError(409, 'There’s already a round for that week');
            friendly(err);
          });
        for (const r of rows) {
          const pid = await idFor(r.name);
          const excuse = r.excuseTarget?.trim() ? await idFor(r.excuseTarget) : null;
          const bet = r.betTarget?.trim() ? await idFor(r.betTarget) : null;
          await c.query(
            `INSERT INTO round_entries (round_id, player_id, goal, excuse_pick_id, excuse_reason, bet_pick_id, bet_reason, submitted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())
             ON CONFLICT (round_id, player_id) DO NOTHING`,
            [
              round[0].id,
              pid,
              String(r.goal ?? '').trim(),
              excuse === pid ? null : excuse,
              String(r.excuseReason ?? '').trim(),
              bet === pid ? null : bet,
              String(r.betReason ?? '').trim(),
            ],
          );
        }
        return toRound(round[0]);
      });
    },
  };
}

export type GameService = ReturnType<typeof gameService>;
