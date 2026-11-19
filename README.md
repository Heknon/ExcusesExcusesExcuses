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
- Shared by the whole team: one small server, data in SQLite. Optional team passcode.

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

Requires **Node 22.18+** (uses built-in TypeScript stripping and `node:sqlite`, so the server has zero runtime dependencies).

```bash
npm install
npm run dev        # API on :3000 + Vite on :5173
npm test           # parser + scoring tests
npm run build && npm start   # production, serves everything on :3000
```

Environment variables:

| var | default | |
|---|---|---|
| `PORT` | `3000` | |
| `DB_FILE` | `data/excuses.db` | SQLite file — put it on a persistent disk |
| `TEAM_PASSCODE` | *(none)* | if set, the app asks for it once per device |

### Deploying

Any host that runs a Docker container with a persistent volume works (Fly.io, Railway, Render, a VPS):

```bash
docker build -t excuses .
docker run -p 3000:3000 -v excuses-data:/data -e TEAM_PASSCODE=secret excuses
```

## Layout

```
shared/   types, WhatsApp parser/formatter, scoring (used by client, server and tests)
server/   node:http API + SQLite
src/      React UI (RTL Hebrew)
tests/    node:test suites
```
