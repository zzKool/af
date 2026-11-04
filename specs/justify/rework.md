# Feature Specification: The rework's rules — a justified row names a partner (F129, D73 · D74)

**Feature Branch**: `feat/linking-justified-partner` — one PR: the migration (the four partners seeded, the backfill, one column on `partners`), the derived partner and category on read, the new *justified*, the reasons' partner, D74 as a rule. It touches `prisma/schema`, so it is **serialised**: no other schema, nav or `package.json` PR open beside it.

**Created**: 2026-11-04

**Status**: Draft for the owner's read — four questions in one batch at the end (§*Questions for the owner*). The decisions themselves are taken (D73 the owner 2026-11-03, D74 proposed 2026-11-04, [[review-2026-10-31]] §5 after its second read); this page makes them buildable. Built on his "go"; the box deploy, as always, on his word (the migration writes `partner_id` on his rows).

**Input**: [[review-2026-10-31]] §2 rows 2.11–2.12, §5, §8 F129, §11 · [[feature-inventory]] D73 · D74 · D58 (D33 reversed) · `specs/banking/one-table.md` US4 / FR-006 / SC-004 (F113 PR C — the approved rule this spec **builds**, it does not re-decide it) · `specs/justify/spec.md` US3 (F97's *no proof needed* and its rule proposal) · `specs/linking/one-engine.md` (the memory, the rules' shape, F116).

## Why — what the owner saw

```
today      row ──justifies──► supplier invoice (partner Skattepunkten, 6540)      the row: partner —, category —, state LINKED
           row  flag no_document_needed, 657 (the fee rule)                        the row: partner —, state NO DOCUMENT
           Months panel · Work · badge · package: both count as justified          "a row linked with no partner does not make sense" (2.11)
           the no-proof reasons set a BAS, never a partner                         "it always needs a partner" (2.12)
           D58 (2026-10-26) already says: derive the partner from the proof — its build (F113 PR C) waited for B1

after      effectivePartner / effectiveCategory on read: the proof's when the row has none typed, a typed value wins, never written
           justified = (linked ∨ no proof) ∧ a partner — six states, one function; the four counts follow
           the no-proof reasons name a partner by type: the bank · Skatteverket / the FTA · the owner as employee · the client
           four partners seeded once per tenant, ordinary and editable, found again by a role the form never shows
           the rows on the box: backfilled from their rule and their account; what cannot be placed re-opens as to justify
           a confirmed vendor ↔ counterparty becomes a rule (D74) — applied at the next import, visible on /banking/rules
```

## The target

```
                         ┌───────────────── one read per page: rowFacts(tx, rows) ─────────────────┐
 bank_transactions ──────┤ typed: partner_id · bas_code · no_document_needed · account role         │
 links (linking index) ──┤ Σ allocated FROM the row · the transfer legs           (linkFactsOf, F114) │
 the proofs' facts ──────┤ per allocating link: the entity's partner + BAS (factsMany, each owner)    │
                         └──────────────────────────────┬────────────────────────────────────────────┘
                                                        ▼
                               effectiveFactsOf(row, proofs)            pure, banking/effective.ts
                               partner = typed ?? proof's (the larger allocation; several ≠ → mixed) ?? null
                               category = typed ?? proof's (same rule) ?? null         settles → the owner as employee
                                                        │
                                                        ▼
                               deriveTransactionState({ amount, allocated, inTransfer, flag, partner, accountRole })
                                                        │
          ┌──────────────┬──────────────┬───────────────┼──────────────────┬──────────────────────┐
          ▼              ▼              ▼               ▼                  ▼                      ▼
        open          partial        linked      linked_no_partner    no_document       no_document_no_partner
      attention       progress        done          attention           neutral               attention
          └─────── to justify ─────────┘   └── to justify ──┘  justified  └──── to justify ────┘
                                                        │
       readers: the list · the panel · the Months panel · rowsToJustifyCount (badge, dashboard) · the inbox
                transactionStates → the package's bank sheet (Partner, BAS, Status) and its flags
```

The two new states are *linked · no partner* and *no proof · no partner*: the owner sees them as *to justify*, the label says why. A transfer leg and a savings-account row keep their rule (the other statement is the proof, D13 / F65): no partner asked — Q3 confirms it.

### The rule, in six lines

