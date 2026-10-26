"use client";

// The top bar (D40), 44 px on the app background: sidebar toggle · logo · search (Ctrl K, F93) · tenant · avatar.
// The breadcrumb lives in the canvas (breadcrumb.tsx).
import { LogOut, PanelLeft, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/kernel/auth/auth-client";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { useT } from "@/kernel/i18n/use-t";
import type { RunSearch } from "@/kernel/search/types";
import { SearchPalette } from "@/kernel/ui/shell/search-palette";
import { useShell } from "@/kernel/ui/shell/shell-context";
import { TenantSwitcher } from "@/kernel/ui/shell/tenant-switcher";

export function Topbar({
  role,
  tenants,
  userLabel,
  search,
}: {
  role: CallerIdentity["role"];
  tenants: { id: string; name: string }[];
  userLabel: string;
  /** F93: the global search, composed by the app layout */
  search?: RunSearch;
}) {
  const t = useT();
  const { collapsed, toggle } = useShell();
  return (
    <header className="flex h-11 shrink-0 items-center gap-2 bg-app pr-3 pl-3">
      <button
        type="button"
        onClick={toggle}
        className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-hover hover:text-foreground"
        aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
        aria-expanded={!collapsed}
      >
        <PanelLeft className="size-4" />
      </button>
      <Link href="/dashboard" className="flex h-8 items-center px-1" aria-label="AF — Dashboard">
        {/* the logo swaps file in dark mode, never colour (D40); by the `dark:` variant, so a theme picked in
            My Preferences (D43) swaps it too — a <picture> media query would only follow the OS */}
        {/* biome-ignore lint/performance/noImgElement: a static SVG in public/, nothing for next/image to optimise */}
        <img
          src="/brand/af-logo.svg"
          alt="AF"
          height={24}
          width={109}
          className="h-6 w-auto dark:hidden"
        />
        {/* biome-ignore lint/performance/noImgElement: as above */}
        <img
          src="/brand/af-logo-dark.svg"
          alt="AF"
          height={24}
          width={109}
          className="hidden h-6 w-auto dark:block"
        />
      </Link>
      <div className="flex flex-1 justify-center px-4">
        <SearchPalette role={role} search={search} />
      </div>
      <TenantSwitcher tenants={tenants} />
      <UserMenu userLabel={userLabel} />
    </header>
  );
}

// --- the avatar: who is signed in, my preferences, log out ---

function initials(label: string): string {
  const words = label.split(/[\s@.]+/).filter(Boolean);
  return (
    words
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}

function UserMenu({ userLabel }: { userLabel: string }) {
  const t = useT();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="ml-1 flex size-7 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {/* named by the hidden text, the initials are decoration (axe 4.14 label-content-name-mismatch) */}
        <span className="sr-only">{`${t("shell.account")}: ${userLabel}`}</span>
        <span aria-hidden>{initials(userLabel)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Base UI: a menu label is a group label — outside a Menu.Group it throws when the menu opens */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{userLabel}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/settings/my-preferences" />}>
          <SlidersHorizontal aria-hidden />
          {t("settings.preferences.title")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() =>
            authClient.signOut({
              fetchOptions: { onSuccess: () => window.location.assign("/login") },
            })
          }
        >
          <LogOut aria-hidden />
          {t("nav.logout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
