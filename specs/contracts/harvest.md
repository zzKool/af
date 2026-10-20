# Harvest — contracts (H5: Contract rate history)
Sources read (af_core, commit a2fe220, no git history available in the checkout — code only):
`lib/rates/lookup.ts` (`getApplicableRate`, `getRateHistory`, `getCurrentRate`) · `prisma/schema.prisma` models `ClientRate` (l.1684), `ServiceCatalog` (l.1727), `PricingRule` (l.1775), `PriceList` (l.1836), `PriceListItem` (l.1893), `InvoiceLineV2` (l.2636) · `app/api/partners/[id]/rates/route.ts` (GET, POST) · `app/api/partners/[id]/rates/[rateId]/route.ts` (GET, PATCH, DELETE) · `app/api/clients/[id]/rates/**` (legacy twin of the partners routes) · `app/dashboard/partners/[id]/rates/new/page.tsx` · `app/dashboard/partners/[id]/rates/[rateId]/edit/page.tsx` · `app/dashboard/partners/[id]/page.tsx` (rates card, `RATE_TYPE_LABELS`) · `components/invoices/InvoiceV2Document.tsx` (`fetchClientRates`, `handleAddFromClientRate`, `serviceTypeToQuantityType`) · `lib/pricing/pricelist-lookup.ts` (`resolvePriceList`, `findPriceListItem`, `lookupPrice`, `getEffectivePrices`) · `lib/validation/pricelist.ts` (`computePrice`, schemas) · `lib/validation/pricing.ts` (`BILLING_UNITS`, `calculatePriority`) · `app/api/pricing/applicable/route.ts` · `app/api/pricelists/[id]/version/route.ts` · `lib/validation/__tests__/pricelist.test.ts` · `lib/pricing/__tests__/pricelist-lookup.test.ts` · `components/rate-range-filter.tsx` · `components/pricing/PricingPicker.tsx` · `scripts/migrate-client-rates.ts`.

## 1. What the feature is for (owner's terms)
One client (Vaudoise), billed per day, in CHF. The daily rate changes by year: 1 000 in 2025, 1 200 in 2026. When an invoice for "2026 January, 20 days" is created, the line must pick the rate that was valid for that period and keep it forever on the line, even if the rate table is edited later. v1 built three generations of this (ClientRate → PricingRule/ServiceCatalog → PriceList/PriceListItem); only the first one, effective-dated rates per client, is what v3 keeps (feature-inventory §3.4).

## 2. Behaviour — rules as numbered statements

