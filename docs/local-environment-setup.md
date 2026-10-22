# Local Environment Setup

Quick guide to get AF running locally from scratch, with Docker. In a cloud agent session (no Docker daemon, Prisma engine / Google Fonts / Playwright downloads blocked) run `scripts/dev-env.sh` instead — see `scripts/dev-env.md`.

## Prerequisites

| Tool           | Version   | Purpose                        |
| -------------- | --------- | ------------------------------ |
| Node.js        | v24.x LTS | Runtime for Next.js            |
| Docker Desktop | 28.x+     | PostgreSQL + Azurite containers |
| Git            | Any recent | Version control                |

## 1. Clone & install

```bash
git clone git@github.com:zzKool/af.git
cd af
git checkout develop
npm install
```

## 2. Environment variables

```bash
cp .env.example .env.local
```

Then generate a random auth secret and set it in `.env.local`:

```bash
# Linux/macOS
openssl rand -base64 32

# PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 }) -as [byte[]])
```

Replace `generate-a-random-secret-here` in `.env.local` with the generated value.

All other defaults in `.env.example` are ready for local dev (Azurite uses its well-known key).

## 3. Start Docker services

```bash
docker compose up -d
```

This starts three services:

| Service    | Port(s)             | Purpose                          |
| ---------- | ------------------- | -------------------------------- |
| **db-dev** | 5432                | PostgreSQL 17 development DB     |
| **db-test**| 5433                | PostgreSQL 17 test DB            |
| **azurite**| 10000, 10001, 10002 | Azure Storage emulator (blob/queue/table) |

Verify containers are healthy:

```bash
docker compose ps
```

## 4. Run database migrations

```bash
npm run db:migrate
```

This runs `prisma migrate dev` which:
- Creates all tables, enums, and indexes
- Creates the `af_app` role (used by the app at runtime with RLS enforced)
- Sets up Row-Level Security policies
- Generates the Prisma client

## 5. Seed the database

```bash
npm run db:seed
```

Creates the dev dataset:

| Account                    | Password      | Role       |
| -------------------------- | ------------- | ---------- |
| `owner@dev.test`           | `password123` | Owner      |
| `accountant@dev.test`      | `password123` | Member     |

Organization: **Dev AB** (slug: `dev-ab`, org number: `556677-8899`)

The seed is idempotent — safe to run multiple times.

## 6. Set up Azurite CORS

```bash
npm run dev:setup
```

This configures CORS rules on Azurite so the browser can load document previews. Run once after `docker compose up -d` (persisted in the Azurite volume).

## 7. Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with one of the seed accounts above.

## 8. Background jobs — nothing to start

Jobs (document OCR, ECB rates) run inside the dev server on a Postgres-backed queue (pg-boss, see [[async-jobs]]); `npm run dev` starts the worker. To watch them: `select name, state, retry_count, output from pgboss.job order by created_on desc;`. Set `JOBS_DISABLED=1` to run the app without the worker.

## Optional: Azure Document Intelligence (OCR)

For real OCR extraction (instead of mock data), add these to `.env.local`:

```env
AZURE_DI_ENDPOINT=https://your-instance.cognitiveservices.azure.com
AZURE_DI_KEY=your-api-key
```

Without these, uploads use a mock OCR service that returns fixture data.

## Other useful commands

| Command               | What it does                          |
| --------------------- | ------------------------------------- |
| `npm run test`        | Run Vitest unit/integration tests     |
| `npm run test:watch`  | Run Vitest in watch mode              |
| `npm run e2e`         | Run Playwright E2E tests              |
| `npm run e2e:ui`      | Playwright interactive UI mode        |
| `npm run lint`        | Biome lint check                      |
| `npm run lint:fix`    | Biome lint auto-fix                   |
| `npm run typecheck`   | TypeScript type check (no emit)       |
| `npm run db:studio`   | Open Prisma Studio (DB browser)       |

## Troubleshooting

- **Port 5432 conflict:** Another PostgreSQL instance may be running. Stop it or change the host port in `docker-compose.yml`.
- **Migration fails with role error:** Make sure `DATABASE_MIGRATION_URL` uses the `af` superuser (not `af_app`).
- **Seed fails:** Ensure migrations ran first (`npm run db:migrate`) and the dev server is not running (both use the same DB).
- **Azurite 403:** Expected for unauthenticated container listing. The service is running correctly.
- **Docker not found:** Ensure Docker Desktop is installed and running. Verify with `docker compose version`.
