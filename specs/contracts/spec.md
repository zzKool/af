# Feature Specification: Contract rate history

**Feature Branch**: `feat/contracts-rate-history`

**Created**: 2026-10-20

**Status**: Ready for planning (owner's answers in, D24)

**Input**: "Phase 1, first module: contracts with a dated rate history. The daily rate a client is billed changes by year (1 000 CHF in 2025, 1 200 CHF in 2026); an invoice for a period must pick the rate that was valid for that period and keep it forever. Harvest `specs/contracts/harvest.md` (v1 `ClientRate`, three abandoned generations), decisions D11 (day × rate), D24 (rate of `period_start`, close on `valid_from − 1`, no overlaps, `rate_unit` enum with `day`, derive `billing_rate`, one contract per currency)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Record a rate change on a contract (Priority: P1)

The owner opens the client (partner page → Contracts tab), expands the contract, and in its **Rates** section adds a new rate: *valid from* 2026-01-01, *rate* 1 200. The previously open rate (1 000 since 2025-01-01) closes by itself on 2025-12-31. The list shows both rows with their state: 1 200 **Current**, 1 000 **Expired**.

**Why this priority**: it is the whole feature — without a dated history there is nothing for an invoice to pick.

**Independent Test**: create a contract, add two rates in sequence, read the list back: two rows, the first closed on the day before the second starts, states derived from today.

**Acceptance Scenarios**:

1. **Given** a contract with no rate, **When** the owner adds a rate valid from 2025-01-01 with no end, **Then** the list shows one row `2025-01-01 → open · 1 000.00 CHF · Current` and the contract's *current rate* reads 1 000.00.
2. **Given** that open rate, **When** the owner adds a rate valid from 2026-01-01 with no end, **Then** the first row now reads `2025-01-01 → 2025-12-31 · Expired` (today ≥ 2026-01-01) and the second `2026-01-01 → open · Current`; both changes are in the audit trail.
3. **Given** two rates, **When** the owner adds a rate valid from 2027-01-01, **Then** it shows as **Future** and the 2026 rate closes on 2026-12-31.
4. **Given** any rate, **When** the owner tries to add a rate whose interval touches or overlaps an existing one (e.g. 2025-06-01 → 2025-08-31 while 2025 is covered), **Then** the add is refused with *This rate overlaps an existing rate (2025-01-01 → 2025-12-31)* and nothing changes.
5. **Given** a rate, **When** the owner sets *valid to* earlier than *valid from*, or a rate of 0 or less, or leaves *valid from* empty, **Then** the row is refused with the matching message and nothing is saved.

---

### User Story 2 - Look up the rate for a date (Priority: P1)

Another module (invoices, next slice) asks "which rate applies to this contract on 2026-01-01?" and gets back the rate row (id, amount, currency, unit, validity) or *none*. The answer never depends on today's date.

**Why this priority**: the invoice line is `days × rate_for(contract, period_start)`; the lookup is the contract this module offers to the rest of the app.

**Independent Test**: seed the owner's history (1 000 in 2025, 1 200 from 2026) and check the fixture cases in `fixtures/rate-history-cases.json`: inside open, inside closed, both bounds inclusive, before the first rate → none, inside a gap → none.

**Acceptance Scenarios**:

1. **Given** the owner's history, **When** asked for 2026-03-15, **Then** 1 200 (the 2026 row).
2. **Given** the owner's history, **When** asked for 2025-12-31, **Then** 1 000; for 2026-01-01, 1 200 (both bounds inclusive).
3. **Given** the owner's history, **When** asked for 2024-12-31, **Then** none.
4. **Given** rates 2025-01-01 → 2025-06-30 and 2025-09-01 → open, **When** asked for 2025-07-15, **Then** none; for 2025-09-01, the second.
5. **Property**: for any set of non-overlapping intervals and any date, the lookup returns the unique interval containing the date, or none.

---

### User Story 3 - Correct or remove a rate (Priority: P2)

A rate typed wrong is fixed in place (amount, dates, note) as long as the corrected interval still overlaps nothing. A rate no invoice line has used can be deleted; one that has been used cannot (it is closed instead). The current-rate figure on the contract follows the history, it is never typed.

**Why this priority**: mistakes happen at entry; the guard against deleting a used rate protects issued invoices' provenance.

**Independent Test**: create a rate, edit its amount and end date, verify; delete it; verify the contract shows no current rate.

**Acceptance Scenarios**:

1. **Given** a rate 1 200 from 2026-01-01, **When** the owner changes the amount to 1 250, **Then** the row shows 1 250 and the audit trail has the before/after.
2. **Given** a 2025 rate closed on 2025-12-31 and a 2026 rate, **When** the owner moves the 2025 end to 2026-01-15, **Then** the change is refused with the overlap message.
3. **Given** a rate no invoice uses, **When** the owner deletes it, **Then** it is gone and audited. *(A rate referenced by an invoice line is refused with "used on n invoice line(s) — close it instead"; the reference arrives with the invoices module, which also installs the database guard.)*
4. **Given** a contract whose only rate ends 2025-12-31 and today is 2026, **When** the contract row is displayed, **Then** *current rate* is empty, not the last value.

---

### User Story 4 - Existing contracts keep their rate (Priority: P2)

Contracts created before this feature carry one `billing rate` field. After the change each such contract has one open rate row starting on the contract's start date with that amount, and the old field is gone from the form.

**Independent Test**: a contract with `billing_rate = 1200` and `start_date = 2025-01-01` before the migration has, after it, one rate row `2025-01-01 → open · 1200.00`.

---

### Edge Cases

- A new open-ended rate dated **before** an existing open rate (e.g. existing open from 2026-01-01, new open from 2025-06-01): the existing one cannot be auto-closed (it starts later) → refused as an overlap; the owner edits the existing row instead.
- A new **closed** rate never auto-closes anything; it must fit entirely in a gap.
- Two rates may not touch: a rate ending 2025-12-31 and one starting 2025-12-31 overlap (both inclusive).
- The lookup ignores the contract's own start/end dates and active flag: a rate is a fact about a period; the invoice module decides whether an inactive contract may be invoiced.
- Deactivating a contract keeps its rates; deleting a contract is not offered (v2 soft-delete), so rates never dangle.
- A contract currency change after rates exist: the rate rows do not store a currency (the contract's is the one), so the history re-labels with the contract — a one-client company changes currency by creating a second contract (D24), the UI says so next to the currency field once a rate exists.
- Concurrency: two simultaneous adds for the same contract cannot both succeed when they overlap — the database refuses the second regardless of the service.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A contract has zero or more **rates**; each rate has `valid_from` (date, required), `valid_to` (date, optional = open), `rate` (money, > 0, 2 decimals, in the contract's currency), `unit` (today always `day`), an optional note, and the usual creation stamp.
- **FR-002**: Rates of one contract never overlap, both bounds inclusive; `valid_to ≥ valid_from`. Both rules hold in the database as well as in the service (constitution §2 "invariants in DB and service").
- **FR-003**: Adding an open-ended rate closes the contract's open rate (if any, and only if it started earlier) on `valid_from − 1 day`; adding a closed rate closes nothing. Every automatic close is audited as its own change.
- **FR-004**: `rate_for(contract, date)` returns the single rate whose interval contains the date, or none — independent of today.
- **FR-005**: The current rate shown on a contract is `rate_for(contract, today)`; it is derived, never stored. The former `billing_rate` field is removed after its value is carried into the history (FR-010).
- **FR-006**: A rate can be edited (`valid_from`, `valid_to`, `rate`, `note`) subject to FR-002, and deleted while no invoice line references it. Edits and deletes are audited with before/after.
- **FR-007**: The list of a contract's rates is ordered newest first and labels each row **Current** (contains today), **Expired** (ended before today) or **Future** (starts after today) — derived at read time.
- **FR-008**: The rates section lives inside the contract's expanded row on the partner page (child of a child: no route of its own), with an inline add row (`valid from` defaulting to today, `rate`, `note`) and the tip "Leave *valid to* empty for an ongoing rate."
- **FR-009**: Strings exist in English and French from day one (`contracts.rates.*`, harvest §5.4), through the kernel dictionary; a Swedish dictionary later is a data file, not a code change.
- **FR-010**: Migration: for every contract with a non-null `billing_rate`, one open rate row from the contract's `start_date` with that amount; then the column is dropped. No contract loses its rate.
- **FR-011**: Only the owner (tenant admin) can add, edit or delete rates; the accountant role reads. Through `can()` like every other write.
- **FR-012**: The module exposes to other modules: `rateFor(tx, contractId, date)`, `listContractRates(tx, contractId)`, `getContract` (now with `currentRate`), and the DTOs — never database types.

### Key Entities

- **Contract** (exists, v2): client partner, name, start/end, currency, payment terms, VAT registration, external references, assigned employee, active flag. Loses `billing_rate`; gains derived `currentRate`.
- **Contract rate**: one dated amount for one contract — `valid_from`, `valid_to?`, `rate`, `unit = day`, `note?`. Many per contract, never overlapping. The invoice line (next slice) will keep a snapshot of the amount plus the rate's id as provenance.
- **Rate unit**: enumeration with the single value `day`; a new unit is a one-line schema change plus labels, no code path assumes `day`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The owner records a yearly rate change in under 30 seconds from the partner page, with the previous rate closed for them (no second edit).
- **SC-002**: Every fixture lookup case in `fixtures/rate-history-cases.json` passes, plus a 200-run property test on random non-overlapping histories.
- **SC-003**: No overlapping pair of rates can exist for one contract, even when two writers race — verified by a direct-SQL insert being refused.
- **SC-004**: After the migration, 100 % of contracts that had a billing rate have exactly one open rate row with that amount; the contract form no longer offers a typed rate.
- **SC-005**: Switching the UI to French shows the rates section fully translated; adding a dictionary for Swedish needs no code change.

## Assumptions

- One currency per contract (D24, owner: "usually a client has only one currency"); the rate carries none.
- Day is the only unit today (D24); the enum exists so quantity/hour can be added by migration.
- Rates are facts about periods, so they are kept on inactive contracts and are not hidden by any flag (v1's `isActive` dropped).
- The invoice-line snapshot and the "used by n lines" delete guard belong to the invoices slice; this slice leaves the hook (`deleteContractRate` refuses when a `rateUsage` check says so — wired to a constant `0` until invoices exist).
- No project or consultant scoping (D11: no projects; `assigned_employee_id` stays on the contract, unrelated to the rate).
- The partner page keeps its single-transaction data load; rates for all of the partner's contracts come in that same load.
