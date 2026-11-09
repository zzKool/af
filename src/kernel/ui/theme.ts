// The colour scheme (D43): the user's choice in My Preferences — light, dark, or null = follow the system.
// The choice lives in `user_preferences.theme`; a cookie mirrors it so the root layout can put
// `data-theme` on <html> in the first HTML (no flash, no session lookup there). globals.css reads the attribute:
//   no attribute → `prefers-color-scheme` decides · data-theme="light" / "dark" → forced.

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = "af-theme";

/** A stored or cookie value as a theme; anything else is null (= follow the system). */
export function parseTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** In the browser: show the theme now and remember it in the cookie the root layout reads. */
export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement;
  if (theme) root.dataset.theme = theme;
  else delete root.dataset.theme;
  // a year, the whole app; null clears it
  document.cookie = theme
    ? `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`
    : `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

// The screenshot veil (F150, the owner 2026-11-09): an eye in the top bar blurs the figures — amounts, balances,
// rates, keys — so a screenshot shows the page and not the books. Per browser (a cookie the root layout reads, so
// the first HTML is already veiled); a PDF renders without it (the print renderer has no such cookie).
export const PRIVACY_COOKIE = "af-privacy";

export function parsePrivacy(value: string | null | undefined): boolean {
  return value === "on";
}

/** In the browser: veil or unveil now and remember it for this browser. */
export function applyPrivacy(on: boolean): void {
  const root = document.documentElement;
  if (on) root.dataset.privacy = "on";
  else delete root.dataset.privacy;
  document.cookie = on
    ? `${PRIVACY_COOKIE}=on; path=/; max-age=31536000; samesite=lax`
    : `${PRIVACY_COOKIE}=; path=/; max-age=0; samesite=lax`;
}