### 2.1 What v1 DID — `ClientRate` (the generation v3 keeps)
- R1 A rate row belongs to one client partner (`partnerId`) and optionally to one project (`projectId`) and/or one consultant (`consultantId`, a partner with role EMPLOYEE); `null` means "applies to all". (`schema.prisma` l.1686–1688)
- R2 A rate has a `serviceType` (free string, default `"Daily"`; UI writes `DAY|HOUR|UNIT|FIXED|SESSION|KM|MONTH`, legacy rows hold `Daily|Hourly|Fixed`) and a `serviceName` (default `"Standard Rate"`, used as the invoice line description). (`schema.prisma` l.1691–1692; `rates/new/page.tsx` `RATE_TYPES`)
- R3 A rate stores two amounts: `dailyRate` Decimal(18,2) required and `hourlyRate` Decimal(18,2) nullable, plus `currency` (default `"CHF"`, UI default = partner `defaultCurrency`). (`schema.prisma` l.1695–1697; POST route l.253 `currency || partner.defaultCurrency`)
- R4 Validity is `validFrom` (required DateTime) and `validTo` (nullable; `null` = open-ended / "Present"). (`schema.prisma` l.1700–1701)
- R5 Lookup for a date `d`: a rate applies when `validFrom <= d AND (validTo IS NULL OR validTo >= d) AND isActive = true`; both bounds inclusive. (`lookup.ts` l.39–49)
- R6 Precedence when several rates apply: project-specific rate first (if a `projectId` is given), else the client-wide rate (`projectId = null`); within a tier, the one with the latest `validFrom` wins (`orderBy validFrom desc`, `findFirst`). Consultant is NOT part of the lookup (`consultantId` ignored by `getApplicableRate`). (`lookup.ts` l.32–108)
- R7 If nothing applies, the lookup returns `null` = "manual entry required". (`lookup.ts` doc comment l.25)
- R8 Creating a rate with `validTo = null` auto-closes every existing open rate of the same (partner, project, consultant) combination by setting its `validTo = validFrom` of the new rate. The close is `updateMany` on `{partnerId, validTo: null, isActive: true, projectId: projectId || null, consultantId: consultantId || null}`. (POST route l.224–241)
- R9 Creating a rate with an explicit `validTo` does NOT close anything — overlaps are allowed and never validated. No check that `validTo > validFrom`, no overlap check on PATCH either. (POST/PATCH routes — absent)
- R10 Required on create: `serviceType`, `serviceName`, `dailyRate`, `validFrom` → else 400 `Missing required fields: serviceType, serviceName, dailyRate, validFrom`. A `dailyRate` of `0` fails this check (falsy). (POST route l.165–170)
- R11 Rates exist only for partners with role CUSTOMER: 400 `Rates can only be managed for partners with CUSTOMER role` (GET) / `Rates can only be created for partners with CUSTOMER role` (POST). (route l.39–44, l.141–146)
- R12 `projectId`, when given, must exist and belong to the same partner: 404 `Project not found`, 400 `Project does not belong to this partner`. `consultantId` must be a same-tenant partner with role EMPLOYEE: 404 `Consultant not found`, 400 `Selected partner is not an employee`. (POST l.172–222)
- R13 PATCH is a partial update of any field including `validFrom`/`validTo`/`isActive`; `isActive = false` hides the rate from lookup and from the history list (`getRateHistory` filters `isActive: true`) but the partner page lists all rows regardless (no `isActive` filter in the page fetch). (PATCH route l.192–210; `lookup.ts` l.121–124; partner page l.257–262)
- R14 DELETE is a hard delete, guarded only by `confirm("Are you sure you want to delete the rate "<serviceName>"?")` in the UI; no check for invoice lines referencing the rate. (DELETE route l.294–297; partner page l.330–333)
- R15 Rate list order: `validFrom desc, serviceType asc`; cursor pagination; optional filters `isActive=true|false`, `projectId`. (GET route l.46–84)
- R16 The partner page labels each rate `Current` when `validFrom <= now && (validTo == null || validTo >= now)`, `Expired` when `validTo < now`, else `Future`; and `Partner-wide` vs `• <project name> (<code>)`. (partner page l.864–917)
- R17 The invoice editor fetches `/api/partners/{id}/rates` when the client changes and offers a "Rates (n)" panel listing only rates valid **now** (`new Date()`), not at the invoice date; clicking one adds a line with `description = serviceName`, `unitPrice = hourlyRate` when `serviceType` maps to HOUR and `hourlyRate` exists, else `dailyRate`; `quantityType` from `serviceTypeToQuantityType` (`DAILY→DAY`, `HOURLY→HOUR`, unknown→`DAY`); `vatRate` = partner default VAT. The rate id is stored in the line's `serviceId` field "as a reference" (a misuse: `serviceId` is the ServiceCatalog FK). (`InvoiceV2Document.tsx` l.545–571, l.594–626)
- R18 The invoice line keeps `unitPrice`, `quantity`, `quantityType` as its own columns; editing a rate never touches issued lines. There is no FK from the line to `ClientRate`; `pricingRuleId` (PricingRule generation) is the only "audit trail" column. (`schema.prisma` l.2636–2669)

### 2.2 What v1 DID — the two later generations (dropped in v3, recorded for completeness)
- R19 `PricingRule` = price per `ServiceCatalog` service with optional scope (partner, consultant, project), `validFrom`/`validTo`, and a stored `priority` = `1000·[partner] + 500·[consultant] + 250·[project]` (`calculatePriority`, `lib/validation/pricing.ts` l.184–194). `/api/pricing/applicable` returns, for a context, all active rules in validity whose each scope field is `null` or equals the context, ordered `priority desc, createdAt desc`; the first per service is `isBestMatch`. (`applicable/route.ts` l.47–181)
- R20 `PriceList` (Odoo pattern): named list with `type ∈ {FIXED, DISCOUNT, FORMULA}`, `parentId` inheritance, per-tenant `isDefault`, `priority`, validity; `PriceListItem` per service (+ optional consultant) with `computeType ∈ {FIXED, DISCOUNT, FORMULA, SURCHARGE}`, `minQuantity` tiers, currency override, item validity. Resolution: project pricelist → partner pricelist → tenant default; inside a list: consultant item → service item (highest `minQuantity <= quantity` first) → parent list (cycle-guarded) → `ServiceCatalog.defaultPrice` → `not_found` (price 0). (`pricelist-lookup.ts`)
- R21 `computePrice(type, base, v)`: FIXED → `v.fixedPrice ?? base`; DISCOUNT → `base × (1 − pct/100)`; SURCHARGE → `base + amount`; FORMULA → `base × multiplier`; unknown → `base`. 32 unit tests. (`lib/validation/pricelist.ts` l.338–367)
- R22 "New version" of a pricelist: original gets `isActive=false, validTo=now`, copy gets code `BASE_V{n+1}`, name `"<name> (V{n})"`, `parentId = original.id`, items copied with `validFrom = now`, partner/project assignments moved. Because `findPriceListItem` refuses inactive parents, versioning silently breaks inheritance from the previous version. (`version/route.ts` l.92–175; `pricelist-lookup.ts` l.173–175)
- R23 `scripts/migrate-client-rates.ts` migrated ClientRate → ServiceCatalog + PricingRule, but the invoice editor still reads ClientRate (R17) — the migration direction was abandoned mid-way.

