"use client";

// The sidebar (D40): + New · Dashboard · the groups of the monthly loop · Settings pinned to the bottom.
// 190 px, collapses to 56 px icons from the top bar's toggle. Hidden by role here, enforced by the server.
// `counts` (F72): open work per nav path, loaded with the app layout — a <CountBadge> right of the label when > 0
// (a dot when collapsed). The link's accessible name stays the label (e2e and screen readers find "Banking").
import { Plus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { useT } from "@/kernel/i18n/use-t";
import { NAV_GROUPS, NAV_ITEMS, type NavItem, NEW_ITEMS } from "@/kernel/nav/constants";
import { filterNavItems } from "@/kernel/nav/nav-filter";
import { SHELL_ICONS } from "@/kernel/ui/shell/icons";
import { useShell } from "@/kernel/ui/shell/shell-context";
import { CountBadge } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";

/** open work per nav path (`/banking` → rows to justify, …); absent or 0 = no badge */
export type NavCounts = Partial<Record<string, number>>;

export function Sidebar({
  role,
  counts = {},
}: {
  role: CallerIdentity["role"];
  counts?: NavCounts;
}) {
  const t = useT();
  const pathname = usePathname();
  const { collapsed } = useShell();
  const items = filterNavItems(NAV_ITEMS, role);
  const newItems = NEW_ITEMS.filter((n) => n.roles.includes(role));

  const top = items.filter((i) => !i.group && !i.bottom);
  const bottom = items.filter((i) => i.bottom);
  const groups = NAV_GROUPS.map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter(
    (x) => x.items.length > 0,
  );

  const link = (item: NavItem) => {
    const active = pathname === item.path || pathname.startsWith(`${item.path}/`);
    const Icon = SHELL_ICONS[item.icon];
    const label = t(item.labelKey);
    const count = counts[item.path] ?? 0;
    return (
      <Link
        key={item.path}
        href={item.path}
        title={collapsed ? (count > 0 ? `${label} (${count})` : label) : undefined}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors",
          active
            ? "bg-nav-active font-semibold text-primary-hover"
            : "text-foreground hover:bg-hover",
          collapsed && "relative justify-center px-0",
        )}
      >
        {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
        {/* the name comes from this text, not an aria-label (axe 4.14 label-content-name-mismatch); the
            count stays out of it (aria-hidden) so the link is named exactly its label */}
        <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
        {count > 0 &&
          (collapsed ? (
            <span
              className="absolute top-1 right-1.5 size-1.5 rounded-full bg-muted-foreground"
              aria-hidden
            />
          ) : (
            <span className="ml-auto" aria-hidden>
              <CountBadge count={count} />
            </span>
          ))}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-app transition-[width] duration-150",
        collapsed ? "w-14 px-2" : "w-[190px] px-2.5",
      )}
    >
      {newItems.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              "mt-1 mb-3 flex h-8 items-center gap-2 rounded-md bg-brand-tint px-2.5 text-[13px] font-semibold text-brand outline-none hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
              collapsed ? "w-9 justify-center px-0" : "w-fit pr-3.5",
            )}
            aria-label={t("nav.new")}
          >
            <Plus className="size-4" aria-hidden />
            {!collapsed && t("nav.new")}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            {newItems.map((n) => {
              const Icon = SHELL_ICONS[n.icon];
              return (
                <DropdownMenuItem key={n.labelKey} render={<Link href={n.href} />}>
                  {Icon && <Icon aria-hidden />}
                  {t(n.labelKey)}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* the aria-label stays English: the e2e (and screen-reader landmarks) name it "Main navigation" */}
      <nav
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto"
        aria-label="Main navigation"
      >
        {top.map(link)}
        {groups.map(({ g, items: groupItems }) => (
          <div key={g} className="mt-3 flex flex-col gap-0.5">
            {collapsed ? (
              <div className="mx-2 mb-1 border-t border-subtle" aria-hidden />
            ) : (
              <div className="px-2.5 pb-1 text-xs text-muted-foreground">{t(`nav.group.${g}`)}</div>
            )}
            {groupItems.map(link)}
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-0.5 border-t border-subtle pt-2 pb-2">
          {bottom.map(link)}
        </div>
      </nav>
    </aside>
  );
}
