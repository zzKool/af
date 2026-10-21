"use client";

// Topbar of the app shell (D19): breadcrumb from the route, tenant, user. Dense, one row.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/kernel/i18n/use-t";
import { NAV_ITEMS } from "@/kernel/nav/constants";

export function Topbar({ tenantName, userLabel }: { tenantName: string; userLabel: string }) {
  const pathname = usePathname();
  const t = useT();
  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => {
    const href = `/${segments.slice(0, i + 1).join("/")}`;
    const nav = NAV_ITEMS.find((n) => n.path === href);
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg);
    const label = nav ? t(nav.labelKey) : isId ? seg.slice(0, 8) : seg.replace(/-/g, " ");
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
