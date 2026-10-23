# Feature Specification: Base currency — each tenant's own, locked once it has money

**Feature Branch**: `feat/settings-base-currency` (PR 1: kernel + settings), then `feat/<module>-base-currency` per module

**Created**: 2026-10-23

**Status**: Draft — for the owner's read (lane FULL, F70)

**Input**: D39 (O5, 2026-10-22): "Each tenant has its own base currency (`tenants.currency`; SEK for AnalyticsFab AB). The constant `BASE_CURRENCY` goes: every base amount, `rateToBase(date, currency, base)`, Σ and tolerance is in the tenant's base, read once per request through tenancy. Chosen at tenant creation, locked once the tenant has any money fact — the company profile then shows it read-only; another base later = another tenant. Country rules keep their own currency: traktamente normalbelopp in SEK, Swiss VAT in CHF." Constitution §1.4 (1.3).

## Where it stands

```
tenants.currency  ──(nobody reads it)        editable in Settings → Company, any time
BASE_CURRENCY="SEK" ──► 33 uses in 6 modules  (journal, banking transfer pairs, expenses, settlements,
                                               supplier invoices, invoice drafts)
"SEK" literals    ──► ~70 more              (screens, statement / per-diem sheets, dashboard KPIs,
                                               package CSV headers, the owed tolerance's name)
```

After F70:

```
tenants.currency ──► kernel/tenancy baseCurrency(tx)   once per transaction (= per request / action / job)
                     │
                     ├─► services: rateToBase(…, base) · same_currency when currency = base · Σ and tolerances in base
                     ├─► (app)/layout ─► <BaseCurrencyProvider> ─► useBaseCurrency() on screens
                     └─► settings: read-only once hasMoneyFacts(tx) — the service refuses the change too
```

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The base is read, never assumed (Priority: P1) — PR 1

Any server code that needs the base asks `baseCurrency(tx)` (`kernel/tenancy`). It reads `tenants.currency` of the transaction's tenant (RLS, `app.tenant_id`) the first time and answers from memory for the rest of that transaction — one action, one page read, one job run = one read. Screens get the same value from the app layout through `useBaseCurrency()` (`kernel/money`); no component types `"SEK"` for a base.

**Acceptance Scenarios**:

1. **Given** AnalyticsFab AB (SEK) **When** a service asks the base **Then** `SEK`.
2. **Given** a CHF-base tenant **When** a service in its transaction asks **Then** `CHF` — never the other tenant's, even with both in the same test run.
3. **Given** one transaction asking three times **Then** one database read.
4. **Given** a stored value outside `CURRENCIES` (hand-edited row) **Then** the read fails loudly (`INTERNAL_ERROR` in the log), it is never treated as SEK.

---

### User Story 2 - The base locks with the first money fact (Priority: P1) — PR 1

Before any money fact exists (a new tenant), the owner may still change the base in Settings → Company — that is "chosen at creation". From the first **money fact** — a journal entry, an invoice (draft or quote included: it carries `base_currency`), an expense, a supplier invoice or a settlement — the profile shows the base as text with a line saying why it is locked, and `updateTenantProfile` refuses a different value whatever sends it.

**Acceptance Scenarios**:

1. **Given** a tenant with no money fact **When** the owner picks CHF **Then** saved, audited, and the next request's `baseCurrency` is CHF.
2. **Given** a tenant with one expense **When** the profile opens **Then** the base shows as text (`SEK`), no select, the hint *Locked: the company has money in this currency. Another base needs another company.*
3. **Given** the same tenant **When** a request sends `currency: "CHF"` to the action **Then** `BUSINESS_RULE_VIOLATION`, nothing written, no audit row.
4. **Given** the same tenant **When** a request sends its current base (`SEK`) with a new name **Then** saved — sending the unchanged value is not a change.
5. **Given** a CHF-base tenant with one expense **Then** the same lock, reading `CHF`.

---

### User Story 3 - Every module writes and shows its base in the tenant's base (Priority: P1) — one PR per module

Each module swaps the constant and its `"SEK"` literals for the read, without touching another module's folder. Rule per module: the base of a written fact = `rateToBase(date, currency, baseCurrency(tx))`; `same_currency` (rate 1) when `currency = base`; Σ, KPIs and tolerances are in the base; screens label base amounts with `useBaseCurrency()`; printed sheets and CSV headers name the base (`Amount CHF`). Facts already written keep their value — bases are written once (constitution §1.6).

