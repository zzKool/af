# Environment variables

Every difference between a laptop, the homelab and Azure is an env var (constitution §1.8). `.env.example` is the development set (`.env.local`), `.env.prod.example` the production set (`.env.prod`, read by `docker-compose.prod.yml`). The code reads nothing else.

| variable | required | read by | meaning |
|---|---|---|---|
| `DATABASE_URL` | yes | `kernel/db` (Prisma + pg), pg-boss | the **app role** (`af_app`), RLS-enforced; also the jobs queue's connection |
| `DATABASE_MIGRATION_URL` | migrations | `prisma.config.ts` | the migration role (owner of the schema) — `prisma migrate deploy`, the migrate image |
| `DATABASE_TEST_URL`, `DATABASE_TEST_MIGRATION_URL` | tests | Vitest setup, the e2e server | the test database (port 5433 locally and in CI) |
| `AUTH_SECRET` | yes | Better Auth | ≥ 32 random bytes; rotating it logs everyone out |
| `AUTH_URL` (or `BETTER_AUTH_URL`) | yes | Better Auth | the public address (`https://af.example.com`) — origins are validated against it |
| `AZURE_STORAGE_CONNECTION_STRING` | yes | `kernel/storage` | Azurite (dev, homelab) or the storage account (Azure) — the one switch |
| `AZURE_STORAGE_CONTAINER` | yes | `kernel/storage`, `extractBlobPath` | `documents` |
| `AZURE_DI_ENDPOINT`, `AZURE_DI_KEY` | OCR | `kernel/ocr` | Document Intelligence; unset = the mock OCR (a warning at start) |
| `CHROMIUM_PATH` | PDFs | `kernel/pdf` | set by the Dockerfile (`/usr/bin/chromium-browser`); locally playwright-core's Chromium |
| `INTERNAL_BASE_URL` | no | `kernel/pdf` | where the renderer reaches the app's print routes (default `http://127.0.0.1:$PORT`) |
| `PORT`, `HOSTNAME` | no | Next.js | `3000`, `0.0.0.0` in the image |
| `JOBS_DISABLED` | no | `kernel/jobs` | `1` turns the in-process worker off (scripts, a second replica without the worker) |
| `JOBS_POOL_MAX` | no | `kernel/jobs` | pg-boss's pool size (default 2) |
| `LOG_LEVEL` | no | `kernel/logging` | pino level (`info`) |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | no | Sentry | errors; source maps uploaded at build when the token is set |
| `APP_VERSION` | no | `/api/health` | the build's version — the publish workflow bakes the git sha or the tag into the image |
| `SEED_PASSWORD` | dev | `prisma/seed.ts` | the seed users' password (development only) |
| `NEXT_OUTPUT_STANDALONE` | build | `next.config.ts` | `false` makes a non-standalone build (the CI e2e server); the image uses standalone |
| `SKIP_MIGRATE_DEPLOY` | tests | Vitest setup | skip the migration step of the test setup |

Compose-only (read by `docker-compose.prod.yml`, not by the app): `AF_IMAGE` (`ghcr.io/zzkool/af`), `AF_TAG` (`main`, `sha-…`, `v…`), `AF_PORT` (`3000` or `127.0.0.1:3000` behind a proxy), `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`. Backup script: `BACKUP_DIR`, `BACKUP_KEEP_DAYS`, `BACKUP_OFFSITE`.

See [[deployment]] for where each value comes from on each site.
