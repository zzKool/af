# Feature Specification: four-digit BAS with its own levels (D68, F126 last PR)

**Created**: 2026-10-31 · **Status**: decided — the owner accepted D68 ("Yes, four digits", 2026-10-31) and asked for BAS's own grouping in Settings → BAS and in the picker (2026-10-31, pointing at bas.se's chart PDF and its *Framework and use* page). Waits for the two BAS Excel files on the build machine.

## BAS's levels (bas.se, *Framework and use of the accounting plan*)

```
6        class            first digit                        Other external costs
65       account group    two digits                         Other external services
6500     control account  group + 00 — the whole group        (a heading, not booked on by AF)
6530     main account     three digits + 0                   Accountancy services
6531…9   sub-account      fourth digit 1–9                   (where BAS defines one)
```

Classes 5 and 6 are both *other external costs* (the picker keeps them as one class group, F125).

## Requirements

- **FR-1 Chart** — `bas_categories` reloaded from `BAS_kontoplan_2026.xlsx` (Swedish) + `Chart-of-accounts-BAS-2025.xlsx` (English) by `prisma/data/parse-bas.mjs`, extended: every main account and sub-account at **four digits**, `name` (Swedish), `name_en`, `class_num`, `group_code` (two digits), `kind` ∈ `main | sub` (control accounts `…00` are not rows), `parent_code` for a sub-account. A new reference table `bas_groups (code char(2), class_num, name, name_en)` from the same files' group headings. No group or account name is typed in code. The files are licensed: gitignored, never committed (the parser and the generated SQL migration are).
- **FR-2 One migration** — every stored code `NNN` → `NNN0`, in one transaction: bank rows, rules, partners' defaults, expenses, supplier invoices and their lines, subscriptions, journal lines, tenant preferences (short codes, favourites, translations, *Use for* notes), proposals' payloads. A stored code with no four-digit row after the reload fails the migration, naming the code (never a silent drop). Triggers that lock facts are disabled for the update and re-enabled (as in `20261030010000`).
- **FR-3 Keys unchanged** — expense / supplier-invoice business keys carry the alias, not the code: nothing renumbered. Invoice numbering untouched.
- **FR-4 Settings → BAS** — class → group → accounts, each level collapsible; the group line reads `65 · Other external services` (English, Swedish small); a sub-account indented under its main account; activation per account as today; counts per group (*3 of 12 active*).
- **FR-5 Picker** — the class groups stay; inside, the accounts are ordered by group with the group as a small sub-heading (`65 · Other external services`); a search matches the group's names too (`travel` finds group 58's accounts). Suggestions and favourites unchanged.
- **FR-6 The package** — the accountant's sheet shows the four-digit code (what he books) with *Swedish (English)* (D72).
- **FR-7 Tests** — the parser on a small invented XLSX (levels, control accounts skipped, sub-account parents); the migration on seeded three-digit data (`654` → `6540` everywhere, an unknown code refuses); Settings and picker grouping (component); the guard that no group name appears in code.

## Irreversible

The migration rewrites stored codes on the box: it merges on green (CI), **the box deploy waits for the owner's word** (CLAUDE.md). A backup before the deploy is in the runbook.

## Out of scope

Booking (the accountant books); BAS K2/K3 marks beyond what the files carry; class 0 and 9.
