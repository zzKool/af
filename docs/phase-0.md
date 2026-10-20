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
- [x] **0. GitHub repo** `zzKool/af` pushed (2026-10-20). Open: confirm CI green on `main`; branch protection when on GitHub Pro.
- [ ] **1. Rename pass** — README, `docs/index.md` title, seed tenant name, Docker DB names (`defterfab_dev` → `af_dev`) with `.env.example` and CI in the same PR. Optional; do it before any migration lands.
- [ ] **2. Tooling**
  - [x] Windows: postinstall replaced by `scripts/copy-pdf-worker.mjs` (no `cp`/`mkdir -p`)
  - [ ] spec-kit: `uv tool install specify-cli`, then in `C:\af`: `specify init --here --integration claude` (or `specify init . --integration claude`), then `/speckit-constitution` fed from `docs/constitution.md`
  - [x] MCP in `.mcp.json`: Playwright (screenshots), Context7 + Microsoft Learn (Next 16 / Prisma 7 / Better Auth docs), Postgres (`postgres-mcp`, restricted, needs `uv`). Approve them on first Claude Code start in the repo.
  - [x] Skills in `.claude/skills/`: `server-action-pattern`, `module-slice` (draft, finalised after item 6), `invoice-pdf`, `test-conventions`, `bas-accounting`
  - [x] PR template with the definition-of-done checklist (`.github/pull_request_template.md`)
  - [ ] First PR through the gate: `chore/phase-0-tooling` → `main`
- [ ] **3. Structural moves** (specs under `specs/structure-*`, one PR each, run on partners / documents / settings)
  - [ ] 3a feature folders + kernel; guard test for the import rules
  - [ ] 3b DTOs on each module's `index.ts`, Prisma types stay inside
  - [ ] 3c `modules/linking` skeleton: `link` table, kinds, invariants, `linkable` registration; move v2 document links there
  - [ ] 3d `queries.ts` per module; pages stop importing services
- [ ] **4. Kernel changes**
  - [ ] Inngest → pg-boss (`kernel/jobs`), resumable handlers, catch-up on startup
  - [ ] `kernel/auth/can()` with the role map (superadmin, owner, accountant, editor); guard rule
  - [ ] `kernel/pdf`: Chromium in the image, print-mode rendering, one Dockerfile stage
  - [ ] `number_series` + fixed business-key functions; remove `DocumentTypePrefix` + settings page
  - [ ] `docker-compose.prod.yml` (same image, no bind mounts) + backup script
- [ ] **5. Harvest specs** from `af_core` (behaviour + fixtures, no code) — H1–H13 in `feature-inventory.md` §6
- [ ] **6. Reference slice**: rebuild `partners` in the module layout by hand → extract `module-slice` skill
- [ ] **7. Verify gate wired**: CI + screenshot step + flaky quarantine; first PR through the full gate
- [ ] **8. Kernel UI**: app shell full-width (D19) + `DataTable` with typed header filters and `ListQuery` helper (D20, H13) — built once on `partners`, before the parallel batch

Then phase 1: contracts frozen for the batch → parallel agents on invoices / banking + journal / expenses + traktamente / supplier invoices → linking → exports → dashboard.

## Open points (non-blocking)
- Settlement allocation default: FIFO by expense date with manual override — confirm.
- Exchange-difference category on cross-currency settlements — ask the accountant.
