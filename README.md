# Excuses Excuses Excuses

**א ביצועים · א תירוצים · א הימורים** — a weekly accountability game for the team.

Every week, each member posts:

| | |
|---|---|
| **ביצועים** | what they commit to doing this week |
| **תירוצים** | who they think will come back with excuses, and why |
| **הימורים** | who they bet will actually deliver, and why |

At the end of the week you mark each goal ✅ done / 🤏 partial / 🙄 excuses (and record the excuse for the hall of fame), and the leaderboard tallies it up.

## Features

- **Import from WhatsApp** – paste the group message as-is (`*ביצועים*`, `*מי תירוצים*`, `*מי יהיה ביצועים (הימורים)*`, lines like `* מייקל - …`). Members, goals, picks and reasons are parsed, and you can fix anything in a preview before saving.
- **Copy back to WhatsApp** – one button produces the formatted message for the group.
- **Week view** with a tab per section, inline editing, and a tally of who's most doubted / most backed.
- **Results** per member, showing who doubted and who backed them.
- **Leaderboard** with points, prediction accuracy, streaks, awards (מלך הביצועים, מלך התירוצים, הנביא…) and the **היכל התירוצים**.
- Shared by the whole team: one small Node server backed by **Postgres**. Optional team passcode.

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