### 2.3 Dead code / bugs found in v1 (do not port)
- B1 `lib/rates/lookup.ts` has **zero callers** — the effective-date lookup (R5–R7) was never wired into invoice creation. The editor re-implements a "valid now" filter in the browser (R17).
- B2 `components/pricing/PricingPicker.tsx` is imported nowhere (dead); `app/api/clients/[id]/rates/**` is a pre-partner-migration duplicate of the partners routes.
- B3 Rates valid at the invoice date but expired today are invisible in the editor; future rates likewise (R17 uses `now`).
- B4 The "Add rates" page saves N lines with `Promise.all` — N concurrent POSTs each running R8; two open rates created in one batch race each other.
- B5 The partner page prints `rate.currency + dailyRate`, but the invoice panel prints `formatCurrency(rate.dailyRate)` in the **invoice's** currency — wrong when they differ.
- B6 Derived amounts: the create form computes `dailyRate`/`hourlyRate` from one typed amount with hard constants (HOUR: daily = amount × 8; DAY: hourly = amount / 8; MONTH: daily = amount / 22, hourly = amount / 176; others: daily = amount, hourly = null) and the edit page reverses MONTH as `dailyRate × 22`. Invented business rules, not the owner's.
- B7 `dailyRate = 0` is rejected as "missing" (R10 falsy check).
- B8 Auto-close sets the old rate's `validTo` equal to the new rate's `validFrom`, so both are valid on the switch day; only the `validFrom desc` ordering hides it (R6, R8).
- B9 No overlap validation at all for rates created with an explicit `validTo` (R9).

## 3. Data — the fields that matter

### 3.1 v1 `ClientRate` (what the owner used)
| field | type | meaning | constraints / derived? | v3 note |
|---|---|---|---|---|
| partnerId | id | client | must have role CUSTOMER | becomes `contractId` (contract already carries the partner) |
| projectId | id? | project scope | must belong to the partner | dropped (no projects, D11) |
| consultantId | id? | employee scope | must have role EMPLOYEE | dropped; `contract.assigned_employee_id` already exists in v2 |
| serviceType | string | billing unit | `DAY/HOUR/UNIT/FIXED/SESSION/KM/MONTH` (+legacy `Daily/Hourly/Fixed`) | dropped; v3 unit is always **day** (D11); a `unit` column only if the owner confirms hours exist (Q1) |
| serviceName | string | line description | required | moves to the contract as default line description (`Consulting Services`, Excel *Activity*) |
| dailyRate | Decimal(18,2) | the rate | required, > 0 | `contract_rate.rate` Decimal(15,2) |
| hourlyRate | Decimal(18,2)? | derived twin | see B6 | dropped |
| currency | char(3) | rate currency | default partner currency | lives on the **contract** (one currency per contract, §3.4); not repeated per rate |
| validFrom | date | first day the rate applies, inclusive | required | `valid_from` date, required |
| validTo | date? | last day, inclusive | null = open | `valid_to` date?, null = open; must be ≥ valid_from |
| description, notes | text? | free text | — | one `note` text? |
| isActive | bool | soft hide | default true | dropped — history rows are never hidden; a wrong row is deleted while unused, otherwise closed with `valid_to` |