| PR | Module | What changes (from the code, 2026-10-23) |
|---|---|---|
| 1 | kernel/tenancy, kernel/money, settings | US1 + US2 |
| 2 | journal | `journal.ts` base of a manual entry, the rate-1 rule; table / panel / manual-entry labels |
| 3 | banking | transfer pairs (`transfer-pairs.ts` 92–94, 224–226, 272): which leg is base, the ECB check; the transaction panel's base line; the CSV parser's empty-currency default stays the **account's** currency, not the base |
| 4 | expenses | `expenses.ts` base + rate-1 rule + `isProvisional` (172); the per-diem private source (617–645, see US4); `settlements.ts` messages; `OPEN_BASE_TOLERANCE_SEK` → `OPEN_BASE_TOLERANCE` (0.50 of the base); screens and the statement sheet |
| 5 | supplier-invoices | `supplier-invoices.ts` base + rate-1 rule + the line at 420; `payments.ts` 274; screens |
| 6 | invoices | `drafts.ts` 63, 126: a new draft's `base_currency` snapshot is the tenant's base (issued invoices keep theirs) |
| 7 | traktamente | US4 |
| 8 | dashboard, package, partners, linking | KPIs (`overview.ts` 113–241), the package CSV headers and notes, the partner page's base line; linking compares stored bases already — its "SEK" is in comments and the candidate labels only |
| 9 | kernel/nav | `BASE_CURRENCY` and its test removed — last, when nothing imports it (nav constants: serialised) |

**Acceptance Scenarios** (each module PR, on the CHF-base fixture beside the SEK one):

1. **Given** a CHF-base tenant **When** a CHF fact is written **Then** rate 1, `same_currency`, base = amount.
2. **Given** a CHF-base tenant **When** a SEK fact is written **Then** base = SEK amount × the date's SEK→CHF rate (`ecb_daily` / `ecb_nearest`), and no rate within 4 days → the usual *run the ECB sync* refusal.
3. **Given** the SEK tenant **Then** every existing test passes unchanged — F70 changes nothing for AnalyticsFab AB.

---

### User Story 4 - Country rules keep their own currency (Priority: P2) — in the module's PR

- **Traktamente** (PR 7): Skatteverket's normalbelopp are SEK and stay SEK. The per-diem expense is written **in SEK** from the owner's private SEK source (`Private SE`), and the expenses service converts it to the base at the trip's departure date like any foreign expense. Today `expenses.ts:617` looks for "the private source in the base currency" — for a CHF base that would find `Private CH`; it must look for the private **SEK** source, by currency, not by base.
- **Swiss VAT** (no PR expected): the return is in CHF. `exports/queries.ts:62` already converts each invoice from **its own** currency to CHF (`rateToBase(…, "CHF")`) and never reads a base — a CHF base makes CHF invoices `same_currency`, nothing else. The VAT payment expense is an ordinary CHF expense (base by PR 4). PR 7 adds one CHF-base test to `exports` to prove it, no code change.

**Acceptance Scenarios**:

1. **Given** a CHF-base tenant and a 3-day trip to Germany **When** the per-diem is computed **Then** the expense is the SEK total from `Private SE`, base = SEK total × the departure date's SEK→CHF rate; the per-diem sheet prints SEK.
2. **Given** a CHF-base tenant with a CHF invoice and a EUR invoice in Q3 **Then** the return's figures equal the SEK tenant's for the same invoices.

### Edge Cases

