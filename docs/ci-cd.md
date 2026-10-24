> **Policy since 2026-10-24:** every code PR and every push to `main` run the full pipeline — lint, typecheck, unit tests, build **and E2E** — the four jobs side by side. A docs-only PR still runs the workflow, but only its `changes` job does work: the four heavy jobs report *skipped* and `scripts/merge-when-green.sh` merges it in under a minute. **Images**: `publish.yml` builds the app and migrate images on every push to `main` and every `v*` tag and pushes them to `ghcr.io/zzkool/af` — the homelab and Azure pull, never build ([[deployment]]). (Until 2026-10-24 the E2E ran on `main` only.)

# CI/CD Pipeline

## Pipeline Overview

```mermaid
graph LR
    A[PR / push to main / dispatch] --> X[changes]
    X -->|docs-only PR: skipped| B[lint]
    X --> C[typecheck]
    X --> D[unit-test]
    X --> E[build-and-e2e]
    B --> G[deploy - disabled]
    C --> G
    D --> G
    E --> G
```

| Job | What it does | Target time |
|-----|-------------|-------------|
| **changes** | PR only: lists the PR's files (both names of a rename) through the API and runs `scripts/ci-docs-only.sh` → `docs_only` | <20 s |
| **lint** | Biome check on all files | <1 min |
| **typecheck** | `tsc --noEmit` | <1 min |
| **unit-test** | Vitest with PostgreSQL 17 service | <2 min |
| **build-and-e2e** | `next build`, then migrations + seed + Azurite, `next start`, Playwright | <6 min |
| **publish** (`publish.yml`, main + tags) | `docker build` of the `runner` and `migrate` stages → `ghcr.io/zzkool/af:{main,sha-…,v…}` | <6 min (layer cache) |
| **deploy** | Azure Container Apps (disabled until provisioned; [[deployment]]) | N/A |

**Triggers:** every PR targeting `main`, every push to `main`, `workflow_dispatch` — never filtered at workflow level (a `paths-ignore` would leave no check for `merge-when-green.sh` to wait for).

**Docs-only** (`scripts/ci-docs-only.sh`, the one place the rule lives): every changed path is `*.md` or under `docs/` or `specs/`. Anything else — or any path under `.github/`, `prisma/`, `src/kernel/i18n/dictionaries/`, `package*.json`, `Dockerfile*`, `docker-compose*`, even a `.md` there — runs everything. A push to `main` and a manual run always run everything. A skipped job is a reported check with conclusion `skipped`, which counts as green. `publish.yml` keeps its own `paths-ignore` (a docs commit changes nothing in the image; release tags always publish).

**Caches** (nothing holding a secret or an `.env` file): `~/.npm` (setup-node) and `node_modules` keyed on OS + Node + `package-lock.json` — on a hit `npm ci` is skipped and only the postinstall runs (`.github/actions/setup`, shared by every job); `.next/cache` keyed on the lockfile + the sources (`src/`, `public/`, the configs); Playwright's Chromium keyed on the installed `playwright-core` version (system packages are still installed on a hit). The Prisma client is not cached: `prisma generate` takes ~2 s.

## Local Development

Run each CI step locally:

```bash
# Lint
npm run lint

# Type check
npm run typecheck

# Unit/integration tests (requires test DB on port 5433)
docker compose up -d
npm run test

# Production build
npm run build

# E2E tests (requires dev server + seeded test DB)
npx prisma migrate deploy  # against test DB
npx prisma db seed          # seed test data
npm run e2e
```

## E2E Testing

### Auth Setup Pattern

E2E tests use Playwright's `storageState` pattern for authentication:

1. **Setup projects** run first: `e2e/fixtures/auth.setup.ts` (owner) and `e2e/fixtures/auth-accountant.setup.ts` (accountant)
2. Each setup logs in via the UI and saves cookies/localStorage to `e2e/.auth/*.json`
3. **Test projects** use `storageState` to skip login — tests start already authenticated

### Selector Contract

