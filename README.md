# AF

Business-administration app for AnalyticsFab AB (v3). Centralizes documents, imports bank transactions, links everything to its justification, generates invoices and the monthly accountant package.

Start with `CLAUDE.md` and `docs/index.md`. Seeded from DefterFab (v2) — its history is in this repo; `af_core` (v1) is harvested as specs only.

## Prerequisites

- **Node.js** v24.x LTS (verified: v24.11.0)
- **Docker Desktop** (verified: Docker 28.5.1, Compose v2.40.3)
- **Git**

## Quick Start

```bash
# Clone the repository (SSH or HTTPS)
git clone git@github.com:zzKool/af.git
cd af

# Copy environment template
cp .env.example .env.local

# Start all services (PostgreSQL dev, PostgreSQL test, Azurite)
docker compose up -d
```

## Services

| Service | Image | Host Port | Purpose |
|---------|-------|-----------|---------|
| db-dev | postgres:17 | 5432 | Development database |
| db-test | postgres:17 | 5433 | Test database |
| azurite | mcr.microsoft.com/azure-storage/azurite | 10000, 10001, 10002 | Azure Storage emulator (blob, queue, table) |

## Verify Connectivity

```bash
# PostgreSQL dev
docker compose exec db-dev psql -U defterfab -d defterfab_dev -c "SELECT 1;"

# PostgreSQL test
docker compose exec db-test psql -U defterfab -d defterfab_test -c "SELECT 1;"

# Azurite (returns 403 — expected, confirms service is running)
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:10000/devstoreaccount1?comp=list
```

## Development

```bash
# Install dependencies
npm install

# Start dev server (Turbopack)
npm run dev

# Run linter
npm run lint

# Run tests
npm run test

# Run E2E tests
npm run e2e

# TypeScript check
npm run typecheck
```

## Stop Services

```bash
# Stop services (preserves data volumes)
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

## Documentation

See `docs/index.md` for project documentation using Obsidian-style `[[wiki-links]]`.