- **The base changes between two requests** (only possible before the first money fact): each request reads its own; nothing stored is affected because nothing is stored.
- **A job** (pg-boss) runs in its own tenant transaction → its own read. No process-wide cache: two tenants in one worker never share a base.
- **Invoices keep their `base_currency` column**: it is the snapshot written at draft time, not the tenant's base read back. A tenant cannot have drafts in another base, because the base locks at the first draft.
- **Columns and comments saying "SEK base"** mean "base": no rename, no migration (D39). Code identifiers named `…Sek` are renamed in the module's PR when touched.
- **A EUR or USD base**: allowed by `CURRENCIES`; `rateToBase` crosses through EUR already. No fixture beyond CHF.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `kernel/tenancy/base-currency.ts` exports `baseCurrency(tx): Promise<Currency>` — reads `tenants.currency` for `current_setting('app.tenant_id')`, parses it against `CURRENCIES`, memoised per transaction object (a `WeakMap`, so a finished transaction frees it).
- **FR-002**: `kernel/tenancy/money-facts.ts` exports `hasMoneyFacts(tx): Promise<boolean>` — one `EXISTS` over the money-fact tables of D39 (`journal_entries`, `invoices`, `expenses`, `supplier_invoices`, `settlements`) under the transaction's RLS. The list is one constant in that file; a new table of money facts is added there in the PR that creates it.
- **FR-003**: `getTenantProfile` returns `currencyLocked: boolean`; the company page reads the profile through `settings/queries.ts` (it reads `tx.tenant` directly today).
- **FR-004**: `updateTenantProfile` refuses a `currency` different from the stored one while `hasMoneyFacts` is true: `BUSINESS_RULE_VIOLATION`, `details: { currency }`, before any write and before the audit row.
- **FR-005**: The company profile form shows the base as text with the locked hint when `currencyLocked`; the select otherwise. The action's enum reads `CURRENCIES`, not its own copy (the form's local copy goes too).
- **FR-006**: `kernel/money/base-currency-context.tsx` exports `BaseCurrencyProvider` and `useBaseCurrency()`; `app/(app)/layout.tsx` reads `baseCurrency` for the active tenant (in the transaction it already opens for the tenant list) and wraps the shell.
- **FR-007**: `formatMoney(amount, currency?, options?)` — the code becomes optional (no code = the bare number, as `null` does today). Every existing call compiles and renders the same; no other formatter changes.
- **FR-008**: A test fixture creates a tenant with a given base: `createTestTenant(pool, { currency: "CHF" })` (`kernel/db/test-fixtures.ts`); the default stays SEK.
- **FR-009**: Module PRs (US3, US4) replace `BASE_CURRENCY` and base `"SEK"` literals in their own folder only; the last removes `BASE_CURRENCY` from `kernel/nav/constants.ts`.

### Shared files — said before writing

- **i18n (PR 1)**: one new key, `settings.company.currencyLocked` (en / fr / sv), for the hint and the refusal's toast. Module PRs that put the base into a sentence change their own keys to take `{currency}` — each says so in its PR; no two at once.
- **Schema**: none. No column, no migration, no trigger. (A DB trigger on `tenants.currency` would back the service up; not asked for — a row if ever wanted.)
- **Nav constants**: only PR 9.

### Key Entities

- **Tenant** — `currency` is the base (existing column, default `SEK`). No new field.
- **Money fact** — a row in one of FR-002's tables. Its existence, not its amount, locks the base.

## Success Criteria *(mandatory)*

- **SC-001**: After PR 9, `grep -rn "BASE_CURRENCY" src` is empty and no non-test file under `src/modules` uses `"SEK"` as a base (the remaining `"SEK"` are country rules: traktamente, the private SE source, the Nordea CSV).
- **SC-002**: Each money module's test suite has a CHF-base case beside its SEK cases (US3 scenarios 1–2).
- **SC-003**: With one expense, the base cannot be changed — by the page or by a hand-made request (US2 scenarios 2–3).
- **SC-004**: The SEK tenant's numbers, screens and PDFs are byte-for-byte what they were (every existing test green without edits other than fixtures).

## Assumptions

- **Tolerances keep their number in the base's unit**: the 0.50 owed tolerance (D25/D26), the 0.01 total tolerance and linking's 6 % cross-currency tolerance mean 0.50 CHF in a CHF company. A proportional rule (0.05 CHF) is not worth a setting (§1.4).
- **"Chosen at creation" = the profile before the first money fact.** The registration form does not ask for a base (one tenant today); a second company sets it in Settings → Company first.
- **No re-basing.** Existing facts are never converted; another base = another tenant (D39).

## Out of scope

- A base picker on the registration page; a DB trigger on `tenants.currency`; renaming `…_base` columns; Swedish moms (the accountant's); any change to how printed sheets format money (`formatCurrency` stays).