Login page:
- Email field: `getByLabel('Email')`
- Password field: `getByLabel('Password')`
- Submit button: `getByRole('button', { name: 'Sign in' })`
- Post-login redirect: `/dashboard`

Sidebar navigation (all items are `<Link>` → `<a>` tags):
- **Owner:** Dashboard, Documents, Journal, Banking, Partners, Reconciliation, Invoices, Settings
- **Accountant:** Dashboard, Documents, Journal

### Adding New E2E Tests

1. Create `e2e/<feature>.spec.ts`
2. Use `test.use({ storageState: 'e2e/.auth/owner.json' })` for owner context
3. Tests automatically depend on auth setup via Playwright project dependencies

### CI vs Local

- **Local:** `playwright.config.ts` uses `webServer` to start dev server automatically
- **CI:** `webServer` is disabled; standalone server started separately in the workflow

## Docker

### Build and Run Locally

```bash
# Build image
docker build -t af .

# Run (connect to local test DB)
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://af:test@host.docker.internal:5433/af_test \
  -e DATABASE_MIGRATION_URL=postgresql://af:test@host.docker.internal:5433/af_test \
  -e AUTH_SECRET=your-secret-here \
  -e AUTH_URL=http://localhost:3000 \
  af
```

### Image Details

- **Base:** `node:22-alpine`
- **Build:** Multi-stage (deps → build → runtime)
- **Output:** Next.js standalone mode — single `server.js` entry point
- **Size:** ~200MB (Alpine + Node.js + standalone build)

## Phase 2 — Azure Deployment

> Not yet active. Deploy job exists in `ci.yml` but is disabled (`if: false`).

### Azure Setup Steps

1. Create Azure Container Apps environment
2. Create Azure Container Registry (ACR)
3. Add GitHub repository secrets:
   - `AZURE_CREDENTIALS` — Service principal JSON
   - `ACR_LOGIN_SERVER` — e.g., `af.azurecr.io`
   - `ACR_USERNAME` / `ACR_PASSWORD` — ACR credentials
   - `AZURE_RESOURCE_GROUP` — e.g., `af-rg`
   - `PRODUCTION_DATABASE_URL` — Production PostgreSQL connection string
4. In `ci.yml`, change `if: false` to `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`
5. Add `main` branch to CI triggers

### Migration Strategy

Migrations run BEFORE deploying the new image. If migration fails, the old container keeps running.

## Phase 2 — Recovery Runbook (NFR24)

> Requires deployed environment to validate. Steps below are documented for when Azure is provisioned.

### Disaster Recovery Steps

1. **Database restore:** Use Azure PostgreSQL PITR (Point-in-Time Recovery) to restore to last known good state
2. **Redeploy last known good image:**
   ```bash
   az containerapp update \
     --name af \
     --resource-group af-rg \
     --image af.azurecr.io/af:<last-good-sha>
   ```
3. **Verify health:** Check container logs and hit `/login` to confirm app is serving
4. **Validate data:** Log in as owner, verify tenant data is intact

### RTO/RPO Targets (from architecture)

- **RPO:** 24 hours (Azure PITR retention)
- **RTO:** 2 hours (manual restore + redeploy)

## CI Minutes Budget

| Metric | Value |
|--------|-------|
| Free tier | unlimited (public repo) |
| Est. per PR run | ~8 min (billed per job-minute) |
| Est. monthly usage | ~1,600 min during active dev |
| Docs-only PRs | `changes` only (~15 s); the heavy jobs are skipped |
| First lever if approaching limit | lint+typecheck on PR only, not push |

## Discipline Note

No branch protection is configured (requires GitHub Pro). Always use PRs to `develop` — never push directly. The CI pipeline validates every PR automatically.

## Baseline Performance

> Updated after first CI run.

| Job | Actual Time | Target |
|-----|-------------|--------|
| lint | TBD | <1 min |
| typecheck | TBD | <1 min |
| unit-test | TBD | <2 min |
| build | TBD | <3 min |
| e2e | TBD | <5 min |
| **Total** | **TBD** | **<10 min** |
