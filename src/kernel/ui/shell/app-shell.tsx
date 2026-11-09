"use client";

// The app shell (D76 "Pulse"):
//   ┌ rail ┬ top bar 56 px (dotted ground): logo · search · tenant · sun/moon · avatar ──────┐
//   │ 232 /├ canvas — one raised card (surface, 20 px corners, card shadow), 12 px from the edges ┤
//   │ 68px │ breadcrumb · page (main, the scroll container) │ details dock │
//   └──────┴──────────────────────────────────────────────────────────────────────────────┘
// The page content is server-rendered children; the shell only arranges it. Pages move from the one
// canvas card to their own cards on the ground screen by screen (docs/roadmap.md, the Pulse phases): a page that
// renders `data-ground` (ListPage's `ground`) turns the canvas card off, and the docked panel becomes a card.
import type { ReactNode } from "react";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { RunSearch } from "@/kernel/search/types";
import { Breadcrumb } from "@/kernel/ui/shell/breadcrumb";
import { DockedCanvas } from "@/kernel/ui/shell/details-dock";
import { ShellProvider } from "@/kernel/ui/shell/shell-context";
import { type NavCounts, Sidebar } from "@/kernel/ui/shell/sidebar";
import type { SaveTheme } from "@/kernel/ui/shell/theme-toggle";
import { Topbar } from "@/kernel/ui/shell/topbar";

export function AppShell({
  role,
  tenants,
  userLabel,
  counts,
  search,
  saveTheme,
  children,
}: {
  role: CallerIdentity["role"];
  tenants: { id: string; name: string }[];
  userLabel: string;
  /** F72: open work per nav path, loaded by the app layout */
  counts?: NavCounts;
  /** F93: the global search action, composed by the app layout (the kernel knows no module) */
  search?: RunSearch;
  /** D43 / D76: the top bar's sun / moon saves through the settings module, composed by the app layout */
  saveTheme?: SaveTheme;
  children: ReactNode;
}) {
  return (
    <ShellProvider>
      <div className="flex h-screen">
        <Sidebar role={role} counts={counts} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            role={role}
            tenants={tenants}
            userLabel={userLabel}
            search={search}
            saveTheme={saveTheme}
          />
          {/* a page on the ground (`ListPage ground`, D76) turns the card off: its own cards sit on the dots */}
          <div className="group/canvas mx-3 mb-3 flex min-h-0 flex-1 overflow-hidden pulse-card has-[[data-ground]]:overflow-visible has-[[data-ground]]:border-transparent has-[[data-ground]]:bg-transparent has-[[data-ground]]:bg-none has-[[data-ground]]:shadow-none">
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
