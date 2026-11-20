# Excuses Excuses Excuses

A weekly accountability log for a small group. Each week, every member writes down:

- **Goal** — what they commit to doing that week
- **Excuse call** — who they think won't deliver, and why
- **Bet** — who they think will deliver, and why

At the end of the week each goal is marked *done*, *partial* or *missed*, with the excuse if there was one.
Over time it builds into a record of what everyone set out to do, what actually happened, and how well
the group reads each other.

## What's in it

- **Weeks** — the current week is the working page: goals, predictions, outcomes, excuses and notes, all
  edited in place. Past weeks stay browsable; closing a week locks goals and outcomes but notes stay editable.
- **People** — one page per person with their full history: every goal, outcome and excuse, the calls and
  bets they made (and whether they were right), and what others predicted about them and why.
- **Search** — across every goal, excuse, reason and note. Add a name to narrow it: `אלי ריצה`.
- **Standings** — points, completion rate, prediction accuracy, and a week-by-week grid.
- **WhatsApp import/export** — paste the group's message (`*ביצועים*`, `*מי תירוצים*`,
  `*מי יהיה ביצועים (הימורים)*`, lines like `* name - text`) and review before saving; copy any week back
  out in the same format.

### Scoring

| | points |
|---|---|
| goal done | 3 |
| goal half done | 1 |
| excuses | 0 |
| correctly predicted who'd make excuses | +1 |
| correctly bet on someone who delivered | +1 |

Change the numbers in `shared/scoring.ts`.

## Running

Requires **Node 22.18+** (runs the TypeScript server directly, no build step) and **Postgres** (any recent version; tested on 16).
The schema is created automatically on startup.

```bash
docker compose up -d db                     # or use your own Postgres
cp .env.example .env                        # DATABASE_URL=...
npm install
npm run dev                                 # API on :3000 + UI on :5173 (reads .env)

npm test                                    # parser + scoring tests
TEST_DATABASE_URL=postgres://… npm test     # + Postgres integration tests (uses a throwaway schema)

npm run build && npm start                  # production, serves everything on :3000
```

Environment variables:

| var | default | |
|---|---|---|
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgres://localhost:5432/excuses` | add `?sslmode=require` for hosted Postgres that needs TLS |
| `TEAM_PASSCODE` | *(none)* | if set, the app asks for it once per device |

### Deploying

Everything in one go (app + Postgres): `docker compose up --build`.

Or run the image anywhere and point it at a managed Postgres (Neon, Supabase, Railway, Render, RDS…):

```bash
docker build -t excuses .
docker run -p 3000:3000 -e DATABASE_URL='postgres://user:pass@host/db?sslmode=require' -e TEAM_PASSCODE=secret excuses
```

## Layout

```
shared/   types, WhatsApp parser/formatter, scoring (used by client, server and tests)
server/   node:http API + Postgres (pg)
src/      React UI (RTL Hebrew)
tests/    node:test suites
```
