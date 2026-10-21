"use client";

import {
  Archive,
  ArrowLeftRight,
  BookOpen,
  FileSpreadsheet,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Receipt,
  ReceiptText,
  Settings,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/kernel/auth/auth-client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { useT } from "@/kernel/i18n/use-t";
import { NAV_ITEMS } from "@/kernel/nav/constants";
import { filterNavItems } from "@/kernel/nav/nav-filter";
import { TenantSwitcher } from "@/kernel/ui/shell/tenant-switcher";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "sidebar-collapsed";

/** Map icon name strings from NAV_ITEMS to actual lucide-react components */
const ICON_MAP: Record<string, React.ElementType> = {
  LayoutDashboard,
  FileText,
  BookOpen,
  Landmark,
  Users,
  ArrowLeftRight,
  Receipt,
  Wallet,
  ReceiptText,
  Archive,
  FileSpreadsheet,
  Settings,
};

export function Sidebar({
  role,
  tenants,
}: {
  role: CallerIdentity["role"];
  tenants: { id: string; name: string }[];
}) {
  const t = useT();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  const filteredItems = filterNavItems(NAV_ITEMS, role);

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r bg-background transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
      )}
    >
      {/* Tenant Switcher */}
      {!collapsed && <TenantSwitcher tenants={tenants} onSwitching={setSwitching} />}

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={toggleCollapse}
        className="flex h-10 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
      </button>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-2 py-2" aria-label="Main navigation">
        {filteredItems.map((item) => {
          const isActive = pathname.startsWith(item.path);
          const Icon = ICON_MAP[item.icon];
          return (
            <Link
              key={item.path}
              href={item.path}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-accent/10 font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/5 hover:text-foreground",
                switching && "pointer-events-none opacity-50",
              )}
              aria-current={isActive ? "page" : undefined}
              tabIndex={switching ? -1 : undefined}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              {!collapsed && <span className="truncate">{t(item.labelKey)}</span>}
            </Link>
          );
        })}
      </nav>

      {/* User menu */}
      <div className="border-t p-2">
        <button
          type="button"
          onClick={() =>
            authClient.signOut({
              fetchOptions: { onSuccess: () => window.location.assign("/login") },
            })
          }
          className={cn(
            "flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent/5 hover:text-foreground",
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>{t("nav.logout")}</span>}
        </button>
      </div>
    </aside>
  );
}
