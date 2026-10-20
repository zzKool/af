# specs/banking/fixtures — index

Data only (no code). Source commit for v1 material: `af_core` a2fe220.

| file | origin | what it is | used by |
|---|---|---|---|
| `matching-cases.json` | v1 `lib/banking/__tests__/matching.test.ts` | the 20 v1 matcher scenarios as data: transaction, candidate entity, expected confidence / reasons / score (score computed from v1's weights) | H3 tests, §6 |
| `match-scoring-cases.json` | v1 `components/documents/wizard/utils/__tests__/matchScoring.test.ts` | the client-side document → transaction scorer (100/30/10, good ≥ 80), partial-payment and currency-mismatch cases | H3 tests, §6 |
| `rounding-tolerance-cases.json` | v1 `lib/utils/rounding.ts` + its tests | per-currency underpayment tolerance (CHF 0.05 / SEK 0.50 / EUR 0.05) and the PAID / PARTIALLY_PAID / UNPAID derivation | H3 §4.4, §8 |
| `categorisation-rules-sample.json` | v1 `CategorizationRule` shape + the rules named in the feature inventory / Excel mapping | sample rules (OPENAI, MSFT, AVGIFTER NORDEA, SALARY, SKATTEVERKET, Ränta), matcher semantics, `testPattern` cases. BAS numbers to confirm with the accountant | H4 tests, §6 |
| `v1-swedish-headers.csv` | v1 `lib/banking/__tests__/fixtures/swedish-test.csv` (copied verbatim) | comma-delimited, dot-decimal, Swedish headers (`Bokföringsdatum,Belopp,Valuta,Saldo,Avsändare,Mottagare,Namn,Övriga uppgifter,Meddelande`), 8 rows. **Not a Nordea export** — it matches v1's older `app/api/banking/import` route (Swedish/English header aliases). No v1 test reads it (dead fixture). Keep only as a negative case: the v3 Nordea format must reject it (`;` expected) | H11 §6 (negative) |
| `nordea-transfer-pair-chf.csv` / `nordea-transfer-pair-sek.csv` | **synthetic**, written for this spec from `docs/excel-to-v3-mapping.md` Sheet 1 | one `CHANGE CHFSEK` pair in v2's Nordea format: −9 093,63 CHF on the CHF account and +108 941,69 SEK on the SEK account, same booking date, implied rate 11.98. The counterparty text is a placeholder — Nordea's real wording for an own-account exchange must be taken from a real export (open question §9) | H11 transfer-pair tests |
| `nordea-bank-fee-duplicate-rows.csv` | **synthetic** | two identical `AVGIFTER NORDEA` rows on the same day that differ only by balance — proves the dedup key must include balance (or an occurrence counter), and that the fee rule fires with `no_document_needed` | H11 dedup + fee rule tests |
| `nordea-savings-year.csv` | **synthetic**, pattern from v3 `__fixtures__/nordea-interest.csv` | a year of the savings account: one capital transfer in, one `Ränta` row (empty Name, year in Sender, text in Additional details) | H11 "savings yearly" tests |

The v2 Nordea fixtures already live in the v3 repo at `src/modules/banking/__fixtures__/nordea-*.csv` (sek-valid, chf-valid, interest, empty, headers-only, encoding, bom, quoted-semicolons) and are not duplicated here.

Real Nordea exports are never committed (`prisma/data/*.csv` is git-ignored; v2's `describe.skipIf` tests run against them locally).
