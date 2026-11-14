# Pulse — the redesign in phases (D76)

The look decided on 2026-11-07 from the Design canvas *AF — UI redesign*. The rules are in [[ui-conventions]] *Visual direction*; the phases and the owner's must / nice / later / no list in [[roadmap]] C5.

## Phase 1 — the look and the shell (F133)

`screenshots/phase1-*.png`: seed data on a local test database (D51), 1440 × 900, light and dark from the OS — the rail open and collapsed, the dashboard, My Preferences. Every page still sits in the one canvas card; the pages get their own cards in their phase.

## Phase 2a — the banking list and the work surface (F134)

`screenshots/phase2a-banking-*.png`: the e2e journey's invented July rows on a local test database (D51), 1440 × 1100, after the owner's review (2026-11-08) — `list-*`: the situation line, the account cards, the day strip, the list's card with the segments, the five columns, the bars, the dots and the state chips; `open-*`: a row open — the cards as pills, the strip folded, the hero, the three steps, the panel's foot.

## Phase 2b — several CSVs at once (F135)

`screenshots/phase2b-import-*.png`: two invented Nordea files dropped together (the e2e fixtures in `specs/banking/fixtures/`) — one card per file with its account and tally, *Import 14 from 2 files*.

## The gap review of 2026-11-13 — the skin is there, the life is not

The owner: "the Pulse design was amazing, but you failed to implement it … I don't really know what is missing, but something is missing." Main (ca6b342) was built on seed data and every page shot (44 pages, light and dark) beside the boards. Page by page the layout, the cards, the colours and the type are the boards'. What the boards have and the app did not:

| # | On the boards | In the app | Row |
|---|---|---|---|
| 1 | Screens full of a living year | Home, Work and Banking open on **today**; with data that stops earlier (the owner's 2023-Q2) they show zeros and grey squares | F189 |
| 2 | It talks: *Send NW26-008 to Northwind · ready for 7 days — **Send*** | counters and *Open*; `(s)` in 118 strings | F188 |
| 3 | Bold charts: wide bars that rise, a glow on what is late, a live dot | 3 px sticks, no motion | F188 (the home); the live dot open |
| 4 | Designed empty · all done · loading · no results (the board *States*) | a muted sentence | F188 (the kit, every DataTable); the modules' own places open |
| 5 | The cash is the first thing read | *Welcome back, … · last login* above it | F188 |
| 6 | Every screen on cards | plain ones left: *Settle a refund*, the partner's tabs, an expense group, a document's page | open |

`screenshots/f188-home-*.png`: the home after F188, seed data (D51), 1440 wide.
