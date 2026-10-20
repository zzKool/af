# 3a — Feature folders + kernel + architecture guard

Status: implemented (PR #2) · Constitution §2, §5 · Phase-0 item 3a

## Goal
Organise the v2 code by feature instead of by layer, so a module can be added, replaced or removed by touching one folder, and make the import rules executable. **No behaviour change.**

## Scope
- `src/kernel/*` for cross-cutting infrastructure; `src/modules/<m>/*` for the seven existing features (partners, contracts, documents, banking, rates, settings, dashboard); `src/app/*` routes only.
- Pure relocation + import rewrite; file names kept (`<entity>.ts`, `<entity>.actions.ts`); no renames of symbols, no logic edits.
- `prisma/schema/app.prisma` split into one file per module (+ `tenancy`, `audit`) — Prisma multi-file schema, single folder.
- Architecture guard rewritten for the layering rules enforced now; the `index.ts` rule is deferred to 3b.
- Vitest projects re-mapped (`server` DB-backed, `pure`, `client`); docs path map; constitution 1.1.

## Out of scope (next moves)
3b DTO `index.ts` surfaces · 3c linking module · 3d `queries.ts` and page imports · item 4 kernel changes (`can()`, pg-boss, pdf, number_series).

## Acceptance
- [x] `tsc --noEmit` clean · Biome clean · guard test green
- [x] Pure + client Vitest projects green locally; DB-backed project + e2e green in CI
- [x] No file left under `src/server`, `src/hooks`, `src/types`, `src/components/{domain,partners,settings,shared,providers}`
- [x] Every `.prisma` model declared exactly once; `prisma generate` output unchanged
- [x] Docs: `docs/feature-folders.md`, path mentions in the wiki updated, skills updated
