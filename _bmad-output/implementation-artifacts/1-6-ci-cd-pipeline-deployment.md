# Story 1.6: CI/CD Pipeline & Deployment

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want an automated CI/CD pipeline that validates code quality and catches regressions,
so that every push to `develop` is tested and the codebase remains reliable as new features are added.

**Why this matters:** Stories 1.1-1.5 built auth, RLS, middleware, tenant management, and settings. Without CI, a bad commit in Epic 2 could silently break all of that. This story builds the safety net for everything that comes after.

## Acceptance Criteria

1. **Parallel CI Jobs:** GitHub Actions runs parallel jobs on every PR to `develop`: Biome lint, TypeScript typecheck (`tsc --noEmit`), Vitest unit/integration tests. All three run on `ubuntu-latest`.
2. **Sequential Build:** After all parallel jobs pass, `next build` creates the production build with `output: 'standalone'`. Build artifacts uploaded for downstream jobs.
3. **E2E Tests:** After build, Playwright E2E tests run against the standalone server with a PostgreSQL 17 service container and seed data. Tests verify login → dashboard flow for both owner and accountant roles.
4. **Playwright Auth Fixtures:** `e2e/fixtures/auth.setup.ts` saves `storageState` for owner role. `e2e/fixtures/auth-accountant.setup.ts` saves `storageState` for accountant role. Both use seed credentials (`owner@dev.test` / `accountant@dev.test`). Selectors verified against actual login page UI.
5. **Basic E2E Spec:** At least one E2E spec (`e2e/auth.spec.ts`) verifies: (a) owner can log in and see the dashboard with sidebar, (b) accountant can log in and see restricted navigation.
6. **Dockerfile:** Production `Dockerfile` using Next.js standalone output mode. Multi-stage build: install deps → build → minimal runtime image. Uses `node:22-alpine` base. Verified to start and connect to database at runtime (not just build).
7. **Deploy Job (Disabled):** Deploy job exists in `ci.yml` but is disabled (`if: false`) with clear instructions for enabling when Azure is provisioned. Documents required secrets and Azure setup steps.
8. **Performance Targets:** Target times: lint+typecheck+unit <2min (parallel), build <3min, E2E <5min. Measure actual times on first CI run and document as baseline.
9. **Solo Developer Recovery (NFR24):** Recovery runbook documented (Phase 2 — requires deployed environment to validate).
10. **Documentation:** `docs/ci-cd.md` created with pipeline overview, local Docker build, future deployment guide, and recovery runbook. `docs/index.md` updated. `CLAUDE.md` updated with CI note.

## Tasks / Subtasks

### Task 0: Prerequisites and gating research (RESOLVE BEFORE any implementation)

