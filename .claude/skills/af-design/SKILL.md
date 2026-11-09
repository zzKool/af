---
name: af-design
description: The AF visual direction ("Pulse" look D76 on D40's layout) as a checklist — tokens, type, numbers, states vs tags, shell, page anatomy, details panel, buttons, light/dark, logo. Use before building or changing any page, component, panel, dialog or the shell, and when reviewing a UI PR.
---

# AF design — the checklist

The rules live in `docs/ui-conventions.md` (*Layout*, *Visual direction*, *DataTable*). This skill is the short form; when the two disagree, the doc wins and this file gets fixed in the same PR. The decisions are D40 (the layout) and D76 (the Pulse look, replacing D40's look) in `docs/feature-inventory.md`; the mockups are the Design canvas *AF — UI redesign* (the *Pulse* boards, light and dark). A page moves from the one canvas card to its own cards in its phase (`docs/roadmap.md` C5).

## Before you build
- Which archetype is it — **list**, **entity** or **work**? Nothing else exists. A fourth shape is a constitution question, not a component.
- Read the module's spec folder and its `docs/<module>.md`; reuse the kernel kit (`kernel/ui/*`, `components/ui/*`) — never restyle a shadcn primitive inside a module.
- The kit (built by F39; the map is *Where it lives* in `docs/ui-conventions.md`): `ListPage` / `EntityPage` / `WorkPage` + `PageHeader` (`tags`, `meta`, `actions`, `tabs`, `banner`) · `DataTable` (`quickFilter`, `rowActions`, `context`) · `RowActionsMenu` (the same ⋮ for a kit `Table` that is not a DataTable) · `<StateLabel>` · `<Tag>` `<CodeChip>` `<CountBadge>` · `<InfoBanner>` · `<SplitButton>` · `DetailsSection` / `DetailsGrid` inside the Sheet (it docks) · `formatMoney` · `Button` sizes `default` / `sm`.

## Every page
- [ ] No `max-w-*` on the page; canvas padding 20 px sideways, 14 px top.
- [ ] Breadcrumb with **names, never ids**; the title appears **once**.
- [ ] The Pulse board of the page is the reference (D77): build from it, check the screenshots against it; a rule here that disagrees is rewritten in the same PR.
- [ ] Title row: title 26/700 (no icon tile) · tags · ⋮ · secondary buttons · **one** primary (split `▾` when it has variants); the meta line under it = the page's situation in one line.
- [ ] Tabs are underline tabs with count badges.
- [ ] A banner only for "what to do next here", one sentence, one link.
- [ ] Every string through `useT()` / `translator()` — en, fr, sv in the same PR.

## Colour and type
- [ ] Colours only through tokens (`--app`, `--surface`, `--surface-2`, `--border`, `--border-subtle`, `--text`, `--text-muted`, `--primary`, `--action`, `--selection`, `--state-*`, `--tag`, `--destructive`, `--brand`, `--rail-*`, `--cur-*`). No hex in a component, no Tailwind palette colours (`text-green-600`), no gradients (the ground's dots are the one), shadows only `shadow-card` (cards) and `shadow-pop` (popovers, menus, dialogs).
- [ ] Crimson (`--brand`) only in the logo and **+ New**. The primary button is ink (`--action`); links and in-progress are `--primary` blue; errors are `--destructive`; a currency's colour (`--cur-*`) only for that currency in a chart or ticker, never a state.
- [ ] Geist / Geist Mono through `next/font/local` (`app/layout.tsx`, the `geist` package) — nothing fetched; mono for keys, file names and tickers. Never `next/font/google`.
- [ ] Sizes from the scale: 26/700 title · 15/600 panel title · 13 body · 10.5/500 uppercase table headers · 13/600 section heads · 12 secondary.
- [ ] Contrast ≥ 4.5:1 for any text, in light **and** dark.

- [ ] A card is `pulse-card` (never the four classes spelled out); a KPI label is `eyebrow` (F150).

## Numbers and dates
- [ ] Figures use `tabular-nums` so the top bar's eye veils them (F150); a date or count that is no secret gets `data-public`, a non-figure secret (IBAN, reference) `data-sensitive`.
- [ ] Money on screen through the one kernel formatter `formatMoney` (`kernel/money/format-money`): `−2 312.43 SEK` (U+202F thousands, `.` decimals, U+2212 minus, code after) — the same in every UI language. Never `toLocaleString` or `Intl` in a component. `formatCurrency` is for **printed** sheets only.
- [ ] Dates `yyyy-mm-dd`. Figures `tabular-nums`, right-aligned in tables.
- [ ] Keys (`VA26-INV-007`) as a mono code chip; copyable in a title.

## States and tags
- [ ] A state is **derived** (never typed) and shown with `<StateLabel>`: circle icon in its family colour + the word. Families: attention · in progress · done · neutral. The module maps status → family in one place.
- [ ] A tag is metadata only (bank, currency, type) — grey, 4 px, never coloured. Never use a tag for a state, never a coloured pill.
- [ ] Colour is never the only signal: the icon shape and the word carry it too.

## Lists (DataTable)
- [ ] One `DataTable`; header filters stay Excel-style, typed, server-side (D20).
- [ ] Filter bar: `Filter rows…` + one filter button per active/common column (`Month: July 2026 ▾`) + `Clear filters`. No removable chips.
- [ ] 32 px rows, `--border-subtle` separators, the date/key cell is the row link, ⋮ row actions last, column chooser in the header.
- [ ] Footer: count · Σ money columns (server-side) · pager.
- [ ] Selecting a row opens the **docked details panel** (not an overlay sheet): About · Proof · the module form · History (collapsed).

## Buttons and controls
- [ ] 32 px (26 px inside panels and banners), 8 px radius; variants primary (ink) / secondary / link / icon / destructive. Cards 20 px, popovers 10 px, tags 4 px.
- [ ] Icon-only buttons have an `aria-label`; real `<button>` / `<a href>` / `<label>` + `<input>`, never a clickable `div`.
- [ ] Destructive actions go through `ConfirmDialog`.

## Shell (only F39's builder and later shell PRs)
- [ ] Rail (left, full height): + New · Dashboard · Work · *Records* Banking, Documents, Exchange rates · *Sales* Partners, Invoices · *Costs* Supplier invoices, Expenses, Subscriptions · *Close* Package, Declarations · Settings and open / close at the foot. 232 px with labels and amber counts, 68 px icons collapsed; navy in light.
- [ ] Top bar 56 px right of the rail: logo (`public/brand/af-logo.svg`, `-dark` in dark) · search pill `Ctrl K` (the palette, F93 — `Ctrl P` opens it too) · tenant · sun / moon (saves the D43 preference) · avatar. The nav constants are a shared file — one PR at a time. Strings go to `en.ts` only (D62); the other dictionaries fall back.
- [ ] A new page: its nav item gets a `group` (where it falls in the monthly loop); a named sub-page goes in `SUB_PAGES` (`kernel/ui/shell/routes.ts`) so the breadcrumb and the search know it.
- [ ] Landmark names stay English (`Main navigation`, `Breadcrumb`) — the e2e and screen readers rely on them.

## Light / dark
- [ ] System by default (light, dark from `prefers-color-scheme`) — unless the user forced one in My Preferences or with the sun / moon (D43, `<html data-theme>`); check both before the PR. Dark styling through tokens and `dark:` only, never a `prefers-color-scheme` media query in a component. The logo swaps file (by `dark:`), not colour.

## Definition of done (UI part)
- [ ] A screenshot of every new or changed page in the PR, light — and dark when the change touches colour (from `e2e/screenshots.spec.ts`, which shoots both schemes; add a new page to its `PAGES`).
- [ ] `docs/<module>.md` updated; this skill and `docs/ui-conventions.md` updated if a rule changed.
