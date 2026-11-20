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

- **Accounts:** sign in with Google (Auth.js). Only verified Google emails are accepted; an existing account with the
  same email is the one you sign in to. Sessions are encrypted HttpOnly cookies.
- **Games:** anyone can create a game and becomes its admin. Share the invite link (or 6-character code).
  People who open it ask to join, and an admin lets them in or declines.
- **Guests:** admins can add players who don't have an account yet and play their moves for them. When that
  person signs in and asks to join, the admin can let them in *as* the guest. The account takes over the
  seat and all its history.
- **Rounds:** the admin moves each round through goals → bets → the week → final, and can step back if needed.
- **History:** every round stays browsable. Each player has a profile with their full record: goals,
  outcomes, excuses, notes, and who doubted or backed them and why. Search covers everything.
- **Standings:** points, delivery rate, how often your reads are right, streaks, and a round-by-round grid.
- **Proof:** once the week starts, players can attach up to 6 photos to their entry (optional). Photos are
  shrunk and re-encoded to JPEG on the phone, which also strips location metadata, then uploaded straight to S3
  through a presigned URL. The server checks the upload is really an image by its bytes and hands out short-lived
  links to it only to players in the same game.
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

## Running locally

Requires **Bun 1.4.4** (`packageManager` in `package.json`), **Postgres** and an S3-compatible store for photos.
`docker-compose.yml` has both: Postgres 16 and SeaweedFS.

```bash
docker compose up -d db s3 s3-bucket        # or use your own Postgres and S3
cp .env.example .env                        # fill in DATABASE_URL, AUTH_*, S3_* (values for compose are in the comments)
bun install
bun run dev                                 # API on :3000 + UI on :5173; migrations run on start

bun run check                               # typecheck + unit tests, no database
bun run test:full                           # + end-to-end API tests on Postgres (TEST_DATABASE_URL, or the compose db)

bun run build && bun run start              # production build, serves everything on :3000
```

Every variable the app reads is listed, with what it's for, in `.env.example`.

**Google sign-in locally:** create an OAuth client (Web application) and add
`http://localhost:5173/api/auth/callback/google` (and `:3000` if you run the built app) as redirect URIs.
Or pull the dev environment's values, which sign in through the dev deployment:

```bash
bunx vercel env pull .env.local --environment=preview --git-branch=dev
```

Then remove `AUTH_URL` from `.env.local` so the app uses your local origin. Those values also point
the app at the dev database and the dev bucket.

**Schema:** migrations live in `server/db.ts` (`MIGRATIONS`) and are recorded in `schema_migrations`.
`bun run db:migrate:deploy` applies pending ones; it uses `DATABASE_URL_UNPOOLED` when set. Each migration runs
before the code that needs it is live, so it must keep the previous version working. Never edit one that shipped.

**Photos stored in the database** (from before photos moved to S3) keep being served from there. To move them:
`bun scripts/move-proofs-to-s3.ts` with the target's `DATABASE_URL` and `S3_*` set. It is safe to re-run.

### Deploying

Deploys go through [project-kit](https://github.com/Heknon/project-kit): `.github/workflows/preview.yml`
deploys every pull request to its own preview (with its own database branch and `S3_PREFIX`), and
`.github/workflows/deploy.yml` deploys `dev` on push and production from `master`. Vercel's Git integration is off
(`vercel.json`); the workflows run `vercel build` (`bun run build:vercel`: the site as static files, the API as
one Node function) and deploy the prebuilt output. Migrations (`db:migrate:deploy`) run before each deploy,
`check` on previews and dev, `test:full` before production.

The kit sets every variable on Vercel: the database URLs, `S3_*` (the function gets AWS credentials from its
Vercel OIDC token and `S3_ROLE_ARN`; there are no access keys), and `AUTH_*`. Previews sign in with Google
through the dev deployment (`AUTH_REDIRECT_PROXY_URL`).

The Docker image still runs anywhere with a Postgres and an S3 bucket:

```bash
docker build -t excuses .
docker run -p 3000:3000 --env-file .env excuses
```

## Layout

```
shared/   types, scoring, search, WhatsApp parser/formatter (used by client, server and tests)
server/   node:http API — auth.ts (Google sign-in via Auth.js), games.ts (games, players, rounds, permissions),
          db.ts (pool, migrations), storage.ts (S3 photos), vercel.ts (Vercel function)
scripts/  migrations, full test run, Vercel build output, one-off photo move
src/      React UI — pages/ per screen, ui.tsx (components), session.tsx (data), router.tsx
tests/    node:test suites, run by bun test; api.test.ts drives the whole game over HTTP
```

Upgrading from the pre-accounts version: the old `members`, `weeks` and `entries` tables are no longer
used and can be dropped. To keep that history, paste the rounds through *Settings → Import from WhatsApp*.
