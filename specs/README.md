# specs/ — one folder per module

- `harvest.md` — v1 (`af_core`) behaviour harvested as rules, data, algorithms, tests and fixtures (phase-0 item 5). Read before `/speckit-specify` for that module; its §9 lists the questions the owner answers first.
- `fixtures/` — DATA copied from v1 or derived from the owner's Excel (strings, rate tables, test cases). Never code.
- `spec.md` / `plan.md` / `tasks.md` — spec-kit artefacts of the build (`/speckit-specify → plan → tasks → implement`).

| folder | harvest | decisions |
|---|---|---|
| `invoices/` | H1 model + lifecycle + numbering, H2 component + strings + PDF, H6 Swiss VAT | D5, D7 |
| `banking/` | H3 match scoring, H4 learned categorisation, H11 three-account import + transfer pairs + bank fees | D3, D4, D18 |
| `contracts/` | H5 rate history | §3.4 |
| `documents/` | H7 duplicate detection + inbox UX (what v2 lacks) | §3.9 |
| `expenses/` | H8 groups, owner liability ledger, settlements, reimbursement statement | D8, D9 |
| `traktamente/` | H9 normalbelopp, half-day rule, meal deductions | §3.8 |
| `supplier-invoices/` | H10 payables | D8 |
| `accountant-package/` | H12 monthly zip + summary (no v1 source) | D13 |
| `kernel-ui-datatable/` | H13 Excel-style header filters (built in phase-0 item 8) | D20 |
| `structure-*`, `kernel-*`, `numbering/`, `linking` | phase-0 structural and kernel items | — |
