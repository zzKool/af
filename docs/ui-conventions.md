# UI conventions

Version 4 · 2026-11-07 · Decisions D19, D20, **D40 (the layout, F39)** and **D76 (the Pulse look, F133 — replaces D40's look)** in [[feature-inventory]]. Applies to every page; the repo skill `.claude/skills/af-design` is the checklist form of this page — every UI PR follows it. *Visual direction* below is **built in the shell and the kernel kit** since F39 (2026-10-22, see *Where it lives* at the end of that section); the modules inherit it — what each module still adopts on its own (its states, its on-screen money, its keys and row actions) is F71 in [[features]]. Before v3, Version 2 (2026-10-20) — the layout and the DataTable, unchanged below. **Built** (phase-0 item 8): the shell (`kernel/ui/shell`: sidebar, topbar, `ListPage` / `EntityPage` / `WorkPage` / `PageHeader`), the `DataTable` (`kernel/ui/data-table`) and the `ListQuery` contract (`kernel/list-query`), first used by [[partners]]. Column order / width / visibility persist per user since 2026-10-21 (`kernel/ui/data-table/preferences.tsx` + `table_preferences`). Still to come: virtualised body. The documents library migrated onto it on 2026-10-20 (the legacy table is gone). The list page's **side panel** is `components/ui/sheet.tsx` (first used by the banking workbench and the journal, then the expenses list) — since F39 it docks into the canvas (*Details panel* below); forms that interrupt (import, rule, manual entry, new expense, new group) use `components/ui/dialog.tsx`. The first **work page** is `/expenses/settle` (`WorkPage`: the open expenses left, the refund row and the confirmation right).

## Layout — full width, dense, app not website

v2 centred pages in `max-w-5xl`. v3 is a working tool for managing a company: screens are wide, dense and consistent.

```
┌─ top bar (44 px, app background): ☰ · logo ───────── search (Ctrl P) ───────── tenant ▾ · avatar ─┐
├─ sidebar (190 → 56 px) ──┬─ content canvas (surface, 1 px border top + left, 10 px top-left radius) ─┤
│ + New                    │ breadcrumb ›                                         │ details panel     │
│ Dashboard                │ ▣ Title  [tag] [tag]           ⋮  [Secondary] [Primary ▾] │ (list pages,  │
│ Records                  │ Tab 11 │ Tab 4 │ Tab                                 │  selected row):   │
│   Banking · Documents ·  │ ⓘ banner (optional)                                  │  ⌃ About          │
│   Journal                │ summary panel (optional, e.g. Months)                │  ⌃ Proof          │
│ Sales: Partners · Invoic │ [Filter rows] [Col: value ▾] [Col ▾] Clear filters   │  ⌃ <module form>  │
│ Costs: Supplier inv. ·   │ DataTable (header filters, 32 px rows, ⋮ per row)    │  ⌄ History        │
│   Expenses               │ footer: count · Σ · pager                            │                   │
│ Close: Package · Decl.   │                                                      │                   │
│ Settings (bottom)        │  entity pages → title row + underline tabs           │                   │
│                          │  work pages   → split panes (list | detail)          │                   │
└──────────────────────────┴──────────────────────────────────────────────────────┴───────────────────┘
```

Rules
- No `max-w-*` on page containers; the canvas padding is 20 px sideways, 14 px on top; content stretches. Reading-length limits apply only to prose (settings help text, notes).
- Three page archetypes and nothing else: **list** (DataTable + the docked details panel for the selected row), **entity** (title row + underline tabs: overview, documents, links, audit), **work** (split panes for linking, review, settlement — list left, detail right, keyboard navigable).
- Density: 13 px table text, **32 px rows**, numbers right-aligned in tabular figures, dates `yyyy-mm-dd`, money as `−2 312.43 SEK` (see *Numbers*).
- Keyboard first on work pages: `j/k` move, `enter` open, `l` link, `u` undo (v1 inbox UX, H7).
- Dark mode via tokens from day one; no hardcoded colours.
- Sidebar hides by role; the server enforces (both required, constitution §6).

## Visual direction — "Pulse" (D76, F133; D40's layout kept)

**The boards are the reference (D77):** where a Pulse board and a rule below disagree, the board wins and the rule is rewritten in the same PR. Chosen by the owner on 2026-11-07 from the Design canvas *AF — UI redesign* (the *Pulse* boards, light and dark), after he found D40's Lakehouse look "too flat … lacks profondeur … you don't really know where to look". **D76 replaces D40's look, not its layout**: the shell's places, the page anatomy, states vs tags, the docked details panel, the money format and the DataTable rules below are D40's and stay. What changes: a dotted ground with raised cards, a rail (navy in light), Geist, an ink primary button, a sun / moon in the top bar. Built screen by screen in seven phases (*[[roadmap]]* — *The Pulse phases*); phase 1 (F133) is the look and the shell, every page still sits in the one canvas card until its phase.

### Brand
- Logo: `public/brand/af-logo.svg` (full, 1143 × 252) and `public/brand/af-sign.svg` (the sign, 167 × 252); `-dark` variants recolour the navy for dark mode. Full logo in the top bar at 24 px high, on the ground right of the rail; the sign is the favicon / app icon. Never re-type the paths; never recolour beyond the two variants.
- Brand colours: navy `#2C3241` (the light rail is its deeper `#1B2230`), crimson `#CD1F3D`. Crimson is the logo and the **+ New** button only — not the action colour, not an error colour.

### Tokens (CSS variables on `:root`, redefined for dark — from the OS unless the user forced light, or forced dark (D43) — mapped onto the shadcn names in `globals.css`)

Light / dark: System (the default) follows the OS; My Preferences — or the top bar's sun / moon, which saves the same preference — can force Light or Dark (D43) — `<html data-theme="light|dark">`, set in the first HTML from the `af-theme` cookie. Colour through tokens and the `dark:` variant only; never `@media (prefers-color-scheme)` or a `<picture>` media query in a component (they ignore the user's choice). The two dark token blocks in `globals.css` stay equal (`kernel/ui/theme.pure.test.ts`).