1. **A justified row names a partner** (D73). `justified(state) = linked | no_document`; the four other states are *to justify*. Linked or flagged without a partner — typed or derived — is not justified. Transfer legs and savings rows excepted (D13 / F65).
2. **From a proof the partner and the category are derived on read** (D73 (a) = `specs/banking/one-table.md` US4 / FR-006, D58): `effectivePartner` / `effectiveCategory` in banking — the proof's partner and BAS when the row has none typed; a typed value (by hand or by a rule) wins; **never written** on the row, no audit row. One rule covers every link path (the Justify click, *Suggestions*, *Apply HIGH*, *Link to…*, the inbox's `Enter`, the payment picker) and every link made before.
3. **Several proofs**: the larger allocation (by `allocated_base`) gives the value; when the proofs disagree the facts carry `mixed` (the list's tag, the sheet's *Flags* cell); the *Links* sheet already prints every allocation. A `settles` link's partner is the owner as employee (the refund pays him, not the restaurant); its category follows the settled expenses like a `justifies`.
4. **For *no proof needed* the partner is typed** (D73 (b)) — there is no proof to derive from. `noProofNeeded` takes `partnerId`; each reason proposes one **by type**, from a fact, marked as a proposal: *bank fee* / *interest* → the bank; *tax* → the FTA when the row's account is in CHF, else Skatteverket; *salary / owner* → the owner as employee; *client paid* → the client picker (the counterparty memory's partner when it has one, marked *remembered*); *other* → any partner (the memory's, else empty). The learned rule carries it — `createRuleFromTransaction` already copies the row's partner.
5. **Four partners, once per tenant**, ordinary and editable: the bank, Skatteverket, the Swiss FTA, the owner as employee. Found again by `partners.system_role` (`bank` · `tax_agency_se` · `tax_agency_ch` · `owner`, one per tenant — a partial unique index), a column no form shows; the name, short code, address, identifiers and the active flag stay the owner's. `authority` joins the partner types (`client | vendor | employee | authority` — a string array, the Zod enum and the tags change, no migration for it).
6. **A confirmed vendor ↔ counterparty becomes a rule** (D74): after a proof is linked, when no active rule names the proof's partner for the row's counterparty key, the result proposes one (`text = the key, partner = the vendor, category = the one the owner picked`) — F97 US3's toast and `createRuleFromTransaction`, one click. The vendor check (F130's `checkProof`) and F131's dialog read `banking.rulesForKey(tx, key)`. No column, no third memory.

### Worked examples (invented)

| | the row | typed | proofs | effective | state |
|---|---|---|---|---|---|
| 1 | 2026-07-08 −1 297.20 SEK `SKATTEPUNKTEN OFFICE`, linked through *Suggestions* | — / — | `justifies` SI (Skattepunkten Office Services AB, 6540) | Skattepunkten · 6540, *from the proof* | **linked** |
| 2 | the same row, the owner types 6530 | — / 6530 | the same | Skattepunkten · **6530** | linked |
| 3 | 2026-07-02 −139.00 SEK `AVGIFTER NORDEA`, the fee rule (657, partner Nordea since this PR) | Nordea / 657 | — | Nordea · 657 | **no_document** |
| 4 | the same row on the box today (the rule has no partner) | — / 657 | — | — · 657 | **no_document_no_partner** → the backfill gives it Nordea |
| 5 | 2026-07-25 −31 400.00 SEK `SKATTEVERKET`, `n` → *tax* | Skatteverket (proposed, the SEK account) / 251 | — | Skatteverket · 251 | no_document |
| 6 | 2026-07-25 −2 800.00 CHF `ESTV MWST`, `n` → *tax* | the FTA (proposed, the CHF account) / 251 | — | FTA · 251 | no_document |
| 7 | 2026-07-30 +1 400.00 SEK refund to the owner, `settles` two private expenses (580, 583) | — / — | two `settles` (999.70 · 400.00) | the owner · 580, **mixed** | linked |
| 8 | 2026-07-12 −200.00 SEK, two receipts 120 (6540, OpenAI) + 80 (5410, no partner) | — / — | two `justifies` | OpenAI · 6540 (the larger base), mixed | linked |
| 9 | 2026-07-15 −450.00 SEK, `justifies` a plain document (no entity, no partner) | — / — | one `justifies`, partner null | — · — | **linked_no_partner** → the owner picks the partner in *Category* |
| 10 | 2026-07-09 −20 000.00 CHF ↔ +237 740.00 SEK, a transfer pair | — / — | `transfer` | — · — | no_document (no partner needed, D13 / F65) |
| 11 | 2026-12-31 +12.40 SEK `RÄNTA` on the savings account, the interest rule | Nordea / 831 | — | Nordea · 831 | no_document |

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The proof's partner shows on the row, whatever the link path (Priority: P1)

D73 (a): `specs/banking/one-table.md` US4 built. A row with no typed partner or BAS that `justifies` (or `settles`) something shows that entity's partner and BAS — on the banking list and its filters, the panel's *Category* section (with the source word *from the proof*), the inbox's right pane, the partner page's *Transactions* tab, the package's bank sheet, `transactionStates` for any other module. Derived on read; a typed value wins; nothing is written. Links made before this PR are covered the same day.

**Why this priority**: the row the owner saw (2.11) — linked, no partner. Everything else in this spec counts on the derived value.

**Independent Test**: `effectiveFactsOf` on fixtures (pure); the list, the panel read and `transactionStates` on seeded rows linked three ways (DB); the package golden (SC-004).

**Acceptance Scenarios**:

1. **Given** example 1 **When** the list loads **Then** the row's *Partner* reads *Skattepunkten Office Services AB*, *Category* *6540*, both with `from = proof`; the panel's *Category* section shows them with *from the proof*; the audit trail of the row holds no categorisation; `SELECT partner_id, bas_code` on the row are still `NULL`.
2. **Given** example 2 **Then** 6530 wins in the list, the panel, the sheet; the partner stays derived.
3. **Given** example 8 **Then** the list shows *OpenAI · 6540* with the tag *mixed*; the bank sheet prints `6540`, *OpenAI*, and `mixed` in its *Flags* cell; the *Links* sheet prints both allocations.
4. **Given** example 7 **Then** the partner is the owner as employee (the seeded `owner` partner), the category *580 · mixed*.
5. **Given** example 9 **Then** nothing is derived (a document's facts carry no partner id); the row is *linked · no partner*.
6. **Given** the Partner header filter set to Skattepunkten **Then** example 1's row is in the result (the filter runs on the effective value, in memory like *State*); the distinct values of the header count it once.
7. **Given** the accountant **Then** the same values, read-only.

---

### User Story 2 - Justified means a partner too (Priority: P1)

The derived state grows from four to six values, computed in **one** function, `deriveTransactionState`, read through one shared read, `rowFacts(tx, rows)` — the list, the panel, the Months panel, `rowsToJustifyCount` (the sidebar's *Work* / *Banking* badge and the dashboard's *rows to justify*) and `transactionStates` (the package). `linked_no_partner` and `no_document_no_partner` are *to justify*: `needsProof` counts them, the Months bars stack them under *to justify*, the inbox lists them, the banner counts them, the package flags them.

**Acceptance Scenarios**:

1. **Given** examples 1, 3, 10, 11 **Then** each is *justified*: the Months bar counts them as justified, the badge does not count them, the sheet prints their status.
2. **Given** examples 4 and 9 **Then** the label reads *No proof · no partner* / *Linked · no partner* (family *attention*), the Months bar counts them under *to justify*, the badge counts them, the inbox lists them (the right pane shows the *Category* form to pick the partner — on a linked row the Justify section stays hidden: the proof exists), the package flags them `no_partner` (*Bank lines without a partner*), and the banner reads *Rows to justify: N — package 2026-07 not built*.
3. **Given** a savings-account row flagged by the interest rule with no partner (before the backfill) **Then** it is *no_document* all the same (Q3: the savings statement is the proof) — and the backfill still gives it the bank.
4. **Given** `state-family.pure.test.ts` **Then** every state has a family and the *attention* / *progress* ones are exactly `needsProof`'s set (the test exists; the set grows).
5. **Given** the property test of `state.pure.test.ts` **Then** the state equals the rule of §*The target* written out by hand, for every combination of flag, transfer, allocation, partner and account role.

---

### User Story 3 - No proof needed names a partner (Priority: P1)

`n` (or the button) → the reason → **the partner line**: a select pre-filled with the reason's proposal (marked *proposed — the bank* / *proposed — the owner* / *remembered*), or empty when the reason has no type (*client paid*, *other*) and the memory knows nothing → *Done*. `noProofNeeded` refuses without a partner (`VALIDATION_ERROR`, *A partner is required — the statement is the proof, the partner says of what*). The flag, the reason's BAS and the partner are written by hand on the row (`banking.categorise`, `categorised_by = manual`); the toast proposes the rule when no active rule hits the counterparty — the rule carries the partner. The reasons are offered on **incoming** rows too (a tax repayment, a client's refund of an overpayment, interest): *client paid* first there. The look is the F97 panel's until F131 replaces it; the contract (`noProofSchema`, the proposals by type) is what F131's *facts* zone calls.

**Acceptance Scenarios**:

1. **Given** example 5 **When** `n` → *tax* **Then** the partner line shows *Skatteverket — proposed (the tax agency)*; *Done* writes `no_document_needed`, 251, the partner; the state is *no_document*; the toast *Always like this for SKATTEVERKET?* creates a learned rule with 251 **and** the partner.
2. **Given** example 6 (a CHF account) **Then** the proposal is the FTA; the owner may switch it to Skatteverket.
3. **Given** `n` → *bank fee* on a fresh tenant whose bank partner was deactivated **Then** the line starts empty with *The bank partner is inactive — pick one or reactivate it on /partners*; *Done* stays disabled until a partner is picked.
4. **Given** `n` → *other* on `ÖVERFÖRING LÅN` whose key the memory links to *Byteform AG* three times **Then** the line proposes Byteform — *remembered (3 times)*; else it starts empty.
5. **Given** `noProofNeededAction` called without `partnerId` **Then** refused, nothing written (`justify.test.ts`).
6. **Given** a row already *linked* (example 1) **Then** `noProofNeeded` is refused (*This row is linked — remove the link first*); a *no_document_no_partner* row accepts `n` again (the partner is what it lacks).
7. **Given** the accountant **Then** no reasons.

---

### User Story 4 - Four partners, once per tenant (Priority: P1)

The bank (named after the `bank_name` of the format the tenant's statement accounts use — *Nordea* for the one format the app ships; type `vendor`), *Skatteverket* (`authority`, SEK), *Swiss Federal Tax Administration (FTA)* (`authority`, CHF), the owner as employee (name = the owner member's user name, `employee`). Each carries its `system_role`; everything else is the owner's to edit. Created by the migration for the tenants that exist, by `partners.ensureSystemPartners(tx, caller, audit, { bankName })` for the next ones — called by `banking.importCsv` before `ensureDefaultRules` (the house pattern: the defaults are made on the tenant's first import; the two default rules now carry the bank partner) and by `prisma/seed.ts`. `src/kernel/auth/auth.ts`'s `afterCreateOrganization` hook stays untouched: the kernel never imports a module, and a tenant without a bank row needs none of the four. Idempotent: a second run finds each by its role and does nothing; a partner the owner already named *Skatteverket* by hand gets the role instead of a twin (D70 would refuse the twin anyway).

**Acceptance Scenarios**:

1. **Given** a tenant without the four **When** its first CSV is imported **Then** the four exist with their roles, audited `create`; the fee rule created by `ensureDefaultRules` names the bank; a second import creates nothing.
2. **Given** a tenant with a hand-made partner *skatteverket* (any case) **When** `ensureSystemPartners` runs **Then** that partner gets `system_role = tax_agency_se`; no second one.
3. **Given** the partner page of the bank **Then** a grey tag *the bank* beside its types; the name field edits as any; no field edits the role; a second partner cannot take the role (`partners_tenant_system_role_key`, the service refuses before the index).
4. **Given** the partner form **Then** *Authority* is a fourth type checkbox; the list's *Types* filter and the tags know it; `matchPartners` accepts `type: "authority"`.
5. **Given** another tenant **Then** its own four, never shared (RLS; `partners.test.ts`).

---

### User Story 5 - The books that exist move once (Priority: P1 — the owner reads this part)

One migration, one transaction, in this order:

1. `partners.system_role` (text, nullable, `CHECK IN ('bank','tax_agency_se','tax_agency_ch','owner')`), the partial unique index `(tenant_id, system_role) WHERE system_role IS NOT NULL`.
2. Per tenant: a hand-made partner whose folded name equals *skatteverket* / *nordea* (the bank name of the tenant's formats) gets the role; then the missing ones are inserted — names as US4, `created_by` = the owner member (the oldest `member` with role `owner`), `source = 'migration'`, an audit `create` row each.
3. **The backfill of `partner_id`** on `bank_transactions` with `no_document_needed = true AND partner_id IS NULL`: (a) from `rule_id`'s rule when that rule has a partner; else (b) by `bas_code` — `657` / `6570` / `831` / `8310` → the bank, `251` / `2510` → the FTA when the row's account is in CHF, else Skatteverket, `721` / `7210` → the owner (both digit forms: D68's migration may run before or after); `categorised_by` and `rule_id` untouched. Every backfilled row gets an audit `update` row (`entity_type = bank_transaction`, `old_data {partnerId: null}`, `new_data {partnerId, migration: 'justified_partner'}`, `source = 'migration'`) — the row's History reads *Partner changed · migration*, and the list of touched rows is `SELECT entity_id FROM audit_logs WHERE source = 'migration' AND new_data->>'migration' = 'justified_partner'` — the trail is the reversal path (`UPDATE … SET partner_id = NULL WHERE id IN (…)`, written in [[deployment]], run by hand only).
4. **The no-proof rules without a partner** get the same map on their own `bas_code` (the two defaults included: *Nordea bank fees* → the bank, *Savings interest* → the bank); a no-proof rule whose code is outside the map keeps `NULL` and shows under *Needs a look* (US6).
5. Every count in the log (`RAISE NOTICE`): partners created / roles attached per tenant; rows backfilled by rule, by account, re-opened (flagged, still without a partner — they come back as *no proof · no partner*); rules given a partner, rules left for *Needs a look*.

The lock trigger is not in the way: `partner_id` is an owner's fact (`bank_transactions_lock_facts` passes it). The migration runs as the compose's superuser (`FORCE ROW LEVEL SECURITY`, lessons *F113 build*).

**What this means on the box**: every fee / interest / tax / salary row the rules or the owner flagged is placed; the backfill touches rule-justified rows too (Q2 — they are the bulk); the handful flagged *other* without a partner come back once in the Months panel and take one `n` each.

**The seed has no bank rows** (`prisma/seed.ts` seeds accounts, rules and preferences only), so the migration test runs on its own fixture, invented, nine rows over two tenants — the numbers the test asserts:

| row | tenant | account | flag | bas | rule | partner before | after |
|---|---|---|---|---|---|---|---|
| R1 `AVGIFTER NORDEA` −139.00 | A | SEK main | yes | 657 | *Nordea bank fees* (no partner) | — | the bank (by account; the rule itself → the bank) |
| R2 `RÄNTA` +12.40 | A | savings | yes | 8310 | *Savings interest* (no partner) | — | the bank |
| R3 `SKATTEVERKET` −31 400.00 | A | SEK main | yes | 251 | — (`manual`) | — | Skatteverket |
| R4 `ESTV MWST` −2 800.00 | A | CHF main | yes | 2510 | — | — | the FTA |
| R5 `LÖN` −45 000.00 | A | SEK main | yes | 7210 | — | — | the owner |
| R6 `BYTEFORM AG` +250.00 | A | SEK main | yes | 6540 | *Byteform refunds* (partner Byteform AG) | — | Byteform AG (by rule) |
| R7 `MISC` −99.00 | A | SEK main | yes | 6540 | — | — | **stays NULL — re-opens** |
| R8 `AVGIFTER NORDEA` −139.00 | A | SEK main | yes | 657 | the same rule | *Acme* (typed) | untouched |
| R9 `AVGIFTER NORDEA` −95.00 | B | SEK main | yes | 657 | B's fee rule | — | **B's** bank |

Fixture partners before: tenant A has a hand-made *Skatteverket* (no role), *Acme* and *Byteform AG*; tenant B has none. Asserted: 7 rows backfilled (1 by rule, 6 by account), 1 re-opened, 1 untouched; 4 partners per tenant (B's created, A's *Skatteverket* attached to a pre-existing hand-made partner); 3 rules given the bank, 1 rule (*Byteform refunds*) already had its partner, 0 left for *Needs a look*; 7 audit rows with `migration = 'justified_partner'`; `categorised_by` unchanged on every row; a second run of the migration's SQL changes nothing (counts 0); `deriveTransactionState` on R7 after = `no_document_no_partner`.

---

### User Story 6 - A confirmed vendor becomes a rule, and a rule without a partner is seen (Priority: P2)

D74's pure part. After `justifyRow` (the F97 card today, F131's *Confirm & link* tomorrow) the result carries `proposeRule: { name, matchPattern, matchField, partnerId, basCode } | null` — a draft from `proposeVendorRule(key, partnerId, basCode)` when `banking.rulesForKey(tx, key)` holds no active rule naming that partner; the panel's toast *Remember SKATTEPUNKTEN OFFICE → Skattepunkten Office Services AB?* → `createRuleFromTransactionAction` with the draft (source `learned`, the row's account and direction as *Create rule from this* pre-fills them). The next import carries the partner before any proof (a rule hit writes `partner_id` when the row has none — unchanged). F130's `checkProof` takes `rules` from the same read: the vendor ↔ counterparty check is green when one of them names the partner. **Needs a look** on `/banking/rules` gains a third kind of entry: an active rule with `no_document_needed` and no partner — *sets no proof without a partner: its rows stay to justify* with *Edit rule*.

**Acceptance Scenarios**:

1. **Given** example 1 justified from the card, no rule for `SKATTEPUNKTEN OFFICE` **Then** the result's `proposeRule` names the key and the partner with 6540; accepting creates the rule; the next justify of the same key proposes nothing.
2. **Given** a rule `contains SKATTEPUNKTEN` with that partner already **Then** `proposeRule` is null.
3. **Given** `rulesForKey(tx, "MSFT")` with rules *MSFT → Microsoft AB* (active) and *MSFT → old* (inactive) **Then** the active one, ordered as `orderRules`; text match only — the account, sign and amount conditions are the import's business, not the key's.
4. **Given** a rule *Insurance* (`no proof`, 6310, no partner) **Then** *Needs a look* lists it once with the count of rows it categorised; editing it with a partner removes the entry.

---

### Edge Cases

- A typed partner that differs from the proof's: typed wins, nothing warns here — F130's checks say *the document says X, the row says Y* in the dialog.
- A row linked to a client invoice (incoming): partner = the client (the invoice's facts), category none unless typed — `linked` all the same.
- A `justifies` onto a document with an OCR vendor but no partner id (example 9): no derivation from text; `linked_no_partner` until the owner picks (or F131 makes the entity).
- The owner deactivates a system partner: the proposal reads the inactive one as *none* (US3-3); the rows that name it keep it (a deactivated partner is still a partner, RESTRICT holds); *Reactivate* restores the proposal. No second partner can take the role while the first holds it — reassigning is out of scope.
- Two banks later (a second format): the bank partner stays one; the second bank is an ordinary vendor the owner picks — the reason's proposal is *the bank* in the singular until a second format exists (then: the format of the row's account; not built now).
- `proposalRowIds` (F98): a row whose effective partner or category is derived lacks nothing — excluded from the model's runs for that kind.
- `outgoingRowsInWindow` (the subscriptions matcher) keeps its own filter (nothing left to allocate, or flagged): a *linked · no partner* row pays something already and is no candidate.
- The Ctrl K search is unchanged (bank text only); the list's search box matches the effective partner name.
- Four-digit BAS (D68): the map carries both forms; after D68's rewrite the three-digit entries are dead code to delete then, never a mismatch.

## Requirements *(mandatory)*

- **FR-001 Schema and migration** (`prisma/schema/partners.prisma`, `prisma/migrations/<timestamp>_justified_partner/migration.sql` — its timestamp the day it is written, after `20261031140000`): `partners.system_role VARCHAR(20) NULL` + `CHECK` + `partners_tenant_system_role_key` (partial unique); the seeding, the role attachment, the backfill of rows and rules, the audit rows, the counts — US5 in that order, one transaction. `prisma generate` with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true`; the schema hand-formatted (lessons *F114 build*).
- **FR-002 Partners**: `PartnerType` + `authority` and `SystemRole` (`types.ts`); the Zod enums (`partners.ts` `partnerTypeSchema`, `partners.actions.ts`'s search `type`, `match.ts` `MatchQuery.type`); `PartnerDto` / `PartnerSummaryDto` carry `systemRole` (read-only: not in `createPartnerSchema` / `updatePartnerSchema`); `systemPartner(tx, role) → PartnerDto | null` (active only), `systemPartners(tx) → Record<SystemRole, PartnerDto | null>`, `ensureSystemPartners(tx, caller, audit, { bankName }) → ServiceResult<{ created: SystemRole[]; attached: SystemRole[] }>` (the owner's name through `kernel/auth` `tenantMembers` + `userName`; a folded-name match attaches the role — `foldPartnerName`; audited); `PARTNER_TYPES` + the role tag in `components/partner-labels.tsx`, the form's checkbox (`partner-form.tsx`); i18n `partners.type.authority`, `partners.role.bank | tax_agency_se | tax_agency_ch | owner` in `src/kernel/i18n/dictionaries/en.ts` (D62). The comparison of roles goes through `SYSTEM_ROLES` lookups, never `role ===` (the guard, lessons *F114 build*).
- **FR-003 Banking, the defaults**: `importCsv` calls `partners.ensureSystemPartners` (the account's `bankFormat.bankName`) before `ensureDefaultRules`; `ensureDefaultRules` resolves the bank partner for its two rules (`DEFAULT_RULES` name the role, not an id); `prisma/seed.ts` calls `ensureSystemPartners` after the accounts.
- **FR-004 The proofs' facts**: `EntityFacts.basCode?: string | null` (`linking/types.ts`), filled by `expenses/linkable.ts` and `supplier-invoices/linkable.ts` (`toFacts`; invoices and documents leave it null). `banking/effective.ts` (pure, no module imports): `ProofFact = { kind: "justifies" | "settles"; allocatedBase: string | null; partnerId: string | null; basCode: string | null }`, `effectiveFactsOf(row: { partnerId; basCode }, proofs: ProofFact[], ownerPartnerId: string | null) → EffectiveFacts = { partnerId; partnerFrom: "row" | "proof" | null; basCode; basFrom; mixed: boolean }` — typed wins; else the proof with the largest `allocatedBase` (ties: the first by link creation); `mixed` when two proofs' values differ; a `settles` proof's partner is `ownerPartnerId`.
- **FR-005 Banking, the shared read**: `rowFacts(tx, rows) → { allocated, transfer, effective: Map<id, EffectiveFacts> }` in `queries.ts` — `linksTouching` once, `linkFactsOf`, then one `factsMany` per target type of the allocating links through `linking.getLinkable(type)` (banking reads no other module's table), `partners.systemPartner(tx, "owner")` once; used by `loadRows`, `getTransaction`, `transactionStates`, `bankMonths` (`months.ts`) and `rowsToJustifyCount` (`open-work.ts`). `TRANSACTION_COLUMNS`: `partnerId`, `partnerName`, `basCode`, `basLabel` become effective values and join `DERIVED` (filters, distinct values and sort in memory, as `state`); new hidden columns `partnerFrom`, `basFrom` (enum: row | proof) and `mixed` (boolean). `TransactionListRow`, `TransactionDetail` and `TransactionStateFacts` carry the effective facts and their source; `TransactionDetailWire` follows. `proposalRowIds` reads the effective facts.
- **FR-006 The state**: `TransactionState = open | partial | linked | linked_no_partner | no_document | no_document_no_partner` (`types.ts`, `TRANSACTION_STATES`); `deriveTransactionState({ amount, allocated, inTransfer, noDocumentNeeded, partnerId, accountRole })` as §*The target* — one function, the only place; `needsProof` (`months.ts`) = the four; `state-family.ts`: the two new → `attention`; `open-work.ts` narrows its query to `noDocumentNeeded = false OR partnerId IS NULL` (a flagged row with a typed partner is justified for sure) and derives the rest; `justify.ts`'s `openRow` refuses `justifyRow` on `linked | linked_no_partner | no_document` and `noProofNeeded` on `linked | linked_no_partner`; `inboxRows` (linking) lists `needsProof` rows; the panel shows the *Category* form on every state and the Justify section on `open | partial | no_document_no_partner`. i18n: `banking.state.linked_no_partner` = *Linked · no partner*, `banking.state.no_document_no_partner` = *No proof · no partner*, `banking.banner.unproven` = *Rows to justify: {count} — package {month} not built.*, `banking.col.partnerFrom` / `basFrom` / `mixed`, `banking.facts.fromProof` = *from the proof*.
- **FR-007 No proof needed**: `NO_PROOF_REASONS` + `client` (`justify-rules.ts`), `NO_PROOF_BAS.client = null`; `proposedPartnerRole(reason, accountCurrency) → SystemRole | "client" | null` (fee / interest → bank; tax → `tax_agency_ch` when CHF else `tax_agency_se`; salary → owner; client → "client"; other → null), pure; `noProofSchema.partnerId: uuid` **required**; `noProofNeeded` writes `{ noDocumentNeeded: true, basCode, partnerId }` by hand and keeps its `proposeRule` boolean; `justifyOptions.partners` carry `types` and `systemRole`; the panel (`components/justify-panel.tsx`): the partner line after a reason — the proposal from the role (marked *proposed — {role}*), else the memory's partner (`memoryForRow`, marked *remembered ({n})*), else empty; *Done* disabled without a partner; the reasons offered on incoming rows (*client paid* first, `p` stays disabled there). i18n `linking.justify.reason.client`, `linking.justify.partnerLine.*`.
- **FR-008 D74**: `banking.rulesForKey(tx, key) → CategorisationRuleDto[]` (`rules.ts`: the active rules whose text matches a `RuleText` of the key alone, `orderRules` order; exported through `index.ts`); `proposeVendorRule(key, partnerId, basCode | null) → RuleDraft` (`justify-rules.ts`, pure: `name = key`, `matchType = contains`, `matchField = counterparty_key`, `matchPattern = key`, `partnerId`, `basCode`); `justifyRow`'s result gains `proposeRule: RuleDraft | null` (null when `rulesForKey` holds a rule with that partner, or the entity has none); the panel's toast → `createRuleFromTransactionAction({ transactionId, ...draft })`; the F97 card's toast text `linking.justify.proposeVendorRule`.
- **FR-009 Needs a look**: `RuleNearMiss.transactionId: string | null`, `reason: … | "no_partner"`, `rows: number | null` (`types.ts`); `ruleNearMisses` appends one entry per active rule with `noDocumentNeeded && !partnerId` (the count of rows with that `rule_id`), sorted after the row entries; `rule-near-misses.tsx` renders it with *Edit rule* (the `RuleDialog`); i18n `banking.rules.nearMiss.no_partner`.
- **FR-010 Package**: the bank sheet gains *Partner* after *BAS label* (`summary.ts` `BANK_HEADER`, `collect.ts`: `partnerName` from `transactionStates` — the effective one; the BAS cells effective too); `BankSheetRow.status` takes the six states; `bankRowFacts` flags `no_partner` for `linked_no_partner` / `no_document_no_partner` main rows (`FlagKind` + `FLAG_TITLES` *Bank lines without a partner*, `FLAG_ORDER` after `unlinked_row`, i18n `package.flag.no_partner`); `mixed` in the row's *Flags* cell; the golden re-captured once (`PACKAGE_GOLDEN_OUT`, a second reader opens the workbook — lessons *The fix-now round*), reviewed in the PR.
- **FR-011 Tests** (`test-conventions`): `effective.pure.test.ts` (typed wins; one proof; two proofs → the larger base + mixed; `settles` → the owner; a document proof → null; property: the result's partner is typed or one of the proofs' or null); `state.pure.test.ts` rewritten on the six states with the property of US2-5; `state-family.pure.test.ts`; `reads.test.ts` / `queries` (DB: the three link paths derive, a typed value wins, the partner filter on a derived value, `transactionStates` carries the facts, RLS); `months.test.ts` and `open-work.test.ts` (a flagged row without a partner counts as to justify, with a partner not, a transfer leg not, the savings interest not); `rules.test.ts` (`rulesForKey`, `ensureDefaultRules` with the bank, the `no_partner` near miss, `createRuleFromTransaction` carries the partner); `partners.test.ts` (`authority`, `systemPartner`, `ensureSystemPartners` idempotent and attaching, the role not writable through `updatePartner`, RLS); `justify.pure.test.ts` (`proposedPartnerRole`, `proposeVendorRule`); `justify.test.ts` (DB: `noProofNeeded` with and without a partner, on a linked row refused; `justifyRow`'s `proposeRule` with and without an existing rule); `justify-panel.test.tsx` (the partner line's proposal and the disabled *Done*); `banking/justified-partner-migration.test.ts` on the fixture of US5 (the F113 / F114 harness: every migration before, the fixture, the migration, the asserts, the second run); `package.test.ts` SC-004; `kernel/guards` green; e2e `justify.spec.ts` (`n` → *bank fee* → *Nordea — proposed (the bank)* → *Done*; the row linked from the card shows the supplier's name on the list), `banking.spec.ts` (the fee rule's row *No document needed* with *Nordea*; *Needs a look* shows a no-proof rule without a partner created in the journey), `linking.spec.ts` (the invoice payment linked from *Suggestions* shows the client on the list). Screenshots `specs/justify/screenshots/no-proof-partner.png`, `needs-a-look-no-partner.png`, `row-derived-partner.png`, light + dark where the kit's pages are shot.
- **FR-012 Docs**, same PR: `docs/banking.md` (the six states, `rowFacts` / effective facts, the defaults, `rulesForKey`, *Needs a look*), `docs/linking.md` (the reasons' partner, D74), `docs/partners.md` (`authority`, the roles, `ensureSystemPartners`), `docs/accountant-package.md` (the column, the flag), `docs/deployment.md` (the migration's log lines and the reversal query), `docs/feature-inventory.md` (D58 applied, D73 built, D74 decided by the owner's read, D33's line), `docs/features.md` F129, `specs/banking/one-table.md` status (PR C built here), this spec's status, `specs/justify/tasks.md` T013a–l ticked; a lesson only for a real finding.

## Success Criteria *(mandatory)*

- **SC-001** On the seed after the e2e journeys: no row is *linked* or *no_document* without an effective partner except transfer legs and savings rows — `listTransactions` filtered on the two new states is empty once each journey ends; the sidebar count equals the Months panel's *to justify* of every month (`open-work.test.ts` holds it against the list, as today).
- **SC-002** `grep -rn "partnerId\|basCode" src/modules/banking/effective.ts` shows no write; `SELECT count(*) FROM audit_logs WHERE entity_type = 'bank_transaction' AND action = 'update'` does not move when a link is made or removed (the derivation writes nothing).
- **SC-003** The migration test's counts (US5) hold; its second run reports zeros; the box's log names its counts the same way.
- **SC-004** (one-table SC-004) The package of a month with an uncategorised row justified by a 6540 supplier invoice prints `6540` and the supplier in the bank sheet — the new golden, captured once.
- **SC-005** A *no proof* answer never leaves a row without a partner: `justify.test.ts` refuses the call without one; the e2e's fee row shows *Nordea*.
- **SC-006** No new table, no new link kind, no stored status; the one new column is a role on the partner; `kernel/guards` green.

## Assumptions and decisions taken here

- **The marker is a column.** The brief preferred a field `partners` already has. Read: `external_identifiers` are printed on client invoices as references (`invoices/drafts.ts` `printedReferences`) and the form lets the owner delete them (five slots); `short_code` is the invoice series key and editable; `source` is the caller channel enum (`web | mcp | cli | system | seed`); `types` is editable and not unique; `tenant_configs` is a key/value table nothing reads (a config engine for one use — CLAUDE.md *Don't*). A role that must survive the owner's edits and be unique per tenant is one nullable column with a partial unique index — the shape of `bank_accounts.role`. The PR is serialised anyway.
- The hook that creates a tenant (`kernel/auth`) does not seed partners: the kernel never imports a module; the first import does, and a tenant without a bank row needs none of the four.
- The backfill touches rows categorised by a rule (Q2 recommends yes); `categorised_by` and `rule_id` stay — the rows read *by rule* as before, with a partner the History attributes to the migration.
- The bank sheet keeps one line per bank row (a statement is a statement): several proofs show as the larger one plus `mixed`; the *Links* sheet carries the split. The one-table edge case's "one line per allocation" is read that way.
- D68 (four digits) and this migration are independent: the map holds both forms.
- Rollback = the snapshot before the deploy ([[deployment]]); the audit trail gives a surgical undo of the backfill alone.

## Questions for the owner (one batch; the recommended answer is the spec's)

1. **The four names.** *Nordea* (from the bank format), *Skatteverket*, *Swiss Federal Tax Administration (FTA)*, and your user name for the employee partner — as seeded, renamed by you on `/partners` whenever you like. Fine, or other names from the start?
2. **The backfill touches rule-justified rows.** Every fee / interest row the two default rules flagged gets the bank, by the account map, without re-opening — they are the bulk of the box's no-proof rows. *Recommended: yes.* The alternative (rules' rows left to re-open) means one `n` per fee row.
3. **Transfer legs and savings rows need no partner.** The other statement is the proof (D13 / F65): a `CHANGE CHFSEK` leg and a savings-account row stay *no document* without a partner; the savings interest still gets the bank through its rule. *Recommended: yes.*
4. **Tax goes by the account's currency.** The *tax* reason proposes the FTA on a CHF-account row and Skatteverket on a SEK one (the backfill does the same for 251 / 2510 rows). *Recommended: yes* — the proposal is a fact, you can switch it.

## Out of scope

- The screens (F131: the work surface, the reading dialog, the partner form in the dialog — the partner line lands on today's F97 panel), the import preview (F128: it shows the rule's partner, nothing here changes for it), the checks (F130: `checkProof` reads `rulesForKey`), `journal_entries` drop (F113 PR B), four-digit BAS (D68), reassigning a system role to another partner, a second bank's partner.