- [x] 0.1 Verify Story 1.5 is merged to `develop`: `git log develop --oneline -5` shows Story 1.5 commits.
- [x] 0.2 Run `npm install && npm run build` — clean build. Zero errors.
- [x] 0.3 Run `npm run test` — all 54 existing tests pass. Zero regressions.
- [x] 0.4 **GATE 1: Next.js standalone output + Prisma runtime.** Add `output: 'standalone'` to `next.config.ts`. Run `npm run build`. Verify `.next/standalone/server.js` exists. Then **runtime test:** start test DB via docker-compose, run `DATABASE_URL=postgresql://defterfab:test@localhost:5433/defterfab_test node .next/standalone/server.js`, hit `http://localhost:3000/login` — confirm page renders. Check server logs for Prisma connection success. If Prisma driver adapter fails: add `'@prisma/adapter-pg'` and `'@prisma/client'` to `serverExternalPackages` in `next.config.ts`.
- [x] 0.5 **GATE 2: Playwright in CI.** Confirm `npx playwright install --with-deps chromium` installs browser + system deps on `ubuntu-latest`. Playwright config already has `process.env.CI` checks for forbidOnly, retries, workers.
- [x] 0.6 **GATE 3: GitHub Actions service containers.** Verify PostgreSQL 17 service container syntax with health checks. In CI, single user `defterfab` has full privileges — both `DATABASE_URL` and `DATABASE_MIGRATION_URL` point to same connection. Verify `src/server/db/test-setup.ts` works with single-user CI database (no separate migration vs app role).
- [x] 0.7 **GATE 4: Prisma migrations + seed in CI.** Confirm `npx prisma migrate deploy` works against fresh PostgreSQL service container. Verify seed script runs without a running app server (BA's `auth.api` uses direct function calls, not HTTP). Also verify `prisma generate` runs via `npm ci` postinstall hook — if not, add explicit `npx prisma generate` step to unit-test job.
- [x] 0.8 **GATE 5: E2E selector contract.** Read `src/app/(auth)/login/page.tsx` — document exact form field labels, button text, and post-login redirect URL. Read `src/components/domain/sidebar.tsx` — document nav item element types (Link/a/button) and exact text labels for owner vs accountant. These become the selector contract for all E2E tests. If selectors don't match what's in Tasks 3-4, update the test code accordingly.

### Task 1: Configure Next.js standalone output (AC: #6)

- [x] 1.1 Update `next.config.ts` — add `output: 'standalone'`:
  ```typescript
  const nextConfig: NextConfig = {
    output: 'standalone',
    serverExternalPackages: ['pino', 'pino-http'],
    // If Gate 0.4 fails: add '@prisma/adapter-pg', '@prisma/client'
  };
  ```
- [x] 1.2 Verify `npm run build` produces `.next/standalone/server.js` and `.next/static/` directory.
- [x] 1.3 **Runtime verification** (from Gate 0.4): standalone server starts and serves pages with database connection.
- [x] 1.4 Add `.next/standalone/` to `.gitignore` if not already covered by `.next/`.

### Task 2: Create Dockerfile (AC: #6)

- [x] 2.1 Create `Dockerfile` in project root — multi-stage build:
  ```dockerfile
  # Stage 1: Install dependencies
  FROM node:22-alpine AS deps
  WORKDIR /app
  COPY package.json package-lock.json ./
  RUN npm ci --ignore-scripts

  # Stage 2: Build application
  FROM node:22-alpine AS builder
  WORKDIR /app
  COPY --from=deps /app/node_modules ./node_modules
  COPY . .
  RUN npx prisma generate
  RUN npm run build

  # Stage 3: Production runtime
  FROM node:22-alpine AS runner
  WORKDIR /app
  ENV NODE_ENV=production
  RUN addgroup --system --gid 1001 nodejs
  RUN adduser --system --uid 1001 nextjs
  COPY --from=builder /app/public ./public
  COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
  COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
  COPY --from=builder /app/prisma ./prisma
  USER nextjs
  EXPOSE 3000
  ENV PORT=3000
  ENV HOSTNAME="0.0.0.0"
  CMD ["node", "server.js"]
  ```
- [x] 2.2 Create `.dockerignore`:
  ```
  node_modules
  .next
  .git
  _bmad*
  e2e
  *.md
  .env*
  .claude
  ```
- [x] 2.3 Verify `docker build -t defterfab .` succeeds locally. Start container with database env vars and confirm it connects and serves pages.

### Task 3: Create Playwright auth setup fixtures (AC: #4)

**CRITICAL: Use selectors from Gate 0.8 — do NOT guess form labels or redirect URLs.**

- [x] 3.1 Create `e2e/fixtures/auth.setup.ts` — owner authentication setup. Use exact selectors from Gate 0.8 for email field, password field, submit button, and post-login redirect URL.
- [x] 3.2 Create `e2e/fixtures/auth-accountant.setup.ts` — accountant authentication setup. Same selectors, different credentials.
- [x] 3.3 Update `playwright.config.ts` — add setup projects and authenticated test projects:
  ```typescript
  projects: [
    { name: 'owner-setup', testMatch: /auth\.setup\.ts/, testDir: './e2e/fixtures' },
    { name: 'accountant-setup', testMatch: /auth-accountant\.setup\.ts/, testDir: './e2e/fixtures' },
    {
      name: 'owner-tests',
      use: { storageState: 'e2e/.auth/owner.json' },
      dependencies: ['owner-setup'],
    },
    {
      name: 'accountant-tests',
      use: { storageState: 'e2e/.auth/accountant.json' },
      dependencies: ['accountant-setup'],
    },
  ],
  ```
  Note: CI does NOT use the `webServer` directive — the standalone server is started separately in the CI workflow.
- [x] 3.4 Add `e2e/.auth/` to `.gitignore` (storageState files contain session tokens).
- [x] 3.5 Remove the `.gitkeep` from `e2e/fixtures/` once real files exist.

### Task 4: Create basic E2E test spec (AC: #5)

**CRITICAL: Use selectors from Gate 0.8 — verify nav item element types match `getByRole` usage.**

- [x] 4.1 Create `e2e/auth.spec.ts` — login and navigation verification. Use exact nav item text labels and element roles from Gate 0.8. If sidebar uses Next.js `<Link>` (renders as `<a>`), `getByRole('link')` is correct. If it uses `<button>`, adjust accordingly.
- [x] 4.2 Verify E2E tests pass locally: `npm run e2e` (requires dev server running + seeded test DB).

### Task 5: Create GitHub Actions CI workflow (AC: #1, #2, #3, #7, #8)

- [ ] 5.1 Install `wait-on` as dev dependency: `npm install -D wait-on`
- [ ] 5.2 Create `.github/workflows/ci.yml`:
  ```yaml
  name: CI/CD Pipeline
  on:
    push:
      branches: [develop]
      paths-ignore:
        - '**.md'
        - 'docs/**'
        - '_bmad*/**'
    pull_request:
      branches: [develop]

  env:
    NODE_VERSION: '22'
    AUTH_SECRET: 'ci-test-secret-not-for-production'
    AUTH_URL: 'http://localhost:3000'

  jobs:
    lint:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: ${{ env.NODE_VERSION }}
            cache: 'npm'
        - run: npm ci
        - run: npm run lint

    typecheck:
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: ${{ env.NODE_VERSION }}
            cache: 'npm'
        - run: npm ci
        - run: npm run typecheck

    unit-test:
      runs-on: ubuntu-latest
      services:
        postgres:
          image: postgres:17
          env:
            POSTGRES_USER: defterfab
            POSTGRES_PASSWORD: test
            POSTGRES_DB: defterfab_test
          ports:
            - 5433:5432
          options: >-
            --health-cmd="pg_isready -U defterfab"
            --health-interval=10s
            --health-timeout=5s
            --health-retries=5
      env:
        DATABASE_URL: postgresql://defterfab:test@localhost:5433/defterfab_test
        DATABASE_MIGRATION_URL: postgresql://defterfab:test@localhost:5433/defterfab_test
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: ${{ env.NODE_VERSION }}
            cache: 'npm'
        - run: npm ci
        # If prisma generate is not in postinstall, add: npx prisma generate
        - run: npx prisma migrate deploy
        - run: npm run test

    build:
      needs: [lint, typecheck, unit-test]
      runs-on: ubuntu-latest
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: ${{ env.NODE_VERSION }}
            cache: 'npm'
        - run: npm ci
        - run: npx prisma generate
        - run: npm run build
        - uses: actions/upload-artifact@v4
          with:
            name: build-output
            path: |
              .next/standalone
              .next/static
              prisma
            retention-days: 1

    e2e:
      needs: [build]
      runs-on: ubuntu-latest
      services:
        postgres:
          image: postgres:17
          env:
            POSTGRES_USER: defterfab
            POSTGRES_PASSWORD: test
            POSTGRES_DB: defterfab_test
          ports:
            - 5433:5432
          options: >-
            --health-cmd="pg_isready -U defterfab"
            --health-interval=10s
            --health-timeout=5s
            --health-retries=5
      env:
        DATABASE_URL: postgresql://defterfab:test@localhost:5433/defterfab_test
        DATABASE_MIGRATION_URL: postgresql://defterfab:test@localhost:5433/defterfab_test
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with:
            node-version: ${{ env.NODE_VERSION }}
            cache: 'npm'
        - run: npm ci
        - name: Cache Playwright browsers
          uses: actions/cache@v4
          with:
            path: ~/.cache/ms-playwright
            key: playwright-${{ hashFiles('package-lock.json') }}
        - run: npx playwright install --with-deps chromium
        - run: npx prisma migrate deploy
        - run: npx prisma db seed
        - uses: actions/download-artifact@v4
          with:
            name: build-output
            path: .
        - name: Start server and run E2E tests
          run: |
            node .next/standalone/server.js > server.log 2>&1 &
            npx wait-on http://localhost:3000 --timeout 30000 || (cat server.log && exit 1)
            npm run e2e
          env:
            PORT: 3000
            HOSTNAME: localhost
        - uses: actions/upload-artifact@v4
          if: ${{ !cancelled() }}
          with:
            name: playwright-report
            path: |
              playwright-report/
              server.log
            retention-days: 7

    # Deploy job — DISABLED until Azure is provisioned
    # To enable: 1) Provision Azure Container Apps + ACR
    #            2) Add GitHub secrets (see docs/ci-cd.md)
    #            3) Change 'if: false' to 'if: github.ref == ...'
    deploy:
      needs: [e2e]
      if: false  # TODO: Enable when Azure is provisioned
      # if: github.ref == 'refs/heads/main' && github.event_name == 'push'
      runs-on: ubuntu-latest
      environment: production
      steps:
        - uses: actions/checkout@v4
        - uses: azure/login@v2
          with:
            creds: ${{ secrets.AZURE_CREDENTIALS }}
        - uses: azure/docker-login@v2
          with:
            login-server: ${{ secrets.ACR_LOGIN_SERVER }}
            username: ${{ secrets.ACR_USERNAME }}
            password: ${{ secrets.ACR_PASSWORD }}
        - name: Run database migrations
          run: |
            # Run migrations BEFORE deploying new image
            # If migration fails, old container keeps running
            npx prisma migrate deploy
          env:
            DATABASE_URL: ${{ secrets.PRODUCTION_DATABASE_URL }}
        - name: Build and push Docker image
          run: |
            docker build -t ${{ secrets.ACR_LOGIN_SERVER }}/defterfab:${{ github.sha }} .
            docker push ${{ secrets.ACR_LOGIN_SERVER }}/defterfab:${{ github.sha }}
        - name: Deploy to Azure Container Apps
          run: |
            az containerapp update \
              --name defterfab \
              --resource-group ${{ secrets.AZURE_RESOURCE_GROUP }} \
              --image ${{ secrets.ACR_LOGIN_SERVER }}/defterfab:${{ github.sha }}
  ```
- [ ] 5.3 Verify CI workflow syntax: review against GitHub Actions schema.
- [ ] 5.4 **First PR is self-validating:** The CI workflow added in this PR will trigger CI on the PR itself (GitHub Actions reads workflow from PR branch for `pull_request` triggers). Verify the workflow file is at the exact path `.github/workflows/ci.yml`.

### Task 6: Update environment and configuration (AC: #1, #3)

- [ ] 6.1 Update `.env.example` — add CI/deployment notes (commented, for future reference):
  ```
  # CI/CD (GitHub Actions - set as repository secrets when deploying)
  # AZURE_CREDENTIALS={"clientId":"...","clientSecret":"...","subscriptionId":"...","tenantId":"..."}
  # ACR_LOGIN_SERVER=defterfab.azurecr.io
  # ACR_USERNAME=defterfab
  # ACR_PASSWORD=<from Azure Portal>
  # AZURE_RESOURCE_GROUP=defterfab-rg
  # PRODUCTION_DATABASE_URL=postgresql://...
  ```
- [ ] 6.2 Ensure `e2e/.auth/` is in `.gitignore`.
- [ ] 6.3 Ensure `playwright-report/` is in `.gitignore`.

### Task 7: Write documentation (AC: #9, #10)

- [ ] 7.1 Create `docs/ci-cd.md` with these sections:
  - **Pipeline Overview:** Mermaid diagram of lint → typecheck → unit-test (parallel) → build → e2e flow. What each job does, target durations.
  - **Local Development:** How to run each step locally (`npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, `npm run e2e`).
  - **E2E Testing:** How auth setup works (storageState pattern), how to add new E2E tests, selector contract from Gate 0.8.
  - **Docker:** How to build and run locally with `docker build` and `docker run`.
  - **Phase 2 — Azure Deployment:** (Not yet active) Azure Container Apps setup steps, required GitHub secrets, ACR provisioning, how to enable the deploy job.
  - **Phase 2 — Recovery Runbook (NFR24):** (Requires deployed environment) Step-by-step: Azure PostgreSQL PITR restore → redeploy last known good image → verify health → validate data.
  - **CI Minutes Budget:** Free tier is 2,000 min/month. Estimated ~1,600 min/month during active development. First lever if approaching limit: run lint+typecheck only on PR (not push).
  - **Discipline Note:** No branch protection (requires GitHub Pro). Always use PRs to `develop` — never push directly.
- [ ] 7.2 Update `docs/index.md` — add `[[ci-cd]]` wiki-link.
- [ ] 7.3 Update `CLAUDE.md` — add to Key Commands section: `CI runs on every PR to develop via GitHub Actions`.

### Task 8: Verification and validation (AC: all)

- [ ] 8.1 Run `npm run lint` — clean on all new/modified files.
- [ ] 8.2 Run `npm run typecheck` — zero errors.
- [ ] 8.3 Run `npm run build` — successful with standalone output.
- [ ] 8.4 Run `npm run test` — all 54+ existing tests pass. Zero regressions.
- [ ] 8.5 Verify Dockerfile builds locally: `docker build -t defterfab .`
- [ ] 8.6 E2E tests: verify locally if possible (requires seeded test DB + dev server). If E2E can't run locally due to environment constraints, document what's needed and verify in CI.
- [ ] 8.7 Measure first CI run times after PR creation — document as baseline in `docs/ci-cd.md`.

## Definition of Done

This story is complete when:
1. PR from `feature/story-1-6-ci-cd-pipeline-deployment` to `develop` — CI runs and passes (self-validating)
2. Dockerfile builds locally with `docker build -t defterfab .`
3. E2E auth fixtures + basic spec pass in CI
4. `docs/ci-cd.md` documents pipeline + Docker + future deployment
5. Deploy job exists but is disabled with clear enablement instructions

This story is NOT responsible for: Azure provisioning, production database setup, ACR registry creation, live deployment testing, branch protection rules.

## Dev Notes

### Critical Path — Resolve FIRST (Task 0)

These gates block implementation. Resolve before writing any code:

1. **Standalone + Prisma runtime (Gate 0.4):** The critical risk. `output: 'standalone'` traces dependencies — if Prisma's driver adapter (`@prisma/adapter-pg`) isn't traced correctly, the build succeeds but the app crashes at runtime with `PrismaClientInitializationError`. Must verify with an actual runtime test, not just a build check.
2. **E2E selector contract (Gate 0.8):** The auth fixtures assume specific form labels and redirect URLs. If these don't match the actual login page from Story 1.3, E2E tests fail with unhelpful selector errors. Read the actual components first.
3. **CI database single-user (Gate 0.6):** CI Postgres has one user with full privileges. Locally we have separate migration vs app roles. Verify `test-setup.ts` works with both configurations.
4. **Seed without server (Gate 0.7):** Seed uses `auth.api.signUpEmail()` — direct function calls, not HTTP. Should work without a running server but must verify.

### Task Parallelization

```
Track A (config):   Task 0 → Task 1 → Task 2
Track B (testing):  Task 0 → Task 3 → Task 4
Track C (CI):       [wait for A+B] → Task 5 → Task 6
Track D (docs):     Task 7 (last)
Track E (verify):   Task 8 (final)
```

### Critical Design Decisions

1. **Standalone output mode:** Next.js `output: 'standalone'` creates a self-contained build. The `.next/standalone/server.js` replaces `next start`. Must include `@prisma/adapter-pg` in `serverExternalPackages` if standalone tracing doesn't pick it up automatically.

2. **CI triggers only on `develop`:** No `main` branch in active use. When deployment is enabled (Phase 2), add `main` as a trigger and establish the `develop → main` merge flow.

3. **E2E uses standalone server, not dev server:** The E2E CI job runs `node .next/standalone/server.js` (not `npm run dev`). This validates the production build path. The `webServer` directive in `playwright.config.ts` is for local development only — CI starts the server separately.

4. **Deploy job disabled:** Present in `ci.yml` with `if: false`. Enables deployment without modifying the workflow structure — just flip the condition and add secrets. Saves ~$0/month vs ~$15-60/month for always-on Azure Container Apps.

5. **Auth storage state pattern:** Playwright `storageState` saves cookies/localStorage after login. Two setup projects (owner, accountant) with `dependencies` arrays ensure setup runs before tests.

6. **Server log capture in CI:** E2E job redirects standalone server output to `server.log`. On `wait-on` failure: `cat server.log && exit 1` provides the actual error instead of an unhelpful timeout message. Log is uploaded as artifact for debugging.

7. **`paths-ignore` for CI minutes conservation:** Pushes that only change `.md`, `docs/`, or `_bmad*/` files skip CI entirely. Saves ~20% of GitHub Actions minutes during active development.

8. **Playwright browser caching:** `actions/cache@v4` caches `~/.cache/ms-playwright` keyed on `package-lock.json`. Saves 30-60 seconds per E2E run by avoiding re-downloading Chromium.

9. **Production migration strategy (Phase 2):** Run `prisma migrate deploy` in the deploy job BEFORE updating the container image. If migration fails, old container keeps running. Dockerfile includes `prisma/` for emergency manual migrations.

10. **`public/` not in build artifact:** The repo checkout already has `public/`. Only `.next/standalone`, `.next/static`, and `prisma` are uploaded as artifacts.

### Architecture Compliance

- **GitHub Actions workflow** follows D5 architecture decision: parallel lint+typecheck+unit → sequential build → E2E → deploy.
- **Dockerfile** uses standalone output for single-container monolith deployment.
- **E2E test structure** matches architecture's `e2e/` directory layout with `fixtures/` for auth setup.
- **Test database lifecycle** follows architecture: migrate deploy → seed → run tests.
- **Deploy topology** follows architecture's single-container Azure Container Apps (when enabled).

### CI Minutes Budget

| Metric | Value |
|--------|-------|
| Free tier | 2,000 min/month (private repo) |
| Est. per PR run | ~8 min (billed per job-minute) |
| Est. monthly usage | ~1,600 min during active dev |
| Savings from `paths-ignore` | ~20% (docs-only pushes) |
| First lever if approaching limit | lint+typecheck on PR only, not push |

### Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| E2E selectors don't match UI | HIGH | CI broken day 1 | Gate 0.8: read actual components |
| Prisma driver adapter not traced by standalone | MEDIUM | Runtime crash | Gate 0.4: runtime test, serverExternalPackages fallback |
| GitHub minutes exhausted | MEDIUM | No CI for rest of month | `paths-ignore`, Playwright caching |
| `prisma generate` missing in unit job | MEDIUM | CI broken day 1 | Gate 0.7: verify postinstall hook |
| Single-user CI DB differs from local | LOW | Subtle test failures | Gate 0.6: verify test-setup.ts |
| Seed script needs running server | LOW | E2E setup fails | Gate 0.7: verify BA API direct calls |

### Library/Framework Requirements

| Package | Version | Purpose |
|---------|---------|---------|
| Next.js | 16.1.6 | `output: 'standalone'` for Docker |
| Playwright | 1.58 | E2E testing with Chromium |
| Node.js | 22 (CI) | Runtime in CI and Docker |
| PostgreSQL | 17 | Service container in CI |
| wait-on | latest | Wait for server in CI (**add as dev dependency**) |

### File Structure

| File | Purpose | Status |
|------|---------|--------|
| `.github/workflows/ci.yml` | CI/CD pipeline | NEW |
| `Dockerfile` | Production container | NEW |
| `.dockerignore` | Docker build exclusions | NEW |
| `e2e/fixtures/auth.setup.ts` | Owner auth setup | NEW |
| `e2e/fixtures/auth-accountant.setup.ts` | Accountant auth setup | NEW |
| `e2e/auth.spec.ts` | Login/navigation E2E test | NEW |
| `docs/ci-cd.md` | CI/CD documentation | NEW |
| `next.config.ts` | Add standalone output | MODIFY |
| `playwright.config.ts` | Add setup projects | MODIFY |
| `package.json` | Add wait-on dev dependency | MODIFY |
| `.gitignore` | Add e2e/.auth/, playwright-report/ | MODIFY |
| `.env.example` | Add CI secrets documentation | MODIFY |
| `docs/index.md` | Add ci-cd wiki-link | MODIFY |
| `CLAUDE.md` | Add CI note to Key Commands | MODIFY |
| `e2e/fixtures/.gitkeep` | Remove (replaced by real files) | DELETE |

### Previous Story Intelligence (Story 1.5)

- **Seed script works:** `prisma/seed.ts` creates owner (`owner@dev.test`) and accountant (`accountant@dev.test`) with password `password123`. Uses Better Auth API direct calls (not HTTP).
- **Auth flow:** Better Auth handles login at `/login` page (from Story 1.3). Post-login redirect URL must be verified in Gate 0.8.
- **Sidebar navigation:** Owner sees all nav items (Dashboard, Documents, Journal, Banking, Partners, Reconciliation, Invoices, Settings). Accountant sees restricted set (Dashboard, Journal, Documents). Element types and exact text must be verified in Gate 0.8.
- **54 tests pass:** 42 from Stories 1.2-1.4, 12 from Story 1.5. All via Vitest.
- **No E2E tests exist yet.** The `e2e/fixtures/.gitkeep` is the only file in `e2e/`.
- **Build is clean:** `npm run build` succeeds. `npm run lint` passes.
- **Test setup uses port 5433:** Test database runs on port 5433 (separate from dev on 5432).
- **BA organization hook:** `afterCreateOrganization` in `src/server/auth.ts` — relevant for seed in CI.

### Git Intelligence

- Branch: `feature/story-1-6-ci-cd-pipeline-deployment` (from `develop`)
- Recent pattern: `feat:` for main implementation, `fix:` for code review fixes
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `test:`, `refactor:`
- Story 1.5 merged to develop (commit 6f7dd79)
- PR template exists at `.github/pull_request_template.md`
- First PR will self-validate: CI workflow runs from PR branch on `pull_request` trigger

### Scope Boundaries

- **No Azure provisioning** — deploy job exists but is disabled. Azure setup is Phase 2.
- **No staging environment** — solo developer, no staging needed per architecture.
- **No Azure Key Vault** — secrets in Azure App Settings for MVP (D7).
- **No scale-to-zero** — always-on minimum 1 replica per architecture (when deployed).
- **No performance/security scanning** — not in scope for this story.
- **No monitoring/alerting setup** — deferred to Story 2.4 (Observability).
- **No branch protection** — requires GitHub Pro (deferred). Use PR discipline instead.
- **No `main` branch workflow** — CI triggers only on `develop`. Add `main` when deployment is enabled.

### Dependencies

- **Depends on Story 1.5:** Seed script, sidebar navigation, settings pages (for E2E verification)
- **Depends on Story 1.3:** Better Auth login flow (E2E tests login via UI)
- **Depends on Story 1.2:** Prisma schema, migrations (CI runs migrations)
- **Depended on by all future stories:** CI pipeline validates every push
- **Depended on by Story 2.4:** Observability builds on deployment infrastructure

### Edge Cases to Handle

1. **Prisma driver adapter in standalone:** Next.js standalone traces dependencies but may miss `@prisma/adapter-pg`. If `node .next/standalone/server.js` crashes with `PrismaClientInitializationError`, add to `serverExternalPackages`. This is the #1 risk in this story.

2. **Seed in CI without running app server:** BA's `auth.api` should work as direct function calls. If it requires HTTP, seed must run AFTER server start in E2E job (reorder steps).

3. **E2E server startup failure debugging:** Server output redirected to `server.log`. On `wait-on` timeout: `cat server.log && exit 1` shows the real error. Log uploaded as CI artifact.

4. **CI database single-user:** CI Postgres has one user. Both `DATABASE_URL` and `DATABASE_MIGRATION_URL` point to same connection. Verify `test-setup.ts` doesn't expect separate roles.

5. **Static files in standalone:** Next.js standalone doesn't include `.next/static/` or `public/`. Dockerfile copies both. CI artifact includes `.next/static` but not `public/` (already in repo checkout).

6. **First CI run bootstrapping:** The workflow file being added in this PR IS the workflow that validates this PR. GitHub Actions reads workflow definitions from the PR branch for `pull_request` triggers, so it should work automatically.

### Technology Versions

| Package | Version | Notes |
|---------|---------|-------|
| Next.js | 16.1.6 | Standalone output mode |
| Node.js | 22 | Alpine for Docker, ubuntu-latest for CI |
| PostgreSQL | 17 | Service container image |
| Playwright | 1.58 | E2E with Chromium |
| Prisma | 7.4.2 | migrate deploy in CI |
| Biome | 2.4.6 | Lint in CI |
| TypeScript | 5.x | typecheck in CI |
| GitHub Actions | v4 | checkout, setup-node, upload/download-artifact, cache |

### References

- [Source: planning-artifacts/epics.md — Epic 1, Story 1.6 (lines 470-489)]
- [Source: planning-artifacts/architecture.md — D5: CI/CD Pipeline Structure (lines 679-710)]
- [Source: planning-artifacts/architecture.md — Updated CI/CD Pipeline (lines 1633-1660)]
- [Source: planning-artifacts/architecture.md — Deployment Topology (lines 324-329)]
- [Source: planning-artifacts/architecture.md — Test Architecture (lines 338-348)]
- [Source: planning-artifacts/architecture.md — E2E Test Structure (lines 1003-1013)]
- [Source: planning-artifacts/architecture.md — D7: Environment Variables (lines 721-732)]
- [Source: planning-artifacts/architecture.md — D8: Database Backup Strategy (lines 734-738)]
- [Source: planning-artifacts/architecture.md — Package Scripts (lines 1608-1625)]
- [Source: planning-artifacts/architecture.md — .env.example (lines 1202-1227)]
- [Source: planning-artifacts/architecture.md — Test Database Lifecycle (lines 1572-1589)]
- [Source: planning-artifacts/architecture.md — Implementation Sequence (lines 751-761)]
- [Source: implementation-artifacts/1-5-tenant-management-profile.md — Seed script, sidebar, test patterns]
- [Source: docker-compose.yml — Dev and test database configuration]
- [Source: playwright.config.ts — Existing E2E configuration with CI checks]
- [Source: vitest.config.ts — Dual-project test setup]
- [Source: CLAUDE.md — Boundaries, conventions, git workflow]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

### Completion Notes List

- Task 0: All 8 gates passed. Standalone output works with Prisma (no additional serverExternalPackages needed). Selector contract: login uses label "Email"/"Password", button "Sign in", redirect to /dashboard. Sidebar uses Link (a tags) — owner sees 8 items, accountant sees 3. tsx not in deps — needs adding. prisma generate not in postinstall — needs explicit CI step.

### File List