### 3.2 v1 `InvoiceLineV2` columns that freeze the price
`quantity Decimal(10,4)`, `quantityType` (DAY…), `unitPrice Decimal(18,2)`, `grossAmount = quantity × unitPrice`, `periodStart/periodEnd` (nullable), `pricingRuleId` (nullable "audit trail", only for the PricingRule generation). v3 keeps the same idea: `invoice_line.quantity`, `unit_price`, `rate_source_id` (validated UUID of the `contract_rate` used, nullable), `period_start`, `period_end`.

### 3.3 Statuses
Rates have no status column. The derived labels (R16) `current | expired | future` relative to today are display only. v3 keeps the three labels, derived in the query, never stored.

## 4. Algorithms / formulas

### 4.1 Rate lookup for a date (v1 `getApplicableRate`, kept)
```
input: partnerId, projectId | null, d
candidates(tier) = rates where partnerId = p
                     and projectId = tier (projectId or null)
                     and isActive
                     and validFrom <= d
                     and (validTo is null or validTo >= d)
pick(tier)        = candidates(tier) ordered by validFrom desc, first
result            = pick(projectId) if projectId and found
                    else pick(null)
                    else null   → "manual entry required"
```
v3 version (one tier, no project):
```
rate_for(contract, d) = first of contract_rate
                        where contract_id = c and valid_from <= d and (valid_to is null or valid_to >= d)
                        order by valid_from desc
```

### 4.2 Auto-close on insert (v1 R8, kept with a correction)
```
on create(new) where new.valid_to is null:
  update contract_rate set valid_to = new.valid_from - 1 day      -- v1 used = new.valid_from (one-day overlap, B8, see §9 Q2)
  where contract_id = new.contract_id and valid_to is null
```
v1 set `validTo = validFrom` of the new rate, which makes both rates valid on the switch day; R6's `validFrom desc` ordering hides the overlap. v3 should close on `valid_from − 1 day` so intervals never touch, and reject any insert/update that would overlap an existing interval.

### 4.3 Rate for an invoice period (new in v3, derived from D11 + Excel *Income*)
The line's rate is the rate valid on the **first day of the invoiced period** (`period_start`; for the Excel label `2026 January` that is 2026-01-01). If `period_start` is empty, use the invoice date. If the period spans a rate change (rate valid_to inside the period), the UI splits into two lines, one per rate, and the owner adjusts the day counts. The chosen rate id and value are copied onto the line at that moment and never re-read.

### 4.4 Priority score of PricingRule (dropped, recorded)
`priority = 1000·partner + 500·consultant + 250·project` → global 0, client 1000, client+project 1250, client+employee 1500, all three 1750.

## 5. UI behaviour worth keeping

### 5.1 Rates card on the partner (v1) → rates table on the contract (v3)
- One card per rate, colour by derived state: green **Current**, grey **Expired**, blue **Future**; fields `Daily Rate` (`CHF 1,200`), `Hourly Rate` (only if set), `Valid From`, `Valid To` (`Present` when open); `Partner-wide` or project tag; edit pencil, delete trash; empty state `No rates defined yet` + `Create First Rate`.
- v3: a 4-column table inside the contract tab (`Valid from · Valid to · Rate · Note`, state chip), newest first, inline add row at top: `valid from` (date, default today), `rate` (number), `note`. Closing the open rate is automatic (4.2).

### 5.2 "Add rates" grid (v1) — strings
Header `Add Rates for {partner}`, sub `Create one or more rates for this client. Each rate can be linked to a specific project.`; columns `Type* · Description* · Currency* · Amount* · Project · Consultant · From* · To`; placeholders by type (DAY `1200`, HOUR `150`, UNIT `100`, FIXED `5000`, SESSION `500`, KM `0.70`, MONTH `15000`); tip `Leave "To" date empty for ongoing rates.`; validation strings `Description is required for all rates`, `A valid amount is required for all rates`, `Effective From date is required for all rates`; success `{n} rate(s) created successfully`; button `Save {n} Rate{s}`.
- v3 keeps only: default `valid_from` = today, "leave *to* empty for an ongoing rate", `A valid amount is required`, `Valid from is required`. The multi-line grid is not needed for one client.

### 5.3 Invoice editor — "Rates (n)" panel (v1) → rate auto-fill (v3)
- v1: a toggle button `Rates (n)` under the lines; panel `Client Pricing Rates` listing `★ {serviceName} ({type}) … {amount}`; a yellow strip `Default VAT: {x}% ({country})`. Click = add a line.
- v3: when the contract and period are set, the line is pre-filled: description = contract default description, quantity = days (typed), unit = day, rate = `rate_for(contract, period_start)`; a small caption under the rate `Contract rate valid 2026-01-01 → open` ; if no rate → caption `No contract rate for this period — enter manually` and the field is editable. The rate field stays editable (override allowed; the override is what gets stored).

