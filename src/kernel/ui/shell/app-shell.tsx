"use client";

// The app shell (D40 "Lakehouse"):
//   ┌ top bar 44 px (app bg) ─────────────────────────────────────────────┐
//   ├ sidebar (app bg) ┬ canvas (surface, border top+left, 10 px corner) ─┤
//   │                  │ breadcrumb · page (main, the scroll container) │ details dock │
// The page content is server-rendered children; the shell only arranges it.
import type { ReactNode } from "react";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { Breadcrumb } from "@/kernel/ui/shell/breadcrumb";
import { DockedCanvas } from "@/kernel/ui/shell/details-dock";
import { ShellProvider } from "@/kernel/ui/shell/shell-context";
import { type NavCounts, Sidebar } from "@/kernel/ui/shell/sidebar";
import { Topbar } from "@/kernel/ui/shell/topbar";

export function AppShell({
  role,
  tenants,
  userLabel,
  counts,
  children,
}: {
  role: CallerIdentity["role"];
  tenants: { id: string; name: string }[];
  userLabel: string;
  /** F72: open work per nav path, loaded by the app layout */
  counts?: NavCounts;
  children: ReactNode;
}) {
  return (
    <ShellProvider>
      <div className="flex h-screen flex-col bg-app">
        <Topbar role={role} tenants={tenants} userLabel={userLabel} />
        <div className="flex min-h-0 flex-1">
          <Sidebar role={role} counts={counts} />
          <div className="flex min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l bg-surface">
            <DockedCanvas>
              {/* main is the intentional scroll container — sticky table headers depend on it */}
              <main className="min-h-0 min-w-0 flex-1 overflow-auto">
                <Breadcrumb />
                {children}
              </main>
            </DockedCanvas>
          </div>
        </div>
      </div>
    </ShellProvider>
  );
}
