# Entity View Pattern — Tabbed Detail Pages

Introduced in Story 4.3 (Partner Entity View). This is the first usage of `TabsContent` panels in the codebase.

## When to Use

### In-Page Panel Tabs (this pattern)

Use when:

- All data is fetched in a single server transaction (`withTenantTransaction` + `Promise.all`)
- Dataset is small (a few related records per entity)
- Tab switching should be instant with no loading states

Examples: Partner detail page (overview, contracts, transactions, documents)

### URL-Routing Tabs (settings pattern)

Use when:

- Each tab has independent data requirements
- Datasets are large and benefit from lazy loading
- Deep-linking to a specific tab is important

Examples: Settings page (`/settings/vat`, `/settings/bank-accounts`)

See [[vat-registrations]], [[bank-accounts]] for the URL-routing tab pattern.

## Architecture

```
page.tsx (server) → withTenantTransaction → serialize all data
  ↓
<EntityDetailTabs
  entity={serialized entity}
  relatedData={serialized related data}
/>
```

### Component Structure

```
src/app/(app)/partners/[id]/page.tsx     → Server component (data fetching, auth, RLS)
src/components/partners/partner-detail-tabs.tsx → Client component (header + tabs + content)
src/components/partners/partner-form.tsx  → Reused in Overview tab with hideHeader={true}
src/components/partners/contract-list.tsx → Reused in Contracts tab unchanged
```

### Persistent Header

The entity's identity (name, status badge, back link, action buttons) renders ABOVE the tabs so it remains visible regardless of which tab is active.

```
← Partners
[Partner Name]  [Active]  [Deactivate ▾]

[Overview] [Contracts (3)] [Transactions] [Documents]
─────────────────────────────────────────────────────
  (tab content below)
```

The header component manages its own action hooks (`deactivatePartnerAction`, `reactivatePartnerAction`) independently — same self-contained pattern as [[contract-pattern]].

### Tab Component (base-ui)

Uses `@base-ui/react/tabs` via `@/components/ui/tabs`:

```tsx
<Tabs defaultValue="overview">
  <TabsList variant="line">
    <TabsTrigger value="overview">Overview</TabsTrigger>
    <TabsTrigger value="contracts">Contracts ({count})</TabsTrigger>
  </TabsList>
  <TabsContent value="overview">...</TabsContent>
  <TabsContent value="contracts">...</TabsContent>
</Tabs>
```

Key behaviors:

- `variant="line"` for page-level navigation feel
- All `TabsContent` panels mount simultaneously (hidden via CSS, not unmounted)
- Do NOT use `keepMounted={false}` — it destroys inline form state on tab switches
- Tab state is uncontrolled (`defaultValue`, no `useState`) — React reconciliation preserves state across `router.refresh()`
- Active tab uses `data-active` attribute (not Radix-style `data-[state=active]`)

## Empty State Stubs

For future features (transactions, documents), use empty state cards with forward-looking context:

```tsx
<Card>
  <CardContent className="py-8">
    <p className="text-muted-foreground">
      No transactions linked to this partner yet. Transactions will appear here
      automatically when bank statement imports are processed.
    </p>
  </CardContent>
</Card>
```

Per UX spec: always communicate WHY it's empty and WHAT will change. See [[partner-crud-pattern]] for the domain entity CRUD pattern.

## Known Scaling Limitation

The upfront data fetch pattern works for current small datasets. When Epics 5 and 6 add potentially dozens of documents and transactions per partner, this pattern should be revisited — consider lazy-loading tab content on first tab activation.

## Cross-References

- [[partner-crud-pattern]] — Domain entity CRUD pattern
- [[contract-pattern]] — Child entity pattern, Decimal pipeline
- [[dashboard]] — BusinessPulseWidget metrics API
- [[vat-registrations]] — URL-routing tabs (alternative pattern)
