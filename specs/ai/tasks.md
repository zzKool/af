# Tasks — F98 (local AI proposals)

Spec `spec.md` · plan `plan.md`. PR 1 = T001–T012, PR 2 = T013–T016.

## PR 1 — `feat/ai-kernel-proposals` (no model needed)

- [x] T001 Schema + migration `add_proposals` (enums, table, composite FK RESTRICT, RLS, grant); `cleanupTestData` truncates it
- [x] T002 `kernel/ai`: provider resolution, `complete()` with the JSON schema + Zod re-parse, timeout, `aiStatus()`; mock only when named; tests on recorded responses
- [x] T003 Guard: `AI_*` env vars and model SDKs only in `kernel/ai`; `/api/health` gains `ai`; [[environment-variables]]
- [x] T004 `banking.categoryMemory(tx, keys)` (manual rows only) + DB test
- [x] T005 `stage1.ts`, `policy.ts`, `facts-hash.ts`, `payload.ts` (pure) + pure / property tests
- [x] T006 `proposals.ts`: run, current, accept (one transaction, audit, rule offer), reject (skip by facts hash), drop, stats, open rows; DB tests incl. RLS and the accountant
- [x] T007 Jobs: `linking.propose-for-rows` (after an import commits), `linking.propose-nightly` (03:30 Stockholm, `once`, every tenant's owner); `kernel/auth` `tenantOwners`; wired in `instrumentation.ts`
- [x] T008 `deleteImport` drops the rows' proposals first (D63, no cascade)
- [x] T009 Actions: get / accept / reject / run now / AI status
- [x] T010 UI: `ProposalLine` + `CategoriseForm` pre-fill (HIGH, `PREFILL_HIGH`); the *Proposed* column; Settings → AI (status, model, last run, acceptance rates, *Run now*); `SUB_PAGES`; `en.ts`
- [x] T011 e2e `ai-proposals.spec.ts` + screenshots (seed data)
- [x] T012 Docs: [[local-ai]] (what exists), [[linking]], [[banking]], [[environment-variables]], [[features]] F98

## PR 2 — `feat/ai-model-stage`

- [x] T013 Prompt `bas-proposal` v1 (static prefix first), output schema with the active-code enum (2026-10-31)
- [ ] T013b Prompt `partner-proposal` v1 + `newPartner` — after F126 (the category was the owner's ask)
- [x] T014 Stage 2 in the run: only what stage 1 left open (a disagreement keeps stage 1's capped answer + alternative); one request at a time, ≤ 60 per run; timeout retried once; unreachable stops the run
- [x] T015 The eval — `npx tsx scripts/ai-eval.ts` (no `package.json` script: one less serialised file), counts only
- [x] T016 The mock's fixed answer (`linking.bas-proposal`); docs. CI keeps AI off (the stage-1 e2e asserts it), stage 2 is covered by DB tests with an injected service
- T013–T016 revised by `spec-suggest-from-first-entry.md` FR-201: the prompt carries the active accounts' *Use for* notes; no name → account mapping anywhere

## F126 — the rest of "suggested from the first entry" (`spec-suggest-from-first-entry.md`)

- [x] T101 `feat/settings-bas-notes`: `use_for` + `use_for_state` columns; `draftUseForNotes` (prompt `bas-use-for` v1); Settings → BAS *Use for* line, *Draft with AI*, *Confirm all*; tests (a confirmed note never overwritten)
- [ ] T102 `feat/ai-document-proposals`: `document` target + FK RESTRICT; drop with the document; stage 1 + 2 on OCR'd documents; job after OCR; tests incl. RLS
- [ ] T103 Same PR: the SI / expense dialogs and the Justify card read the document's proposals (*AI proposal*, HIGH pre-filled dashed); save = accept / other code = reject; e2e with the mock
- [ ] T104 `feat/settings-bas-four-digit` (D68): four-digit chart from the two XLSX files; `NNN` → `NNN0` everywhere in one migration; migration test; deploy on the owner's word
