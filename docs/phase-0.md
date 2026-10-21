# Phase 0 — organisation and ingredients

Status board for everything before the first business feature. Tick, don't rewrite. Decisions go to `feature-inventory.md` §1.

## Done
- [x] Feature inventory v1 ∪ v2 ∪ PRD ∪ Excel → `docs/feature-inventory.md` (decisions D1–D18)
- [x] Excel business rules mapped → `docs/excel-to-v3-mapping.md`
- [x] Linking design: single `link` table, registered linkables, invariants in DB + service, read models on top
- [x] Hosting: one image + Postgres + blob + OCR; local first, Azure Container Apps (scale to zero) later; ~€17–20/month — **the images are published by CI since 2026-10-20** (`ghcr.io/zzkool/af` + the one-shot migrate image), the homelab runbook, backups + the restore drill and `/api/health` are in `docs/deployment.md`
- [x] Constitution v1 → `docs/constitution.md`; agent context → `CLAUDE.md`
- [x] UI direction: full-width layout + Excel-style DataTable → `docs/ui-conventions.md` (D19, D20, H13)
- [x] Repo seeded from `defterfab` `develop` (history kept, `main` = v2 develop, BMAD stripped, CI on `main`, remote `defter` as read-only reference)

## Next — in order
- [x] **0. GitHub repo** `zzKool/af` pushed (2026-10-20); CI green on `main`. Open: branch protection when on GitHub Pro.
- [ ] **1. Rename pass** — README, `docs/index.md` title, seed tenant name, Docker DB names (`defterfab_dev` → `af_dev`) with `.env.example` and CI in the same PR. Optional; do it before any migration lands.
- [ ] **2. Tooling**
  - [x] Windows: postinstall replaced by `scripts/copy-pdf-worker.mjs` (no `cp`/`mkdir -p`)
  - [x] Prisma schema reconciled with the hand-written migrations (`migrate dev` no longer proposes a repair migration) — see `docs/prisma-rls-setup.md`
  - [x] CI: schema ↔ migrations drift check after `migrate deploy` in the unit-test job, failure annotated (PR #9)
  - [x] CI cost: E2E only on `main` pushes + manual dispatch; PRs run lint/typecheck/unit/build (PR #3)
  - [x] spec-kit initialised in PR #1 (`.specify/`, the `speckit-*` skills in `.claude/skills/`, `.specify/memory/constitution.md` → `docs/constitution.md`); the loop as applied is in `docs/roadmap.md`
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
  - [x] `number_series` + fixed business-key functions; `DocumentTypePrefix` engine + settings page removed — 2026-10-20, see `docs/numbering.md`. The two v2 tables dropped on your OK the same day (`20261020200000_drop_v2_prefix_tables`, D30).
  - [x] `docker-compose.prod.yml` (same image, no bind mounts, `.env.prod`) + `scripts/backup.sh` (PR #5)
- [x] **5. Harvest specs** from `af_core` (behaviour + fixtures, no code) — H1–H13 in `feature-inventory.md` §6 — 2026-10-20: `specs/<module>/harvest.md` for invoices (H1 H2 H6), banking (H3 H4 H11), contracts (H5), documents (H7), expenses (H8), traktamente (H9), supplier-invoices (H10), accountant-package (H12), kernel-ui-datatable (H13); open questions in each §9 — **answer them before the module's `/speckit-specify`**
- [x] **6. Reference slice**: `partners` on the full module layout (ListQuery `queries.ts`, DataTable list page, entity page, short code) → `module-slice` skill finalised — 2026-10-20, see `docs/partners.md`
- [x] **7. Verify gate wired**: drift check (PR #9), `retries: 0` + `quarantine()` helper, `e2e/screenshots.spec.ts` → `page-screenshots` artifact on `main`, partners happy path `e2e/partners.spec.ts` — 2026-10-20, see `docs/verify-gate.md`
- [x] **8. Kernel UI**: app shell full-width (D19) + `DataTable` with typed header filters and `ListQuery` helper (D20, H13) — built on `partners` 2026-10-20, see `docs/ui-conventions.md`. Per-user column order / width / visibility (`table_preferences`) built 2026-10-21. The documents library moved onto the new table on 2026-10-20.

Then phase 1: contracts frozen for the batch → parallel agents on invoices / banking + journal / expenses + traktamente / supplier invoices → linking → exports → dashboard — **done 2026-10-20 → 21**; what is left is in [[roadmap]].

## Open points
Consolidated in [[open-questions]] (blocking B1–B15, the rest during the build) — **all answered 2026-10-20**, recorded as D21–D32 in [[feature-inventory]]; nothing gates a module spec any more.

## Open points (non-blocking, from before the harvest)
- Settlement allocation default: FIFO by expense date with manual override — confirmed (D26).
- Exchange-difference category on cross-currency settlements — BAS 3960/7960 (D26), the accountant confirms the pair.
