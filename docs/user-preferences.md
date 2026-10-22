# User Preferences

Personal display preferences for authenticated users.

## Locale Preference

Each user can set a display locale that controls date and number formatting across the application.

### Supported Locales

| Locale  | Display Name      | Date Example     | Number Example |
|---------|-------------------|------------------|----------------|
| sv-SE   | Svenska           | 12 mars 2026     | 12 500         |
| en-US   | English US        | March 12, 2026   | 12,500         |
| en-GB   | English UK        | 12 March 2026    | 12,500         |
| fr-FR   | Français          | 12 mars 2026     | 12 500         |
| de-CH   | Deutsch CH        | 12. März 2026    | 12'500         |

### Fallback Chain

1. User's stored preference (if set)
2. Browser locale (if preference is null)
3. `sv-SE` (ultimate fallback)

### Architecture

The locale is **not** used for currency formatting. Currency formatting follows the **currency's convention**, not the user's locale. See [[decimal-currency]].

**Server/client flow:**
1. `layout.tsx` fetches locale via direct Prisma query (NO `withTenantTransaction` — user-scoped, no RLS)
2. Passes to `LocaleProvider` React context
3. Client components use `useLocale()` hook
4. Server components accept `locale` as explicit prop

### Format Utilities

- `formatDate(date, locale?)` — Long date format (`Intl.DateTimeFormat`, dateStyle: "long")
- `formatNumber(value, locale?, options?)` — Non-monetary numbers (`Intl.NumberFormat`)
- `resolveLocale(locale?)` — Validates locale support, falls back to sv-SE

**Critical:** `formatNumber()` is for non-monetary values only. Currency amounts MUST use `formatCurrency()` from [[decimal-currency|format-currency.ts]].

## Colour Scheme (D43)

*System* (the default, `theme = null`), *Light* or *Dark* — My Preferences, under the locale.

```
choose Dark ──► applyTheme(): <html data-theme="dark"> + cookie af-theme=dark ──► updateUserThemeAction → user_preferences.theme
next request ──► app/layout.tsx reads the cookie ──► <html data-theme="dark"> in the first HTML (no flash)
new browser  ──► no cookie: OS colours first ──► (app)/layout.tsx passes the stored theme to ThemeSync ──► applied + cookie set
```

- `kernel/ui/theme.ts`: `THEMES`, `parseTheme` (anything but light / dark = system), `applyTheme` (attribute + cookie, a year).
- The service `updateUserTheme` upserts like the locale; neither ever clears the other.
- CSS: `globals.css` — the `dark:` variant and the dark tokens hold under an OS dark unless `data-theme="light"`, and under `data-theme="dark"` (two token blocks, kept equal by `theme.pure.test.ts`).

## Data Model

- **Model:** `UserPreference` in `app.prisma` — user-scoped (NOT tenant-scoped), NO RLS
- **Unique key:** `userId` — one preference row per user
- **Columns:** `locale` (null = browser), `theme` (`theme_preference` enum light / dark, null = system)
- **Upsert semantics:** the first change (locale or theme) creates the row; later changes update only their column. Pass `null` to reset to the browser / system default

## Anti-Patterns

- Do NOT add RLS to `user_preferences` — it's user-scoped, not tenant-scoped
- Do NOT use `withTenantTransaction` to query `UserPreference` — use direct Prisma query
- Do NOT define a Prisma `@relation` on `UserPreference.userId` — cross-schema FK, application-level enforcement
- Do NOT use `formatNumber()` for currency amounts

## Related

- [[decimal-currency]] — Currency formatting (currency-driven, not locale-driven)
- [[numbering]] — fixed key functions and number_series (tenant-scoped counters, no settings)
- [[dashboard]] — First page to use locale for date display
