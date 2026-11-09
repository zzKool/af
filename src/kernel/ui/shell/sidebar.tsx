"use client";

// The rail (D76): + New · Dashboard · Work · the groups of the monthly loop · Settings and the open / close
// button at the bottom. Navy in light, the dark ground in dark. 232 px with labels, group names and counts;
// 68 px of icons when collapsed (remembered in this browser). Hidden by role here, enforced by the server.
// `counts` (F72): open work per nav path — an amber number right of the label, on the icon's corner when
// collapsed. The link's accessible name stays the label (e2e and screen readers find "Banking"); the number
// is aria-hidden, the collapsed tooltip carries it.
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
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
import { cn } from "@/lib/utils";

/** open work per nav path (`/banking` → rows to justify, …); absent or 0 = no badge */
export type NavCounts = Partial<Record<string, number>>;

/** one rail button: 42 px square collapsed, 38 px high with its label open */
const railItem = (collapsed: boolean) =>
  cn(
    "relative flex shrink-0 items-center rounded-xl text-[13.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
    collapsed ? "size-[42px] justify-center" : "h-[38px] gap-3 px-3",
  );

export function Sidebar({
  role,
  counts = {},
}: {
  role: CallerIdentity["role"];
  counts?: NavCounts;
}) {
  const t = useT();
  const pathname = usePathname();
  const { collapsed, toggle } = useShell();
  const items = filterNavItems(NAV_ITEMS, role);
  const newItems = NEW_ITEMS.filter((n) => n.roles.includes(role));

  const top = items.filter((i) => !i.group && !i.bottom);
  const bottom = items.filter((i) => i.bottom);
  const groups = NAV_GROUPS.map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter(
    (x) => x.items.length > 0,
  );

  const link = (item: NavItem) => {
    // the longest matching path wins: /banking/inbox is Banking › Inbox, /expenses/groups is Expenses
    const matches = (p: string) => pathname === p || pathname.startsWith(`${p}/`);
    const active =
      matches(item.path) &&
      !items.some(
        (o) => o.path !== item.path && o.path.startsWith(`${item.path}/`) && matches(o.path),
      );
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
          railItem(collapsed),
          active
            ? "bg-rail-active font-semibold text-rail-fg-active dark:ring-1 dark:ring-border dark:ring-inset"
            : "text-rail-fg hover:bg-rail-hover hover:text-rail-fg-active",
        )}
      >
        {Icon && <Icon className="size-5 shrink-0" aria-hidden />}
        {/* the name comes from this text, not an aria-label (axe 4.14 label-content-name-mismatch); the
            count stays out of it (aria-hidden) so the link is named exactly its label */}
        <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
        {count > 0 && (
          <span
            className={cn(
              "inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rail-badge px-1 text-[10px] font-bold text-rail-badge-fg tabular-nums",
              collapsed ? "absolute top-0.5 right-0.5" : "ml-auto",
            )}
            aria-hidden
            data-public
          >
            {count}
          </span>
        )}
      </Link>
    );
  };

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-rail py-4 transition-[width] duration-150",
        collapsed ? "w-[68px] items-center" : "w-[232px] px-3",
      )}
    >
      {newItems.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            className={cn(
              railItem(collapsed),
              "mb-3 bg-brand font-semibold text-brand-fg hover:brightness-110",
            )}
            aria-label={t("nav.new")}
          >
            <Plus className="size-5" aria-hidden />
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
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto",
          collapsed && "items-center",
        )}
        aria-label="Main navigation"
      >
        {top.map(link)}
        {groups.map(({ g, items: groupItems }) => (
          <div key={g} className={cn("flex flex-col gap-0.5", collapsed && "items-center")}>
            {collapsed ? (
              <div className="my-2 h-px w-6 bg-rail-hover" aria-hidden />
            ) : (
              <div className="px-3 pt-3 pb-0.5 text-[10.5px] font-medium tracking-[0.12em] text-rail-group uppercase">
                {t(`nav.group.${g}`)}
              </div>
            )}
            {groupItems.map(link)}
          </div>
        ))}
        <div className={cn("mt-auto flex flex-col gap-0.5 pt-2", collapsed && "items-center")}>
          {bottom.map(link)}
          <button
            type="button"
            onClick={toggle}
            aria-expanded={!collapsed}
            title={collapsed ? t("nav.expand") : undefined}
            className={cn(
              railItem(collapsed),
              "text-rail-fg hover:bg-rail-hover hover:text-rail-fg-active",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5 shrink-0" aria-hidden />
            ) : (
              <PanelLeftClose className="size-5 shrink-0" aria-hidden />
            )}
            <span className={collapsed ? "sr-only" : "truncate"}>
              {collapsed ? t("nav.expand") : t("nav.collapse")}
            </span>
          </button>
        </div>
      </nav>
    </aside>
  );
}