| token | light | dark | use |
|---|---|---|---|
| `--app` | `#EEF1F5` | `#090C10` | the ground (with a 22 px dot grid, `--dot`) behind the rail, the top bar and the cards |
| `--surface` | `#FFFFFF` | `#11161C` | cards, the canvas card, panels, popovers, inputs |
| `--surface-2` | `#F6F8FA` | `#151B22` | an inset inside a card (a card in a card, a sub-panel, a key chip's ground) |
| `--border` | `#DBE1E7` | `#27303A` | inputs, buttons, table header rule |
| `--border-subtle` | `#EAEEF2` | `#1C232B` | card edges, row separators |
| `--text` | `#0D1520` | `#EEF2F5` | everything readable |
| `--text-muted` | `#566472` | `#8D9AA7` | labels, secondary text (≥ 4.5:1 on every ground: `--app`, `--surface`, `--surface-2`, `--tag`, `--hover`, `--selection`) |
| `--primary` | `#1B64A3` | `#7CC4FF` | links, dates-as-links, active tab rule, focus ring, in-progress — **not** the primary button any more |
| `--primary-hover` | `#134D80` | `#A9D6FF` | hover of the above |
| `--action` / `--action-fg` / `--action-hover` | `#0D1520` / `#FFF` / `#27313D` | `#EEF2F5` / `#090C10` / `#FFF` | the **primary button** — ink on the ground, inverted in dark |
| `--hover` | `#F1F4F7` | `#1A212A` | row and item hover |
| `--selection` | `#E8F1FB` | `#122536` | selected row, active filter button |
| `--brand` / `--brand-fg` | `#CD1F3D` / `#FFF` | `#D63A55` / `#FFF` | **+ New** only (white on it ≥ 4.5:1) |
| `--state-done` | `#19753F` | `#3FB76F` | done icons and bars; positive amounts |
| `--state-progress` | `#1B64A3` | `#7CC4FF` | in-progress icons and bars |
| `--state-attention` | `#985600` | `#F2B04A` | attention icons, *to justify* bars |
| `--state-neutral` | `#8396A5` | `#8396A5` | neutral icons |
| `--destructive` | `#C21E41` | `#FF5470` | delete / irreversible only |
| `--tag` | `#EDF0F4` | `#1C232B` | metadata tags, code chips, info banner |
| `--rail` · `--rail-fg` · `--rail-fg-active` · `--rail-hover` · `--rail-active` · `--rail-group` | `#1B2230` · `#A3AFBF` · `#FFF` · white 8 % · white 13 % · `#8794A5` | the ground · `#8D9AA7` · `#EEF2F5` · `#151B22` · `#1A212A` + a 1 px `--border` ring · `#8D9AA7` | the rail only |
| `--rail-badge` / `--rail-badge-fg` | `#F2B04A` / `#0B0F14` | same | the rail's counts of open work (amber, light on navy) |
| `--cur-sek` · `--cur-chf` · `--cur-eur` · `--cur-usd` | `#0B847A` · `#CC4F2B` · `#1F6FB2` · `#9C6B00` | `#4FD1C5` · `#FF7A59` · `#7CC4FF` · `#E8C15A` | one colour per currency in charts, tickers and exposure bars (the rates and home phases); never for a state |
| `--elev-card` → `shadow-card` | three soft layers | an inner top light + a deep drop | cards and the canvas card |
| `--elev-pop` → `shadow-pop` | | | popovers, menus, selects, dialogs, sheets |

Radius: 4 px tags, chips and checks · 8 px controls (buttons, inputs, menu items) · 10 px menus and popovers · 14 px panels · **20 px cards** and the canvas card. Gradients: the ground's dot grid only (a card's top light lives in its shadow, not a gradient).

