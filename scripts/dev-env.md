# Dev environment from nothing — cloud agent sessions

> One command rebuilds what CI has: `scripts/dev-env.sh` (≈2 min from an empty box, idempotent — rerun it after the session was paused). This page is the *why* of each step and the manual fallback. The Docker-based laptop setup stays in [[local-environment-setup]].

```
scripts/dev-env.sh  =  db ─► deps ─► env ─► migrate ─► seed ─► azurite ─► chromium ─► build ─► start ─► status
                       :5433                 psql if no   as the      :10000      /opt/pw-    font      :3000
                                             engine       migration   + container  browsers    stub
                                                          role        + CORS       symlink
```

Run one step: `scripts/dev-env.sh <step>`; also `stop`, `reset` (empty the e2e data + seed again), `status`. Logs: `/tmp/af-dev-env/` (`build.log`, `server.log`, `azurite.log`).

## What a cloud session lacks, and the answer

| Missing | Symptom | What the script does |
|---|---|---|
| Docker daemon | `docker compose up` fails | a local Postgres cluster `aftest` on **:5433** (`pg_createcluster`), Azurite from npm (`npx azurite-blob`). With Docker it uses `docker-compose.yml`'s `db-test` + `azurite`. |
| `binaries.prisma.sh` (403) | `npm ci` fails in postinstall; `prisma generate` / `migrate` fail fetching `schema-engine` | `npm ci --ignore-scripts`; `prisma generate` with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` (generate does not use it); migrations **by psql** (below) |
| `fonts.googleapis.com` | `next build` fails on `next/font/google` (Geist) | `make-font-stub.cjs` writes a mock, passed as `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` (below) |
| `cdn.playwright.dev` | `npx playwright install` 403 | the image's `/opt/pw-browsers/chromium-1194` symlinked under the revision Playwright 1.58 expects (1208); also `CHROMIUM_PATH` for the PDFs |
| a UTC Postgres | partners › *dates by year* fails around midnight | `ALTER DATABASE … SET timezone TO 'UTC'`, like CI's container ([[lessons]]) |

## The one database

Like CI, everything runs on the **test** database — app, unit tests, e2e. No `:5432` dev database in a cloud session.

| Variable | Value | Used by |
|---|---|---|
| `DATABASE_URL` / `DATABASE_TEST_URL` | `postgresql://defterfab_app:app@localhost:5433/defterfab_test` | the app (RLS enforced), tests |
| `DATABASE_MIGRATION_URL` / `DATABASE_TEST_MIGRATION_URL` | `postgresql://defterfab:test@localhost:5433/defterfab_test` | migrations, seed, `reset-e2e-data.sh` |

- `defterfab` (superuser) is created by the script; `defterfab_app` by the first migration.
- `.env.local` is written once (random `AUTH_SECRET`, Azurite's well-known key, `CHROMIUM_PATH`) and never overwritten — delete it to regenerate. Git ignores it.

## Migrations without the Prisma engine

Each `prisma/migrations/*/migration.sql`, in order, through `psql -v ON_ERROR_STOP=1`, then a row in `_prisma_migrations` with `checksum = sha256(migration.sql)` — the bookkeeping `prisma migrate deploy` itself writes, so a later session *with* the engine sees them as applied. Already-applied names are skipped.

Not available without the engine: the CI **drift check** (`prisma migrate diff`) — CI's unit job still runs it on every PR.

## Seed

`DATABASE_URL=<migration URL> npx tsx prisma/seed.ts` — the seed creates the tenant, which the RLS app role cannot. The two `[Better Auth] User not found` lines on a fresh database are the seed's sign-in-first idempotency, not errors.

## next/font stub

Next reads `NEXT_FONT_GOOGLE_MOCKED_RESPONSES`: a module `{ cssUrl: css }`; with it set, a font file URL is taken as the file's bytes. Turbopack bundles that module in its own context — no `require`, no Proxy — so `make-font-stub.cjs` **generates** plain data: the URL Next computes for a default call of every Google family (1 907), each a one-line `@font-face` with an absolute `fonts.gstatic.com` URL (a relative one fails to resolve). The page falls back to the system font; the layout is unchanged. A call with explicit weights or `display`: add it to `EXTRA` in the generator. Used only when `fonts.googleapis.com` is unreachable; never by CI or the image.

## Server

`next start -p 3000` (production build, `NEXT_OUTPUT_STANDALONE=false`, like CI), detached with `setsid nohup`. `start` restarts it when `.next/BUILD_ID` changed. If the harness stopped it between turns, `scripts/dev-env.sh start` (or the whole script) brings it back.

## The test loop in a session

```bash
SKIP_MIGRATE_DEPLOY=1 npm run test                    # the setup's own `migrate deploy` needs the engine
scripts/dev-env.sh reset                              # before the e2e: a server-test run empties the seed
npx playwright test e2e/<journey>.spec.ts --workers=2 # reuses :3000; rebuild + start after code changes
```

CI logs are not reachable from a session; read failures with `gh api repos/zzKool/af/check-runs/<id>/annotations` ([[roadmap]]).

Related: [[local-environment-setup]] · [[lessons]] · [[verify-gate]] · [[ci-cd]]
