# Phase 0 — organisation and ingredients

Status board for everything before the first business feature. Tick, don't rewrite. Decisions go to `feature-inventory.md` §1.

## Done
- [x] Feature inventory v1 ∪ v2 ∪ PRD ∪ Excel → `docs/feature-inventory.md` (decisions D1–D18)
- [x] Excel business rules mapped → `docs/excel-to-v3-mapping.md`
- [x] Linking design: single `link` table, registered linkables, invariants in DB + service, read models on top
- [x] Hosting: one image + Postgres + blob + OCR; local first, Azure Container Apps (scale to zero) later; ~€17–20/month
- [x] Constitution v1 → `docs/constitution.md`; agent context → `CLAUDE.md`
- [x] UI direction: full-width layout + Excel-style DataTable → `docs/ui-conventions.md` (D19, D20, H13)
- [x] Repo seeded from `defterfab` `develop` (history kept, `main` = v2 develop, BMAD stripped, CI on `main`, remote `defter` as read-only reference)

## Next — in order
- [x] **0. GitHub repo** `zzKool/af` pushed (2026-10-20); CI green on `main`. Open: branch protection when on GitHub Pro.
- [ ] **1. Rename pass** — README, `docs/index.md` title, seed tenant name, Docker DB names (`defterfab_dev` → `af_dev`) with `.env.example` and CI in the same PR. Optional; do it before any migration lands.
- [ ] **2. Tooling**
  - [x] Windows: postinstall replaced by `scripts/copy-pdf-worker.mjs` (no `cp`/`mkdir -p`)
  - [x] Prisma schema reconciled with the hand-written migrations (`migrate dev` no longer proposes a repair migration) — see `docs/prisma-rls-setup.md`
  - [ ] CI: add a drift check step (`prisma migrate diff --from-migrations … --to-schema-datamodel … --exit-code`) so this cannot regress
  - [x] CI cost: E2E only on `main` pushes + manual dispatch; PRs run lint/typecheck/unit/build (PR #3)
  - [ ] spec-kit: `uv tool install specify-cli`, then in `C:\af`: `specify init --here --integration claude` (or `specify init . --integration claude`), then `/speckit-constitution` fed from `docs/constitution.md`
  - [x] MCP in `.mcp.json`: Playwright (screenshots), Context7 + Microsoft Learn (Next 16 / Prisma 7 / Better Auth docs), Postgres (`postgres-mcp`, restricted, needs `uv`). Approve them on first Claude Code start in the repo.
  - [x] Skills in `.claude/skills/`: `server-action-pattern`, `module-slice` (draft, finalised after item 6), `invoice-pdf`, `test-conventions`, `bas-accounting`
  - [x] PR template with the definition-of-done checklist (`.github/pull_request_template.md`)
  - [x] First PR through the gate: `chore/phase-0-tooling` → `main` (#1, merged 2026-10-20)
- [ ] **3. Structural moves** (specs under `specs/structure-*`, one PR each, run on partners / documents / settings)
  - [x] 3a feature folders + kernel; guard test for the import rules; `prisma/schema` split per module (PR #2) — see `docs/feature-folders.md`
  - [x] 3b module surfaces `index.ts` (server) + `ui.ts` (client), DTOs for partners/contracts, `…Action` naming, guard rules (PR #3)
  - [x] 3c `modules/linking`: `links` table + migration (RLS, CHECKs, delete trigger on documents), kinds matrix, allocation math (property-tested), service + actions, `Linkable` registry with partners/contracts/documents registered, guard rule (PR #4) — see `docs/linking.md`
  - [x] 3d `queries.ts` per module as the named read API; pages import surfaces only (PR #3). Real query implementations (`ListQuery`, distinct values) come with the reference slice (item 6/8)
- [ ] **4. Kernel changes**
  - [x] Inngest → pg-boss (`kernel/jobs`), resumable handlers, catch-up on startup — 2026-10-20, see `docs/async-jobs.md`
  - [x] `kernel/auth/can()` with the role table (superadmin, owner, accountant, editor), `requireCaller()` for pages, guard rule — every inline role check replaced (PR #5)
  - [x] `kernel/pdf`: Chromium in the image, print-mode rendering, one Dockerfile stage — 2026-10-20, see `docs/pdf.md`
  - [x] `number_series` + fixed business-key functions; `DocumentTypePrefix` engine + settings page removed — 2026-10-20, see `docs/numbering.md`. **Open: the DROP of `document_type_prefixes` + `document_key_counters` waits for your OK (data-dropping migration).**
  - [x] `docker-compose.prod.yml` (same image, no bind mounts, `.env.prod`) + `scripts/backup.sh` (PR #5)
- [ ] **5. Harvest specs** from `af_core` (behaviour + fixtures, no code) — H1–H13 in `feature-inventory.md` §6
- [ ] **6. Reference slice**: rebuild `partners` in the module layout by hand → extract `module-slice` skill
- [ ] **7. Verify gate wired**: CI + screenshot step + flaky quarantine; first PR through the full gate
- [ ] **8. Kernel UI**: app shell full-width (D19) + `DataTable` with typed header filters and `ListQuery` helper (D20, H13) — built once on `partners`, before the parallel batch

Then phase 1: contracts frozen for the batch → parallel agents on invoices / banking + journal / expenses + traktamente / supplier invoices → linking → exports → dashboard.

## Open points (non-blocking)
- Settlement allocation default: FIFO by expense date with manual override — confirm.
- Exchange-difference category on cross-currency settlements — ask the accountant.
