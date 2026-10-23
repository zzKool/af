# Tasks: Traktamente — normalbelopp table, trips, the per-diem expense

Spec: `spec.md` (+ `harvest.md`, the v1 / Excel input it was written from). No `plan.md` (D45: a plan only on a schema change) and no phases before this one: the module was built from `spec.md` inside expenses' two PRs (`feat/expenses-core`, `feat/expenses-pages`; [[features]] F19), then F62 (the trip snapshot). Each task names its lane (D45) and the shared files it touches.

## Phase 1: Convergence

`/speckit-converge`, 2026-10-23 (F80): `spec.md` against `main` (`e6f44b1`) — `src/modules/traktamente/**`, `prisma/schema/traktamente.prisma` and its two migrations (checks included), expenses' `createPerDiemExpense` / `replacePerDiemExpense`, `/settings/traktamente`, `/print/per-diem/[groupId]`, the `traktamente.*` keys (en / fr / sv, same 61), the fixtures. Checked: 4 user stories (19 acceptance scenarios), 6 FRs, 3 SCs, D29, D-e, D-f, F62, the constitution's module contract and money rules. The calculator holds every fixture, boundary, the DST weekend, the two rate years and the property test; 3 gaps, all around the per-diem expense and the panel.

- [ ] T001 Make a recompute of unchanged inputs a no-op: `createOrReplacePerDiemExpense` always rewrites the open expense, stores a new snapshot (`computedAt` differs, so US3/AC2's *the snapshot is identical* never holds) and clears `per_diem_document_id` — the job renders the same breakdown again and the earlier PDF stays in the library, one more per click. When the new breakdown equals the stored one (all but `computedAt`) and the expense already carries it, return the trip and the expense as they are. Same function: `Number(result.total) <= 0` → a Decimal comparison. Test: two clicks on the same inputs → one expense, the same snapshot, one document. DIRECT per US3/AC2 (partial, MEDIUM)
- [ ] T002 Hide the category select once the per-diem expense exists: the panel shows it beside *Recompute*, but `replacePerDiemExpense` keeps the expense's category (its key carries the BAS alias, `Ex213-Tr-nn`), so a change there is silently dropped. Show the expense's category read-only instead; component test. LIGHT per US3, FR-006 (contradicts, LOW)
- [ ] T003 Translate what the result card shows from the server: the reason (*no overnight stay*), the warnings (*trip spans two rate years (2025, 2026)*, *the meal deduction exceeds the day amounts*) and the computation error (*No travel allowance rate for CH in 2026*, which already carries `{countryCode, year}`) print the calculator's English in fr / sv. Per [[ui-conventions]] (*services return English + details, the component picks the key*): a code and its params beside each warning in the snapshot (old snapshots still parse — `parsePerDiemResult`), keys `traktamente.trip.warning.*` / `traktamente.trip.error.*`. Same PR: the print route types the sheet's locale `"en" | "fr" | null` (sv exists) and passes `prefs.locale ?? null`. Touches **i18n** — serialised. LIGHT per FR-006, US4/AC3 (partial, LOW)

Already tracked elsewhere — no task here, so `tasks.md` and [[features]] never disagree:

- `deleteRate` bounds the year in UTC while trips are counted in Stockholm (a return at 00:30 on 1 January lets the new year's row go) → **F67** (lessons audit 28)
- the error helpers written twice (`trip.ts`, `rates.ts`) → **F67** (audit 32)
- `upsertTrip` reads `expense_groups` itself instead of `expenses.getGroup` → **F66** (audit 25)
- `SEK` in the description, the note, the panel and the sheet → **F70** (D39)
- the panel's on-screen money through `formatCurrency` → **F71** (D40 kit; the printed sheet keeps it)

Read, no task (the spec says it two ways; the code follows the later, more precise line):

- US2 says Sweden's meal amounts are *halved and rounded for a half day*; US2/AC5 says meals are counts for the whole trip, *never placed on a day* — no meal can fall on a half day, the code deducts the full krona amounts.
- US2 says D-f *dropped* the night allowance from the UI; FR-006 asks for *collapsed nights / long stay* — the panel has them collapsed.