### 5.4 Strings (en/fr) — v1 had only en. v3 keys to create
| key | en | fr |
|---|---|---|
| contracts.rates.title | Rates | Tarifs |
| contracts.rates.validFrom | Valid from | Valide du |
| contracts.rates.validTo | Valid to | Valide jusqu'au |
| contracts.rates.open | Open | En cours |
| contracts.rates.state.current | Current | Actuel |
| contracts.rates.state.expired | Expired | Expiré |
| contracts.rates.state.future | Future | À venir |
| contracts.rates.empty | No rates yet | Aucun tarif |
| contracts.rates.add | Add rate | Ajouter un tarif |
| contracts.rates.tip | Leave "valid to" empty for an ongoing rate. | Laisser « valide jusqu'au » vide pour un tarif en cours. |
| contracts.rates.error.amount | A valid amount is required | Un montant valide est requis |
| contracts.rates.error.validFrom | Valid from is required | La date de début est requise |
| contracts.rates.error.overlap | This rate overlaps an existing rate ({from} → {to}) | Ce tarif chevauche un tarif existant ({from} → {to}) |
| contracts.rates.error.inUse | This rate is used on {n} invoice line(s) and cannot be deleted — close it instead | Ce tarif est utilisé sur {n} ligne(s) de facture et ne peut pas être supprimé — clôturez-le |
| invoices.line.rateCaption | Contract rate valid {from} → {to} | Tarif du contrat valide {from} → {to} |
| invoices.line.noRate | No contract rate for this period — enter manually | Aucun tarif de contrat pour cette période — saisir manuellement |

## 6. Tests to port
v1 has **no tests** for `ClientRate` or `lib/rates/lookup.ts`. The 788-line `pricelist-lookup.test.ts` and 551-line `pricelist.test.ts` test the dropped generations; their *scenarios* for date validity are reused below. Fixture: `fixtures/rate-history-cases.json`.

- `lookup: date inside the open rate` → 2026-03-15 on {1000 @2025-01-01→2025-12-31, 1200 @2026-01-01→open} returns 1200 (case `inside-open`).
- `lookup: date inside the closed rate` → 2025-06-30 returns 1000 (`inside-closed`).
- `lookup: validFrom inclusive` → 2026-01-01 returns 1200 (`from-inclusive`).
- `lookup: validTo inclusive` → 2025-12-31 returns 1000 (`to-inclusive`).
- `lookup: before first rate returns null` → 2024-12-31 returns null (`before-first`).
- `lookup: gap between rates returns null` → {A 2025-01-01→2025-06-30, B 2025-09-01→open}, 2025-07-15 → null (`gap`).
- `lookup: latest validFrom wins when two apply` (from v1 `orderBy validFrom desc`; v3 should make this unreachable by the overlap guard, test kept as property) (`overlap-latest-wins`).
- `create open rate closes previous open rate` → previous `valid_to` becomes `new.valid_from − 1 day` (v1: `= new.valid_from`, see Q2) (`auto-close`).
- `create rate with validTo < validFrom is rejected` (v1 had no check; pricelist schema message `Valid To date must be after Valid From date`).
- `create overlapping closed rate is rejected` (new; v1 allowed it).
- `delete rate referenced by an invoice line is rejected` (new; v1 hard-deleted).
- `invoice line stores rate snapshot` → after changing the rate 1200 → 1300, an issued line still shows 1200 (R18).
- `line for period spanning a change proposes a split` (4.3) — e2e.
- From `pricelist-lookup.test.ts` "Date Filtering": `should respect pricelist validFrom date`, `should respect pricelist validTo date`, `should use pricelist when date is within validity period` → same three assertions on `contract_rate`.
- From `pricelist.test.ts` "date validation": `should accept null validTo (ongoing)`, `should reject validTo before validFrom`.
- Property test (test-conventions skill): for any set of non-overlapping intervals and any date, `rate_for` returns the unique interval containing the date or null.