### Type
- **Geist** for everything, **Geist Mono** for keys, file names and figures in a ticker — from the `geist` package through `next/font/local` (`app/layout.tsx`): the files ship in the image, nothing is fetched at build or at run time (D51's *the box sends out only*), the system stack shows while they load. D40 had dropped Geist for the system stack; D76 brings it back for the look.
- Scale: page title 26 / 700 (D77) · panel title 15 / 600 · body, table, labels 13 / 400 · table headers 10.5 / 500 uppercase, 0.1 em (D77) · section heads 13 / 600 · secondary 12 / 400 · the rail 13.5 / 400 (600 active) · rail group labels 10.5 / 500 uppercase, 0.12 em · the selected amount in the details panel 22 / 600.
- `font-variant-numeric: tabular-nums` on every figure (amounts, dates, counts, rates). Business keys (`VA26-INV-007`, `SI-2026-031`, `Ex12-6540-003_2026-07-28_`) render as a mono **code chip** (`--tag` background, 4 px radius).

### Numbers
One format in every UI language: thousands with a narrow no-break space (U+202F), `.` decimals, a true minus (U+2212), `+` only where the sign is the point (bank rows), the currency code after: `−2 312.43 SEK`, `+237 740.00 SEK`, `24 000.00 CHF`. One kernel formatter (`kernel/money`), never `toLocaleString` in a component. Printed documents (invoices, statements) keep their language's format — that is [[pdf]]'s rule, not this one.

### States and tags — two different things
- A **state** (derived, constitution: never typed) is an **icon + word**: a 15 px circle icon in the family colour, the word in `--text` (neutral words in `--text-muted`). No pill, no background.

  | family | icon | states |
  |---|---|---|
  | attention | ⓘ-style `!` circle, `--state-attention` | Open (bank row to justify), Overdue, Due, Awaiting link, OCR failed |
  | in progress | half-filled circle, `--state-progress` | Match found, Issued, Sent, Partially paid, OCR pending, Ready |
  | done | ✓ circle, `--state-done` | Linked, Paid, Reviewed / Filed, Settled, Credited |
  | neutral | `–` circle, `--state-neutral` | Draft, Transfer, No document needed, Cancelled, Archived |

  One component, `<StateLabel family state />`, in the kernel kit; a module maps its derived status to a family in one place.
- A **tag** is metadata (bank, currency, document type, VAT registration): grey `--tag` rectangle, 4 px radius, 12 px text, never a colour.
- A **count** is a round grey badge (`--border-subtle`, 11 px / 600): tab counts, sidebar counts of open items.

### Shell
- **Rail** (left, full height; 232 px open with labels, 68 px of icons collapsed — the choice per browser): **+ New** (crimson, white: upload document, import CSV, new invoice / supplier invoice / expense) · Dashboard · Work · groups with uppercase labels (a short rule when collapsed) · lucide icons at 20 px in 38 px rows (42 px squares collapsed), 12 px corners · an **amber count** of open work right of the label, on the icon's corner when collapsed · **Settings** and the **open / close** button (*Collapse sidebar* / *Expand sidebar*) at the foot. Navy in light, the ground in dark. The **order follows the owner's monthly loop**:

  ```
  + New
  Dashboard · Work
  Records   Banking · Documents
  Sales     Partners · Invoices
  Costs     Supplier invoices · Expenses · Subscriptions
  Close     Package · Declarations
  ─────
  Settings · Collapse
  ```
  The group labels are i18n keys (`nav.group.*`). The rates page joins *Records* and the group *Close* becomes *Plan and close* in their phases (nav constants, one PR at a time).
- **Top bar** (56 px, on the ground right of the rail): full logo · the search pill (40 px, 12 px corners, up to 640 px, `Ctrl K`) · tenant switcher · **sun / moon** (flips light ↔ dark and saves it as the user's choice — D43; *System* is picked again in My Preferences) · avatar (ink, 36 px).
- **Content canvas**: one raised card — `--surface`, `--border-subtle` edge, 20 px corners, `shadow-card`, 12 px from the window's right and bottom edges. A page moves to its own cards on the ground in its phase.

### Page anatomy (list and entity pages)
1. **Breadcrumb** — links in `--primary`, `›` separators, the current page not repeated. Names, never ids (`Partners › Valtech Switzerland SA`, not `353ec92f`).
2. **Title row** — title 26 / 700, no icon tile (D77) · copy button when the title is a key · tags · spacer · ⋮ more · secondary buttons · **one primary**; under the title the **meta line** — the page's situation in one line (banking: *12 transactions · **11 need you** · 0 done*) (a split button `Import CSV ▾` when the primary has variants). The title appears once (today's partner page shows it twice).
3. **Underline tabs** — 13 px, the active one `--text` / 600 with a 2 px `--primary` rule, counts as badges.
4. **Info banner** (optional) — `--tag` background, ⓘ icon, one sentence, one link, at most one small button on the right. For what the owner should do next on this page (*July 2026: 4 transactions have no proof yet — package 2026-07 not built. Open package*), not for errors (those are toasts or inline).
5. **Summary panel** (optional) — a card above the table; on banking the **Months** panel (F69): bars per month (*justified* `--state-done` stacked under *to justify* `--state-attention`) and an account × month square grid (done / attention / not imported `--tag`). Clicking a month sets the Month filter.
6. **Filter bar** — `Filter rows…` (the table's free-text search) · one **filter button per active or common column** (`Month: July 2026 ▾`; an active one has `--primary` border on `--selection`) · `Clear filters` link · right-aligned context (balance, as-of date). The buttons open the **same typed filter popovers as the column headers** (D20 unchanged); they replace today's removable chips.
7. **DataTable** — see below; headers 10.5 / 500 uppercase muted on `--surface` with a 1 px `--border` rule (D77), the sort and filter marks on hover / focus / when set, two-line rows where the board has them, rows separated by `--border-subtle`, hover `--hover`, selected `--selection`; the date (or key) cell is the row's link in `--primary`; a ⋮ row-actions button last; the column chooser icon in the header's last cell.
8. **Footer** — row count · Σ of money columns · `‹ Previous` / `Next ›`.

### Details panel (the list page's side panel)
Docked on the right of the canvas (a 1 px `--border` left edge), **not** an overlay sheet: the table narrows. Opens on row selection; × and Escape close the row. Since F74 a **Hide** button beside × collapses the panel to a 40 px rail with **Show**, and the choice is remembered per table (the page's DataTable keeps it in its layout, `panelHidden` in `table_preferences`): a hidden panel stays a rail when another row is picked and after a reload, until *Show*. **Resizable** since F131 ([[review-2026-10-31]] §6.2, O1): a handle on the panel's left edge — drag it, or focus it and press ← (wider) / → (narrower) by 40 px, double-click for the page's default; never under 340 px, never over 75 % of the canvas (the list keeps a quarter). **The default is the page's** (`defaultWidth` on `SheetContent`: px, or a fraction of the canvas): the banking workbench's work surface opens at **38 %** of the canvas (D77; was 55 %, O1); every other page keeps the kit's 380 px (400 px from `xl`). The width the user drags to is remembered **per table** like *Hide* (`panelWidth` in the same layout, `table_preferences` — a JSON column, no migration): the next row and the next reload open at it, until the double-click. Hide / Show and × / Escape are unchanged; the width is not a column change (*Reset layout* leaves it). Section titles from the kernel's keys: `details.about`, `details.proof`, `details.history`. Content, top to bottom: the row's title (description / key) and its amount 22 / 600 with its state · collapsible sections with a chevron header — **About this <thing>** (a key–value grid: label column 110 px `--text-muted`), **Proof** (links and suggestions: the suggested target as a link, its reasons, `Link` primary + `Dismiss`; with nothing linked: `Upload document · Link to… · No document needed`), the module's **form** (category, partner…), **History** (collapsed by default). Small buttons (26 px) inside the panel. Dialogs stay for interrupting forms (import, rule, new expense) — unchanged.

### Buttons
32 px, 8 px radius: **primary** (`--action`: ink in light, near-white in dark, 600) — at most one per title row or dialog; **secondary** (surface, `--border`, a hairline shadow); **link** (no border, `--primary`); **icon** (28 px, no border, `--text-muted`, hover `--hover`, always an `aria-label`); **destructive** (`--destructive`, behind a confirm). 26 px small variant inside panels and banners.

### Light / dark
System by default: light, dark from the OS (`prefers-color-scheme`); the user can force either in My Preferences or with the top bar's sun / moon (D43). Every colour comes from a token; the logo swaps to its `-dark` file. Check both before a PR.

### Where it lives (built by F39, restyled by F133)

| Piece | File | Notes |
|---|---|---|
| Tokens, type, dark | `app/globals.css`, `app/layout.tsx` (Geist) | the table above as CSS variables; shadcn names map onto them (`--background` = `--surface`, `--muted-foreground` = `--text-muted`, `--accent` = `--hover`…); utilities `bg-app`, `bg-surface`, `bg-surface-2`, `border-subtle`, `bg-hover`, `bg-selection`, `bg-action` / `text-action-fg`, `bg-brand` / `text-brand-fg`, `bg-rail` and `*-rail-*`, `text-state-*`, `bg-tag`, `*-cur-sek|chf|eur|usd`, `shadow-card`, `shadow-pop`; `dark:` = the OS unless forced (D43); radius scale 4 · 8 · 10 · 14 · 20 px; the dot grid on `body` |
| Shell | `kernel/ui/shell/app-shell.tsx` (+ `topbar`, `sidebar` (the rail), `theme-toggle`, `breadcrumb`, `details-dock`, `shell-context`, `routes`, `icons`) | the sun / moon (`theme-toggle.tsx`) saves through the settings module's `updateUserThemeAction`, passed in by the app layout as `saveTheme` (the kernel knows no module); a refused save puts the old theme back; the top bar's search is the **Ctrl K palette** (F93, [[search]]: `search-palette.tsx`, `Ctrl K` / `⌘ K` and `Ctrl P` / `⌘ P`) — pages by name in the UI language (`routes.ts` `destinationsFor`) and entities through the `search` action the app layout passes in; the avatar menu holds My preferences and Log out; the sidebar's groups come from `NAV_ITEMS[].group` (`NAV_GROUPS`), **+ New** from `NEW_ITEMS` (each opens the page whose primary makes the thing; the hrefs carry `?new=1`, and the page opens that primary's dialog — `use-new-param.ts`, `useNewParam(canCreate)`, closing drops the param, F73); the collapsed state is per browser; **counts of open work** (F72) — `counts` keyed by nav path, loaded by the app layout (`app/(app)/layout.tsx`, the owner only, one cheap read per module: banking `rowsToJustifyCount`, documents `inboxOpenCount`, invoices `overdueInvoiceCount`, supplier invoices `overdueSupplierInvoiceCount`), an amber count right of the label (on the icon's corner when collapsed, the count in the tooltip too), aria-hidden; the link's accessible name stays the label |
| Breadcrumb | `kernel/ui/shell/routes.ts` `crumbsFor` | named ancestors only (`NAV_ITEMS` + `SUB_PAGES`); ids, `new` and route groups are skipped. A page's own `back` link shows only where the trail is empty (the link graph) |
| Page anatomy | `kernel/ui/shell/page.tsx` | `PageHeader` = title 26 / 700 (no icon tile since D77) · `tags` · `meta` · `actions` · `tabs` · `banner`; `ListPage` / `EntityPage` / `WorkPage` with the 20 / 14 px canvas padding. **`ListPage ground`** (D76): the page renders `data-ground`, the shell's canvas card turns off (`has-[[data-ground]]` on the canvas) and the docked panel becomes a card (`group-has-[[data-ground]]/canvas` in `sheet.tsx`) — the page then puts its own sections in cards (`rounded-2xl border-subtle bg-surface shadow-card`); first used by banking (F134) |
| Pulse page title (D76) | `PageHeader` | no icon tile; the title 26 / 700, tight; `meta` = the page's situation in one line (counts, the one that needs the owner in bold amber); the actions wrap under the title below 18 rem |
| Pulse tables (D76) | `DataTable` | headers 10.5 / 500 uppercase, 0.1 em, muted; the sort and filter marks show on hover, focus or when set; cells 12 px sideways, 10 px high (two-line cells: a bold line and a mono secondary line); the filter bar's search and buttons as soft pills on `--surface-2`; `lead` puts a page's segments before the search |
| State chip (D76) | `StateLabel variant="chip"` | the Pulse pill for dense lists: a dot and the word on a 12 % tint of the family (neutral on `--tag`); the D40 icon + word stays for panels and pages |
| Row state on a list | `DataTable` `rowAccent` / `activeRowId` (D76) | `rowAccent(row)` → a state family: a 3 px bar on the row's left edge in `--state-done` / `--state-progress` / `--state-attention` (neutral = none; the CSS is `tr[data-accent]` in `globals.css`); `activeRowId` = the row open in the panel, `--selection` with a 4 px `--primary` bar, scrolled into view when it changes |
| Details panel | `components/ui/sheet.tsx` + `details-dock.tsx` | a right-side `SheetContent` inside the shell portals into the dock (380–400 px by default, `--border` left edge, no backdrop, non-modal, a row click does not close it; Escape and × do); outside the shell (tests) the old overlay. Open / hidden per table (F74) and width per table (F131): the DataTable registers its layout's `panelHidden` / `panelWidth` with the dock (`useDockedPanel`, the first table on the page); hidden = a rail with *Show* instead of the panel; *Hide* sits beside ×. The width: `SheetContent defaultWidth` (px or `"55%"`), the handle `role="separator"` (`details.resize`, `aria-valuenow` in px, ← / → `PANEL_RESIZE_STEP` = 40, double-click resets), `resolvePanelWidth(stored, default, canvasWidth)` / `clampPanelWidth` (pure, `details-dock.tsx`: 340 px … 75 % of the canvas the `DockedCanvas` measures with a `ResizeObserver`); a page without a registered table resizes for the session only. Sections: `kernel/ui/details-section.tsx` (`DetailsSection`, `DetailsGrid`) |
| States, tags, keys, counts | `kernel/ui/state-label.tsx`, `kernel/ui/tags.tsx` | `<StateLabel family state>` (`attention` · `progress` · `done` · `neutral`); `<Tag>`, `<CodeChip>`, `<CountBadge>`; `Badge` is a grey tag too |
| Banner, split primary | `kernel/ui/info-banner.tsx`, `kernel/ui/split-button.tsx` | |
| Row actions outside a DataTable | `kernel/ui/data-table/row-actions-menu.tsx` `RowActionsMenu` | the DataTable's ⋮ menu, exported (F71, contracts) for the few kit `Table`s that are not DataTables — an inline-edit grid, a handful of rows expanded in place; same `RowAction` shape; also an entity page's own ⋮ in its title row, labelled `shell.more` (*More actions* — partners F71) |
| Money on screen | `kernel/money/format-money.ts` `formatMoney(amount, currency, { signed, bare })` | the one format; `formatCurrency` stays the **printed** format (invoices FR-010, statements, per-diem sheets) |
| Searchable picker | `components/ui/combobox.tsx` (F125) | Base UI's `Combobox` styled like the Select: a trigger showing the value, a popup with a search on top, grouped options, `data-highlighted` / `data-disabled` items, popup at least 24 rem wide. The one domain picker on it today is `BasPicker` (`modules/settings/ui`, below); partners, groups and documents move to it as they are next touched (audit C3) |
| BAS picker | `modules/settings/components/bas-picker.tsx` `BasPicker` (F125) | every BAS field in the app: search on number (prefix), English, Swedish and short code (accents off, words in any order); groups **Suggested** (each with its source: *proposed for this row* · *from a rule* · *the supplier's default* · *used before for this supplier* · *AI proposal* — the last only when a model proposed it) → **Favourites** (only while nothing is typed) → the chart by class, the cost classes first where a cost is picked (`direction`); English name first, Swedish as the second line (F95); `requireAlias` shows an account without a short code disabled with the reason; `allowNone`, `fallbackLabel` (a code no longer active), `proposed` (drawn dashed). Options from settings' one builder `basPickerOptions` |
| Dialogs taller than the screen | `components/ui/dialog.tsx` | the content scrolls (`max-h: 100dvh − 2rem`), the footer sticks to its bottom — before F125 a dialog taller than a laptop screen hid its primary button off-screen |
| Kit primitives | `components/ui/*` | buttons 32 / 26 px, 8 px, the primary on `--action`; cards 20 px with `shadow-card`; popovers, menus, selects, dialogs, sheets on `shadow-pop`; underline tabs for `default` and `line`; inputs and selects on `--surface`, 13 px; tables 32 px rows with `--border-subtle` separators. `SelectValue` shows the item's label (collected from the `<SelectItem>` children, or `items`), else the placeholder, else nothing — never the raw value; items rendered by a child component need `items` |

## DataTable — Excel-style headers, server-side

Every list in the app is one component. v1's `advanced-table/` (checkbox, column, date-hierarchy and number-range filters, 1 870 lines) is the behaviour reference (H13); v2's `DataTable` + `table-preferences` is the code base to extend.

### Behaviour
- **Server-side** paging, sorting, filtering: the table never holds more than one page; filters become a typed `ListQuery` passed to the module's `queries.ts`.
- **Header filter per column, typed**:

  | column type | filter UI | query |
  |---|---|---|
  | enum / text with few values | checkbox list of **distinct values with counts**, search box, select all / clear | `in` |
  | free text | contains / starts with / equals / empty | `ilike` |
  | number / money | range (min–max), equals, empty; presets (> 0, < 0) | `between` |
  | date | **hierarchy tree year → month → day** with tri-state checkboxes, plus presets (this month, last month, quarter, year, custom range) | `between` sets |
  | boolean / status | checkbox list | `in` |
  | relation (partner, category) | checkbox list of distinct linked names, searchable | `in` ids |

- **Distinct values are computed server-side** on the already-filtered set (Excel semantics: filtering one column narrows the options of the others), capped at 500 with "search to narrow" beyond; `queries.ts` exposes `distinct(column, currentFilters)`.
- Active filters shown above the table — since D40 as **filter buttons** (`Column: value ▾`, opening that column's filter popover) in the filter bar, plus *Clear filters*; before D40 as removable chips.
- Filter + sort + page state lives in the **URL** (shareable, back-button safe); column visibility, order and width persist **per user per table** (`table_preferences`, v2 — built): the app layout loads the user's rows once and provides them (`TablePreferencesProvider` with `upsertTablePreferenceAction`); `useTableLayout(tableKey, columns)` starts from the server's copy, else the browser's (`localStorage` `af.table.<key>.layout`, the v1 `.hidden` key is read once), else the columns' defaults, and writes every change to storage at once and to the server debounced (600 ms). Order: drag a header onto another, or ↑ / ↓ in the *Columns* menu (the keyboard path); columns with no header (row actions) are pinned last. Width: the handle on a header's right edge (pointer drag, or ← / → by 8 px when focused; 48–1200 px); a column with a width truncates. *Reset layout* in the menu when anything differs from the defaults. Pure helpers in `layout.ts` (`orderColumns`, `moveColumn`, `dropColumn`, `normalizeLayout` — a stored layout is validated, unknown keys dropped, new columns appended).
- Row selection with bulk actions (link, categorise, export CSV of the current filter).
- Sticky header, virtualised body, loading skeleton, empty state with the active filters named.
- Footer: row count of the filtered set, sum of money columns on the filtered set (server-side).

### Contract (`src/kernel/list-query`)
```ts
type ListQuery = { page; pageSize; sort: { col; dir }[]; filters: Record<col, Filter>; search? }
type Filter =
  | { kind: "in"; values: (string | null)[] }                                  // enum, boolean, relation; null = blanks
  | { kind: "text"; op: contains | startsWith | equals | empty | notEmpty; value? }
  | { kind: "range"; min?; max?; empty? }                                       // number, money (decimal strings)
  | { kind: "dates"; years?; months?; days?; from?; to?; empty? }               // hierarchy ∪, intersected with from/to
queries.list(tx, q): { rows: Dto[]; total; sums? }
queries.distinct(tx, col, q): { value; count }[]          // over the set filtered by the OTHER columns
queries.dateHierarchy(tx, col, q): { years → months → days with counts; empty }
```
- `codec.ts` — URL ⇄ ListQuery (`?page=2&size=50&sort=name:asc&q=acme&f.types=in:client|vendor&f.date=dates:2026|from=2026-01-01`), tolerant of garbage.
- `prisma.ts` — `buildWhere(q, columns, { exceptColumn, base })`, `buildOrderBy`, `paginate`, `countDistinct`, `buildDateHierarchy`.
- `schema.ts` — Zod `listQuerySchema` for the actions that serve header filters.
- A module declares `COLUMNS: ColumnMap` (`{ type, field?, array?, searchable?, sum? }`) once in `queries.ts`; see [[partners]] for the reference implementation and its tests.

### The component (`src/kernel/ui/data-table`)
`<DataTable tableKey columns result state filterSource valueLabel rowHref|onRowClick selectable bulkActions toolbar emptyState />` with `state = useListQuery({ columns, defaultSort })`. Columns: `{ key, header, type, filterable?, sortable?, align?, width?, cell?, truncate?, defaultHidden?, alwaysVisible? }`. Header = sort button (shift-click adds a secondary key) + filter trigger (filled when active) → `TextFilter` / `RangeFilter` / `CheckboxFilter` / `DateFilter` popovers; the filter bar above (since F39: `Filter rows…`, a filter button per active filter or `quickFilter: true` column opening the same popover, *Clear filters*, `context` on the right); the last column holds the Columns menu in its header and each row's ⋮ menu (`rowActions: (row) => RowAction[]`); footer with count, sums (`formatMoney`), page size, pager; Columns menu (visibility, order and *Reset layout*, remembered per `tableKey` per user). Every string is a key: the frame's `table.*`, the popovers' `table.filter.*` (operators, presets, Min / Max, search, select all…), blanks `common.blanks`; month names come from `Intl` in the UI language (`monthName`). `describeFilter(filter, label, t)` takes the translator. Since F74 no English is left in the kit.

## i18n — UI strings

English is the key set: `src/kernel/i18n/dictionaries/en.ts` (`as const`). **Since D62 (2026-10-27) a change adds its strings to `en.ts` only**: `fr.ts` and `sv.ts` are `PartialDictionary` (`Partial<Record<MessageKey, string>>`) — a key they lack shows its English, key by key (`translate.ts`); a key they hold that `en.ts` no longer has is an orphan the test refuses; they are completed in one translation pass at the end, not PR by PR. The Swedish one follows BAS / Skatteverket terminology and the v1 printed-invoice strings in `specs/invoices/fixtures/invoice-strings.sv.json` (the printed invoice keeps its three languages — those strings are the client's, not the owner's); a new language is one file + one line in `translate.ts`, no code change. Keys are `<module>.<area>.<name>`; `{name}` placeholders are filled by the caller. Client components call `useT()`; server components either build a `translator(locale)` from the user's preferences or render `<Msg k="…" />` (`kernel/i18n/msg.tsx`, a client leaf that reads the LocaleProvider) for a heading. Since 2026-10-21 every module string is in the dictionary — the partners and contracts components, the settings hub and the section headings included; the settings forms (company, BAS categories, VAT registrations, bank accounts, my preferences) followed the same day. The document review page (header, footer, the sections, line items), the preview and the upload zone followed. The login / register pages and the error fallbacks followed on 2026-10-22 (F04): `app/(auth)/layout.tsx` has no user yet, so it resolves the language on the server from the browser's `Accept-Language` — the first tag by quality that has a dictionary (`uiLanguageFromAcceptLanguage` in `kernel/i18n/locale.ts`: `de-CH,fr;q=0.9` → fr) — and hands it to a `LocaleProvider`, so the server and client renders agree. Register errors are keys (`registerErrorKey`), never Better Auth's raw English message; the tenant made at registration is named in that language (`auth.register.orgName`). The breadcrumb names the nav items and the known sub-pages (`CRUMB_KEYS` in `topbar.tsx`); anything else shows its URL segment.

- Client components: `const t = useT(); t("contracts.rates.title")` — the language comes from `LocaleProvider` (user preference, else the browser), `fr-CH` → fr, anything without a dictionary → en.
- No preference = the browser's language, decided **on the server** from Accept-Language (F68): server pages build `translator(await requestLocale(prefs.locale))`, the shell passes `browserLocale()` to `LocaleProvider`, and a client component that formats or translates with the locale reads `useLocale().effectiveLocale` — `locale` is the raw preference (null = *Browser default*, what My Preferences shows). Never `prefs.locale ?? null` straight into `translator`: that is English on the server under a French client.
- Server components, PDFs, jobs: `translate(locale, key, params)` or `translator(locale)`.
- Services return English messages (logs, tests, API) and, when a client may want to re-render them, `AppError.details` with the facts (`{from, to}`, `{n}`); the component picks the key.
- A module adds its keys to **`en.ts`** in its PR (D62); `translate.pure.test.ts` fails on an orphan key, an empty string or a placeholder that differs from English — not on a missing translation. The dictionaries are no longer a lock between builders.
- Partners / documents / settings still carry English literals from v2 — migrate them when a page is next touched, not in bulk.
