// The shell's knowledge of the app's pages (pure, client-safe): the breadcrumb trail of a path and the
// destinations the top-bar search offers. Names come from i18n keys — never an id in the trail (D40).
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { MessageKey } from "@/kernel/i18n/translate";
import { NAV_ITEMS, type NavItem } from "@/kernel/nav/constants";
import { filterNavItems } from "@/kernel/nav/nav-filter";

/** Sub-pages with a name of their own (the nav items name the top level). Every entry is a real page. */
export const SUB_PAGES: Record<string, MessageKey> = {
  "/settings/company": "settings.company.title",
  "/settings/bas-categories": "settings.bas.title",
  "/settings/vat-registrations": "settings.vat.title",
  "/settings/bank-accounts": "settings.bankAccounts.title",
  "/settings/traktamente": "settings.traktamente.title",
  "/settings/rates": "settings.rates.title",
  "/settings/ai": "settings.ai.title",
  "/settings/my-preferences": "settings.preferences.title",
  "/banking/imports": "banking.nav.imports",
  "/banking/rules": "banking.nav.rules",
  "/banking/inbox": "banking.nav.inbox",
  "/documents/inbox": "documents.inbox.title",
  "/expenses/groups": "expenses.nav.groups",
  "/expenses/settle": "expenses.nav.settle",
  "/expenses/settlements": "expenses.nav.settlements",
};

export type Crumb = { href: string; key: MessageKey };

/** The nav item a path belongs to (`/expenses/groups/…` → Expenses). */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((n) => pathname === n.path || pathname.startsWith(`${n.path}/`));
}

/**
 * The breadcrumb of a path: its **ancestors** that are named pages, the current page not repeated (its title
 * says it). Segments without a name — ids, `new`, a route group like `/links/document` — are skipped, so the
 * trail never shows an id: `/partners/353ec92f-…` → `Partners`.
 */
export function crumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const trail: Crumb[] = [];
  for (let i = 0; i < segments.length - 1; i++) {
    const href = `/${segments.slice(0, i + 1).join("/")}`;
    const key = NAV_ITEMS.find((n) => n.path === href && n.enabled)?.labelKey ?? SUB_PAGES[href];
    if (key) trail.push({ href, key });
  }
  return trail;
}

export type Destination = { href: string; key: MessageKey; parent?: MessageKey; icon: string };

/** What the top-bar search finds: the role's nav pages, then their named sub-pages. */
export function destinationsFor(role: CallerIdentity["role"]): Destination[] {
  const items = filterNavItems(NAV_ITEMS, role);
  const top: Destination[] = items.map((n) => ({ href: n.path, key: n.labelKey, icon: n.icon }));
  const subs: Destination[] = Object.entries(SUB_PAGES).flatMap(([href, key]) => {
    const parent = items.find((n) => href.startsWith(`${n.path}/`));
    return parent ? [{ href, key, parent: parent.labelKey, icon: parent.icon }] : [];
  });
  return [...top, ...subs];
}

/** Case- and accent-insensitive "every word appears" match of a query against a label. */
export function matches(query: string, ...labels: string[]): boolean {
  const fold = (s: string) =>
    s
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  const hay = fold(labels.join(" "));
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}