## 7. Fixtures copied → `specs/contracts/fixtures/`
- `rate-history-cases.json` — the owner's rate history (1 000 CHF 2025, 1 200 CHF 2026) as data plus the lookup cases of §6 with expected results. Derived from v1 lookup semantics; the numbers are the owner's (feature-inventory §3.4).
- `v1-rate-types.json` — v1's `RATE_TYPES` list (value, label, placeholder) and the `serviceType → quantityType` mapping, copied from `rates/new/page.tsx` and `InvoiceV2Document.tsx`. Reference only (v3 uses days).
- `v1-compute-price-cases.json` — the 32 `computePrice` cases from `lib/validation/__tests__/pricelist.test.ts` as (type, base, values, expected). Reference only: documents what DISCOUNT/SURCHARGE/FORMULA meant if a per-line discount ever needs the same arithmetic (H1 keeps "lines (days × rate, discount)").

## 8. v3 mapping
What changes, per decision:
- **Scope** (D11, §3.4): `ClientRate` + `Project` + `PricingRule` + `ServiceCatalog` + `PriceList(+Item)` → one table `contract_rate (id, tenant_id, contract_id, valid_from, valid_to?, rate Decimal(15,2), note?, created_at, created_by, source)`. Currency is `contract.currency` (v2 already has it; CHF/EUR/SEK). Unit is day. No project, consultant, service, priority, inheritance, versions, compute types.
- **v2 `contract.billing_rate`** becomes the *current* rate convenience: either drop the column and derive, or keep it as a cached copy of `rate_for(contract, today)` updated by the service (prefer derive; one query). Decide in the contracts slice.
- **Lookup** lives in `modules/contracts/contracts.ts` as `rateFor(tx, contractId, date)` and is exposed through `index.ts` as a DTO `{ id, rate: string, currency, validFrom, validTo }`; the invoices module calls it when a line is created (hexagonal: invoices → contracts index only).
- **Invariants in DB** (constitution): `CHECK (valid_to IS NULL OR valid_to >= valid_from)`; an exclusion constraint on `(contract_id, daterange(valid_from, COALESCE(valid_to,'infinity'), '[]'))` with `btree_gist` so overlaps are impossible even under concurrency (fixes B4/B9); FK `contract_id` with `ON DELETE RESTRICT`.
- **Auto-close** (4.2) stays as service behaviour, audited (`audit.log` rate.create + rate.close).
- **Immutability on the line** (D3 spirit, R18): `invoice_line.unit_price` + `rate_source_id` written once at line creation; editing a rate never rewrites lines; deleting a rate that any line references → `AppError BUSINESS_RULE_VIOLATION` (string in 5.4).
- **Statuses derived** (constitution): `current/expired/future` computed in `queries.ts`, not stored. `isActive` dropped.
- **UI** (D19): rates are a tab/section of the contract inside the partner entity page (v2 pattern `contract-pattern.md`), list archetype table with inline add; the invoice editor shows the rate caption (5.3).
- **Dropped**: `app/dashboard/pricing/**`, `pricelists/**`, `PricingPicker`, `EffectivePricesTable`, `PricelistSelector`, `VersionHistory`, `rate-range-filter.tsx` (superseded by the kernel DataTable number filter, H13), `/api/clients/[id]/rates` twin, hourly/monthly derivations (B6).
- **New**: overlap guard, period-split proposal (4.3), reference guard on delete, en/fr strings.

## 9. Open questions for the owner

> **Answered 2026-10-20** — the owner\'s answers and the resulting decisions are in `docs/open-questions.md` (B5, B6, D-j → D24). The questions below are kept as the record of what was asked.
- Q1 Day is the only unit (D11). Confirm there is no hourly or fixed-fee billing anywhere (v1 had HOUR/FIXED/SESSION/KM/MONTH; the migration script only ever mapped Daily/Hourly/Fixed). If a second unit exists, `contract_rate.unit ∈ {day, hour}` is one enum column, nothing else changes.
- Q2 Switch-day semantics: v1 closed the old rate on the new rate's `validFrom` (both valid that day). v3 proposes close on `valid_from − 1` and reject overlaps. OK?
- Q3 Rate for a period: proposal = rate valid on `period_start` (first of the month for `2026 January`), split lines when a change falls inside the period. Alternative: rate valid on the invoice date. Which one matches how Vaudoise was invoiced in the past (a January 2026 invoice issued in February at 1 200?).
- Q4 Keep v2's `contract.billing_rate` column as "current rate" cache, or drop it and derive? (Derive proposed.)
- Q5 A rate can be in CHF only via the contract currency. Is there any case of two currencies for one client at the same time (would need two contracts)?
