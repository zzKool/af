# Completeness by balance — F115 (audit B4)

**Branch**: `feat/banking-completeness` · **Status**: built 2026-10-27 · decisions D25 (the row, verbatim), D59 (the row carries its facts) · docs `docs/banking.md` *Completeness*

> The product's promise is *every row justified*. That promise is empty if a row never arrived: an export can start a day late, two exports can leave a week between them, a re-import can double a row. The bank gives the proof on every day that has rows — the **running balance** after the day's last row. The chain `balance(d₁) + Σ amount(rows with d₁ < date ≤ d₂) = balance(d₂)` holds exactly when every row between two balanced days is here; it breaks by exactly what is missing. Nothing is stored for it: the balance is a column the import already keeps (D25), the chain is derived.

## The rule (four lines)

1. Per account, order the rows by booking date. A day's **end-of-day balance** is the balance on its latest row (Nordea lists newest first and gives the balance on the first row of each day; an older export with a balance on every row takes the one that agrees with the chain). Days without a balance are summed into the next balanced day.
2. From one balanced day to the next: *expected* = previous balance + Σ amounts up to and including this day. When *actual* ≠ *expected*, that is a **gap**: `{from, to, expected, actual, difference = actual − expected}` — the difference is what the missing (or doubled) rows add up to. The chain re-syncs on the bank's balance and goes on.
3. **`completeFrom`** = the first balanced day (nothing before it is proven — a row of that day could be missing too); **`completeTo`** = the last balanced day the chain reaches before its first gap. Every row after `completeFrom` up to `completeTo` is present.
4. A **month is complete** when `completeFrom` lies before its first day and `completeTo` on or after its last day — never on half a month, never the month still running, never the month the first export starts in, never a month after a gap.

## Where it shows

- **The import** reports the chain of the whole account after the file is in: *Balance chain: complete to 2026-07-28*, and the gaps — *Gap between 2026-06-28 and 2026-07-10: the balance is off by −200.00 SEK — rows missing between exports? Export those days again.* Reported, never refused: a gap between two exports is the owner's cue to export the missing days; a broken chain inside one file is the bank's to explain. The import summary carries `completeTo`, `balanceGaps`, `currency`.
- **The Months grid** gets a fourth cell state, **incomplete**: every row justified, but the chain does not prove the month whole (blue, the in-progress family). *Proven* now means justified **and** complete. Each account row says *complete to <date>* (and *N gap(s)* when there are any), or *no balance chain yet*.
- **Read API** `banking.accountCompleteness(tx, accountIds?)` → `Map<accountId, Completeness>`; pure `balanceChain(rows)`, `monthComplete(c, month)`, `lastDayOf(month)` in `banking/completeness.ts`, exported for the package later (a *complete* flag per month in the accountant's notes is PR-sized follow-up, not here).

## Worked cases (the synthetic fixtures)

| | rows | chain |
|---|---|---|
| `nordea-chain-2026-06.csv` | May 31 fee −40 (10 000.00) · Jun 2 −100 (9 900.00) · Jun 10 −250 and −50 (9 600.00, one balance) · Jun 28 +1 000 (10 600.00) | holds: complete from 2026-05-31 to 2026-06-28 |
| `nordea-chain-2026-07-gap.csv` after it | Jul 10 −10 (10 390.00) · Jul 31 −300 (10 090.00) — the −200 of Jul 3 never exported | one gap 2026-06-28 → 2026-07-10, expected 10 590.00, actual 10 390.00, difference −200.00; complete to 2026-06-28; June proven, July incomplete |
| the July re-export with the 3rd | + Jul 3 −200 (10 400.00) | the gap closes: complete to 2026-07-31 |
| a doubled row | the June 2nd row twice | a gap of +100.00 the other way |
| no balance column (another bank) | — | nothing is ever proven: every justified month is *incomplete* |

Property (fast-check): a consistent statement has no gap; dropping any row but the first and the last produces exactly one gap whose difference is that row's amount, and `completeTo` is the day before.

## Not here

A *complete* column in the accountant package's notes; a gap as a package flag; the dashboard's wording. All read `accountCompleteness` when wanted.
