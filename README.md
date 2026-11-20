# Excuses Excuses Excuses

A weekly game for a group of friends. Every round (one week), each player:

1. **Commits** to a goal for the week.
2. **Calls excuses** on one player they think won't deliver.
3. **Bets** on one player they think will.

Calls and bets are secret until the admin starts the week. At the end of the week everyone reports how it
went (done, partly, missed) along with their excuse, and the round is scored.

Over time the game builds into a record of what everyone set out to do, what happened, and how well the
group reads each other.

## How it works

- **Accounts:** sign up with email and password. Sessions are HttpOnly cookies and passwords are hashed with scrypt.
- **Games:** anyone can create a game and becomes its admin. Share the invite link (or 6-character code).
  People who open it ask to join, and an admin lets them in or declines.
- **Guests:** admins can add players who don't have an account yet and play their moves for them. When that
  person signs up and asks to join, the admin can let them in *as* the guest. The account takes over the
  seat and all its history.
- **Rounds:** *Planning* (players lock in a goal, call and bet; picks hidden) → *In progress* (picks revealed;
  players report results and excuses) → *Final* (scored). The admin moves the round between phases.
- **History:** every round stays browsable. Each player has a profile with their full record: goals,
  outcomes, excuses, notes, and who doubted or backed them and why. Search covers everything.
- **Standings:** points, delivery rate, how often your reads are right, streaks, and a round-by-round grid.
- **WhatsApp import:** admins can paste a round posted in the group (`*ביצועים*`, `*מי תירוצים*`,
  `*מי יהיה ביצועים (הימורים)*`) to bring in past rounds. New names become guests.

### Scoring

| | points |
|---|---|
| goal done | 3 |
| goal partly done | 1 |
| goal missed | 0 |
| called excuses on someone who then missed | +1 |
| bet on someone who then delivered | +1 |

Change the numbers in `shared/scoring.ts`. Standings count scored (final) rounds only.

## Running

Requires **Node 22.18+** (runs the TypeScript server directly, no build step) and **Postgres** (any recent version; tested on 16).
The schema is created automatically on startup.

```bash
docker compose up -d db                     # or use your own Postgres
cp .env.example .env                        # DATABASE_URL=...
npm install
npm run dev                                 # API on :3000 + UI on :5173 (reads .env)

npm test                                    # parser + scoring tests
TEST_DATABASE_URL=postgres://… npm test     # + end-to-end API tests on Postgres (throwaway schema)

npm run build && npm start                  # production, serves everything on :3000
```

Environment variables:

| var | default | |
|---|---|---|
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgres://localhost:5432/excuses` | add `?sslmode=require` for hosted Postgres that needs TLS |

### Deploying

Everything in one go (app + Postgres): `docker compose up --build`.

Or run the image anywhere and point it at a managed Postgres (Neon, Supabase, Railway, Render, RDS…):

```bash
docker build -t excuses .
docker run -p 3000:3000 -e DATABASE_URL='postgres://user:pass@host/db?sslmode=require' excuses
```

## Layout

```
shared/   types, scoring, search, WhatsApp parser/formatter (used by client, server and tests)
server/   node:http API — auth.ts (accounts, sessions), games.ts (games, players, rounds, permissions), db.ts (schema)
src/      React UI — pages/ per screen, ui.tsx (components), session.tsx (data), router.tsx
tests/    node:test suites; api.test.ts drives the whole game over HTTP
```

Upgrading from the pre-accounts version: the old `members`, `weeks` and `entries` tables are no longer
used and can be dropped. To keep that history, paste the rounds through *Settings → Import from WhatsApp*.
