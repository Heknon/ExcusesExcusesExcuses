# Excuses Excuses Excuses

A weekly game for a group of friends, built around the way the group plays it sitting together.
Each round (one week) goes through four phases:

1. **Goals:** everyone shares one to five goals for the week. Goals are visible to everyone as they're written.
2. **Bets:** once everyone knows each other's goals, each player picks **who'll come back with excuses**
   and **who'll have the most impressive week**, each with a reason. Picks stay secret until the admin reveals them.
3. **The week:** bets are revealed. Everyone reports each goal (done, partly or missed), adds an excuse
   or proof if they like, and casts a secret vote for **the most impressive week**.
4. **Final:** the round is scored and the votes are revealed.

A week's result comes from its goals: all done → done, all missed → missed, anything in between → partly.
Each round has a deadline the admin sets (by default the end of the week), with a countdown for everyone.

## How it works

- **Accounts:** sign up with email and password. Sessions are HttpOnly cookies and passwords are hashed with scrypt.
- **Games:** anyone can create a game and becomes its admin. Share the invite link (or 6-character code).
  People who open it ask to join, and an admin lets them in or declines.
- **Guests:** admins can add players who don't have an account yet and play their moves for them. When that
  person signs up and asks to join, the admin can let them in *as* the guest. The account takes over the
  seat and all its history.
- **Rounds:** the admin moves each round through goals → bets → the week → final, and can step back if needed.
- **History:** every round stays browsable. Each player has a profile with their full record: goals,
  outcomes, excuses, notes, and who doubted or backed them and why. Search covers everything.
- **Standings:** points, delivery rate, how often your reads are right, streaks, and a round-by-round grid.
- **Proof:** once the week starts, players can attach up to 6 photos to their entry (optional). Photos are
  shrunk and re-encoded to JPEG on the phone before upload, which also strips location metadata. The server
  checks the file is really an image and only serves it to players in the same game.
- **English and Hebrew:** full right-to-left layout in Hebrew, with Heebo for text and Rubik for headings.
  The language follows the browser until you pick one; the choice is saved to your account.
- **Phones first:** on small screens the game tabs move to a bottom navigation bar and dialogs open as
  bottom sheets.
- **WhatsApp import:** admins can paste a round posted in the group (`*ביצועים*`, `*מי תירוצים*`,
  `*מי יהיה ביצועים (הימורים)*`) to bring in past rounds. New names become guests.

### Scoring

| | points |
|---|---|
| goals done | 3 |
| goals partly done | 1 |
| goals missed | 0 |
| called excuses on someone who then missed | +1 |
| bet on the player the group voted most impressive | +1 |
| voted most impressive by the group (ties share it) | +2 |

Rounds from before voting existed keep the older bet rule (the pick delivered).
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
