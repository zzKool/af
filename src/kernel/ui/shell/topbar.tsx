"use client";

// Topbar of the app shell (D19): breadcrumb from the route, tenant, user. Dense, one row.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { NAV_ITEMS } from "@/kernel/nav/constants";

/** Sub-pages the breadcrumb names (the nav items name the top level); anything else shows its URL segment. */
const CRUMB_KEYS: Record<string, MessageKey> = {
  "/settings/company": "settings.company.title",
  "/settings/bas-categories": "settings.bas.title",
  "/settings/vat-registrations": "settings.vat.title",
  "/settings/bank-accounts": "settings.bankAccounts.title",
  "/settings/traktamente": "settings.traktamente.title",
  "/settings/rates": "settings.rates.title",
  "/settings/my-preferences": "settings.preferences.title",
  "/banking/imports": "banking.nav.imports",
  "/banking/rules": "banking.nav.rules",
  "/banking/inbox": "banking.nav.inbox",
  "/documents/inbox": "documents.inbox.title",
  "/expenses/groups": "expenses.nav.groups",
  "/expenses/settle": "expenses.nav.settle",
  "/expenses/settlements": "expenses.nav.settlements",
  "/links": "linking.graph.title",
};

export function Topbar({ tenantName, userLabel }: { tenantName: string; userLabel: string }) {
  const pathname = usePathname();
  const t = useT();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => {
    const href = `/${segments.slice(0, i + 1).join("/")}`;
    const nav = NAV_ITEMS.find((n) => n.path === href);
    const key = nav?.labelKey ?? CRUMB_KEYS[href];
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg);
    const label = key ? t(key) : isId ? seg.slice(0, 8) : seg.replace(/-/g, " ");
    return { href, label, last: i === segments.length - 1 };
  });
  return (
    <header className="flex h-10 shrink-0 items-center gap-3 border-b bg-background px-4 text-sm">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1 text-muted-foreground"
      >
        {crumbs.map((c) => (
          <span key={c.href} className="flex items-center gap-1">
            {c.last ? (
              <span className="truncate font-medium capitalize text-foreground">{c.label}</span>
            ) : (
              <Link href={c.href} className="truncate capitalize hover:text-foreground">
                {c.label}
              </Link>
            )}
            {!c.last && <span className="text-muted-foreground/50">/</span>}
          </span>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
        <span className="truncate">{tenantName}</span>
        <span className="text-muted-foreground/50">·</span>
        <span className="truncate">{userLabel}</span>
      </div>
    </header>
  );
}
