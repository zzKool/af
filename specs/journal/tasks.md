# Tasks: Journal — the categorised ledger

Spec: `spec.md`. No `plan.md` (D45: a plan only on a schema change) and no phases before this one: the journal was built from `spec.md` inside banking's two PRs (`feat/banking-import`, `feat/banking-pages`; [[features]] F27). Each task below names its lane (D45) and the shared files it touches; one PR per task unless two sit in the same file.

## Phase 1: Convergence

`/speckit-converge`, 2026-10-23 (F77): `spec.md` against `main` (`e468620`) — `src/modules/journal/**`, the trigger in `20261021100000_add_banking_import_and_journal`, `can.ts`, linking's `kinds.ts` / `linking.ts`, banking's callers (`import.ts`, `rules.ts`, `transfer-pairs.ts`), `/journal`. Checked: 6 FRs, 3 SCs, 14 acceptance scenarios + 4 edge cases, D1 / D2 / D3 / D33 / D44, the constitution's module contract and money rules. 8 gaps, no constitution violation inside the module (banking reads `journal_entries` directly — audit 24, F66).

- [x] T001 Refuse a bank entry as the `from` of a link: `journalEntryLinkable.exists` answers true for every entry, so `createLinkAction` accepts a bank-sourced journal entry as a `justifies` source — the same bank movement can then be allocated twice (once from its transaction, once from its entry; the R19 source cap counts each `from` alone). Only `source_type = manual` may be a link endpoint; DB test: a `justifies` from a bank entry is refused, from a manual entry accepted. DIRECT per FR-004 (contradicts, MEDIUM)
- [ ] T002 Propose the partner's default category in the categorise form and the *New entry* dialog: picking a partner on an entry with no category fills `partners.defaultBasCategoryCode` (the owner can change it before it saves); `PartnerOption` carries the code. Written as the owner's choice (`categorised_by = manual`) — `partner_default` stays the rule path's value (audit 32, F67). Component test. LIGHT per US2 (missing, MEDIUM)
- [x] T003 Give manual entries a way to be justified: the side panel lists the entry's links (through `linking`'s read API) and, for a manual entry, offers *Link to…* (document, invoice, supplier invoice, expense — the `justifies` targets, minus D37's own-payment entities); a bank entry's panel points to its transaction instead. Today no screen creates a link from a journal entry. LIGHT per US3, FR-004 (missing, MEDIUM)
- [x] T004 Add the *links state* column to the ledger (justified / partly / none / no document needed — derived from links, never typed), filterable like the others. LIGHT per US4 (missing, MEDIUM)
- [x] T005 Clear `bank_implicit_rate` when a transfer pair is unpaired, or derive it from the `transfer` link: the set-once trigger keeps the first pair's rate after an unpairing, and a re-pair with another leg cannot replace it (D44 derives "transfer" from the link; the rate still is a typed leftover). Touches **schema** (the trigger) — serialised. DIRECT per FR-002, edge case *bank_implicit_rate is informational* (contradicts, MEDIUM; lessons audit 20 *Left*). *Built 2026-10-23 as derived — no migration: `implicit-rate.ts` computes it from the `transfer` link on every read; the column is no longer read (T010).*
- [ ] T006 Show the bank account alias in the *Source* column and the panel badge (*Nordea CHF* rather than *Bank*): a banking read API `accountAliasesFor(tx, transactionIds)` joined in `queries.ts` like the partner name — the journal still never reads banking's tables. LIGHT per US4 (partial, LOW)
- [x] T007 Show the bank implicit rate beside the ECB rate in the panel's description when set (today only in a hidden column). LIGHT per edge case *bank_implicit_rate* (partial, LOW)
- [ ] T008 Test the accountant on the journal: categorise and manual-entry actions refuse her (`FORBIDDEN`), `/journal` renders with no *New entry*, no form, no *Delete* — an e2e step with `accountant.json`, like `settings-rates.spec.ts`. The rule holds through `ownerAction`; nothing proves it for this module. DIRECT per US2/AC4, US4/AC2 (partial, LOW)
- [ ] T009 Translate the ledger's last English: `Created`, `Updated`, `(code)`, `(id)` and `(Blanks)` in `journal-table.tsx` → `journal.col.*` / `table.*` keys (en / fr / sv). Touches **i18n** — serialised; rides with F71's journal PR or F74. LIGHT per FR-006 (partial, LOW)
- [ ] T010 Drop `journal_entries.bank_implicit_rate` (unread since T005), its clause in `journal_entries_lock_money`, `setBankImplicitRate` and banking's call to it (`transfer-pairs.ts`) — a forward-only migration that drops data, so **the owner's OK first** ([[roadmap]] O8). Touches **schema** — serialised. DIRECT

Already tracked elsewhere — no task here, so `tasks.md` and [[features]] never disagree:

- banking reads `journal_entries` itself (`banking/rules.ts:450` `uncategorisedTargets`) and settings keeps a commented-out count → **F66** (audit 24)
- `base.pure.test.ts` checks `baseAmount` with its own expression (SC-001's property test proves nothing) → **F67** (audit 31)
- `partner_default` never written; a SEK manual entry with rate `1.000000` refused by string compare → **F67** (audit 32)
- `rate_source` VarChar + CHECK and a second `RateSource` type → **F67** (audit 30)
- `positiveRate` declared in three modules → **F50-j**
- `SEK` / `BASE_CURRENCY` in the service, the footer sum and the panel → **F70** (D39)
- the D40 kit (states, on-screen money) → **F71**
