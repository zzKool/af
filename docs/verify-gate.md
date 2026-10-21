# The verify gate

Phase-0 item 7 (2026-10-20). What every change passes before it reaches `main`, and where each check lives. Constitution §4 is the rule; this page is the plumbing.

## On every pull request (`.github/workflows/ci.yml`)
| job | what | fails when |
|---|---|---|
| `lint` | `biome check .` | formatting or lint errors (warnings pass) |
| `typecheck` | `tsc --noEmit` | any type error |
| `unit-test` | `prisma migrate deploy` on a fresh Postgres 17 → **schema ↔ migrations drift check** → `vitest run` (server + pure + client projects) | a migration and the schema disagree (annotated on the run), any test red; the architecture guard is one of the tests |
| `build-and-e2e` | `next build` | the app does not build |

## On `main` (after merge) and on `workflow_dispatch`
The same, plus Playwright: migrations + seed + Azurite, `next start`, `npm run e2e`. Two artifacts: `playwright-report` (traces and failure screenshots) and **`page-screenshots`** — `e2e/screenshots.spec.ts` captures every page as the seeded owner, so each run on `main` leaves pictures a human can look at (§4.5). PR authors still attach their own screenshots of new pages and PDFs.

## Flaky tests
`retries: 0` — nothing is retried into green. A test that fails without a code change is quarantined in the same PR: `quarantine("#<issue> — why")` from `e2e/fixtures/quarantine.ts` as the first line of the test (Vitest: `it.skip` with the same comment), the issue tracks the fix. Traces are kept on failure.

## Locally, before pushing
```
npm run lint && npm run typecheck && npm run test     # the PR gate
npm run build                                         # what CI builds
npx playwright test e2e/<module>.spec.ts              # the module's happy path against `npm run dev`
```
Without the Prisma engine (restricted networks): apply `prisma/migrations` with psql and run the server project with `SKIP_MIGRATE_DEPLOY=1` (see `src/kernel/db/test-setup.ts`).
In a sandbox without Docker Hub / the Prisma CDN / Google Fonts (a cloud agent session), the same loop still runs:
- `prisma generate` with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true` (generate needs no schema engine); a local PostgreSQL (16 works) on 5433 with the `defterfab` superuser, the migrations applied with psql.
- **Both timezones UTC**, as on CI: `ALTER SYSTEM SET timezone = 'UTC'` on the server and `TZ=UTC` for the test process — otherwise timestamps written through the Prisma adapter shift by the server's offset and the time-window tests (stuck OCR, archived-at) fail for the wrong reason.
- Azurite from npm (`npx azurite-blob --blobHost 127.0.0.1 --skipApiVersionCheck --loose`).
- The build: `next build --webpack` with `NEXT_FONT_GOOGLE_MOCKED_RESPONSES` pointing to a file that maps the two `css2?family=Geist…` URLs to an `@font-face` whose `src` is a local `.woff2` path (Turbopack ignores the mock for the font file itself). Then `next start` and `CI=1 npx playwright test` like CI.

## Definition of done, where it is checked
| §4 item | where |
|---|---|
| spec checklist ticked | PR template, `specs/<module>/tasks.md` |
| lint / typecheck / test green, guard passes | PR jobs |
| e2e happy path green, flaky quarantined | `main` run; `e2e/<module>.spec.ts` |
| property tests on money / allocations | `*.pure.test.ts` with fast-check (allocation, numbering, list-query) |
| screenshots of pages and PDFs | PR body; `page-screenshots` artifact on `main` |
| `docs/<module>.md` linked from the index | PR template |
| no secrets / SAS URLs / `console.*`; audit rows | guard test (`console`), review |
| shared files touched → no other open PR on them | PR template |

Related: [[constitution]], [[feature-folders]], [[async-jobs]] (jobs run in e2e too), [[partners]] (reference happy path).
