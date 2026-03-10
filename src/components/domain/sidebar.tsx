"use client";

import {
  ArrowLeftRight,
  BookOpen,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  PanelLeft,
  PanelLeftClose,
  Receipt,
  Settings,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { CallerIdentity } from "@/types/caller-identity";
import { TenantSwitcher } from "./tenant-switcher";

const STORAGE_KEY = "sidebar-collapsed";

type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
  roles: CallerIdentity["role"][];
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["owner", "accountant"] },
  { label: "Documents", href: "/documents", icon: FileText, roles: ["owner", "accountant"] },
  { label: "Journal", href: "/journal", icon: BookOpen, roles: ["owner", "accountant"] },
  { label: "Banking", href: "/banking", icon: Landmark, roles: ["owner"] },
  { label: "Partners", href: "/partners", icon: Users, roles: ["owner"] },
  { label: "Reconciliation", href: "/reconciliation", icon: ArrowLeftRight, roles: ["owner"] },
  { label: "Invoices", href: "/invoices", icon: Receipt, roles: ["owner"] },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["owner"] },
];

export function Sidebar({ role }: { role: CallerIdentity["role"] }) {
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

  const filteredItems = navItems.filter((item) => item.roles.includes(role));

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r bg-background transition-[width] duration-200",
        collapsed ? "w-14" : "w-60",
      )}
    >
      {/* Tenant Switcher */}
      {!collapsed && <TenantSwitcher onSwitching={setSwitching} />}

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
          const isActive = pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
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
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
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
          {!collapsed && <span>Log out</span>}
        </button>
      </div>
    </aside>
  );
}
