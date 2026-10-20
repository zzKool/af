> **Policy since phase-0 (2026-10-20):** pull requests run lint, typecheck, unit tests and the production build (~3–4 min). E2E runs on every push to `main` and on manual dispatch (`workflow_dispatch`); a red E2E on `main` is fixed forward in the next PR.

# CI/CD Pipeline

## Pipeline Overview

```mermaid
graph LR
    A[Push/PR to develop] --> B[lint]
    A --> C[typecheck]
    A --> D[unit-test]
    B --> E[build]
    C --> E
    D --> E
    E --> F[e2e]
    F --> G[deploy - disabled]
```

| Job | What it does | Target time |
|-----|-------------|-------------|
| **lint** | Biome check on all files | <1 min |
| **typecheck** | `tsc --noEmit` | <1 min |
| **unit-test** | Vitest with PostgreSQL 17 service | <2 min |
| **build** | `next build` with standalone output | <3 min |
| **e2e** | Playwright against standalone server | <5 min |
| **deploy** | Azure Container Apps (disabled) | N/A |

**Triggers:** Every push to `develop` and every PR targeting `develop`. Pushes that only change `.md`, `docs/`, or `_bmad*/` files are skipped (`paths-ignore`).

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
docker build -t defterfab .

# Run (connect to local test DB)
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://defterfab:test@host.docker.internal:5433/defterfab_test \
  -e DATABASE_MIGRATION_URL=postgresql://defterfab:test@host.docker.internal:5433/defterfab_test \
  -e AUTH_SECRET=your-secret-here \
  -e AUTH_URL=http://localhost:3000 \
  defterfab
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
   - `ACR_LOGIN_SERVER` — e.g., `defterfab.azurecr.io`
   - `ACR_USERNAME` / `ACR_PASSWORD` — ACR credentials
   - `AZURE_RESOURCE_GROUP` — e.g., `defterfab-rg`
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
     --name defterfab \
     --resource-group defterfab-rg \
     --image defterfab.azurecr.io/defterfab:<last-good-sha>
   ```
3. **Verify health:** Check container logs and hit `/login` to confirm app is serving
4. **Validate data:** Log in as owner, verify tenant data is intact

### RTO/RPO Targets (from architecture)

- **RPO:** 24 hours (Azure PITR retention)
- **RTO:** 2 hours (manual restore + redeploy)

## CI Minutes Budget

| Metric | Value |
|--------|-------|
| Free tier | 2,000 min/month (private repo) |
| Est. per PR run | ~8 min (billed per job-minute) |
| Est. monthly usage | ~1,600 min during active dev |
| Savings from `paths-ignore` | ~20% (docs-only pushes) |
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
