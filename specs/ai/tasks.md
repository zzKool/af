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

- [ ] T013 Prompts `bas-proposal` / `partner-proposal` v1 (static prefix first), output schemas with the active-code enum
- [ ] T014 Stage 2 in the run: only what stage 1 left open or disagrees on; one request at a time; timeout → skip
- [ ] T015 `npm run ai -- eval` (counts only)
- [ ] T016 The mock's fixed answers for the e2e; docs
