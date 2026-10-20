# AF Constitution

**Single source: [`docs/constitution.md`](../../docs/constitution.md).** This file is a pointer so spec-kit workflows find it; do not duplicate content here.

Version 1.1.0 · Ratified 2026-10-20 · Amended 2026-10-20 (3a layout) · Amendments are PRs against `docs/constitution.md` that bump the version line there.

## Constitution check (used by /speckit-plan)

Before planning any feature, read `docs/constitution.md` in full and verify the plan against:

- §1 Principles — the accountant books, linking is the product, simplify the mechanism never the capability, settings only when two tenants differ, derived never typed, immutable money facts, build for one architect for many, local first, nothing assumes uptime
- §2 Architecture — kernel vs modules, import rules enforced by the guard test, module contract (`index.ts` DTOs, `ServiceResult`, `can()`, audit, `linkable`), linking invariants, data rules
- §3 Portability and §3b UI rules — env vars only, adapters for storage/OCR, full-width layout, kernel `DataTable`
- §4 Definition of done — the PR checklist in `.github/pull_request_template.md`
- §5 Process — spec per module in `specs/<module>/`, reference slice first, contracts frozen before fan-out, shared files serialised, trunk `main`

Related context every spec must read: `docs/feature-inventory.md` (decisions D1–D20, module verdicts, harvest list), `docs/excel-to-v3-mapping.md` (business rules), `docs/ui-conventions.md`, and the skills under `.claude/skills/`.
