"use client";

// The top bar (D40), 44 px on the app background: sidebar toggle · logo · search (Ctrl P) · tenant · avatar.
// The breadcrumb lives in the canvas (breadcrumb.tsx).
import { LogOut, PanelLeft, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
import { SHELL_ICONS } from "@/kernel/ui/shell/icons";
import { destinationsFor, matches } from "@/kernel/ui/shell/routes";
import { useShell } from "@/kernel/ui/shell/shell-context";
import { TenantSwitcher } from "@/kernel/ui/shell/tenant-switcher";
import { cn } from "@/lib/utils";

export function Topbar({
  role,
  tenants,
  userLabel,
}: {
  role: CallerIdentity["role"];
  tenants: { id: string; name: string }[];
  userLabel: string;
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
        <PageSearch role={role} />
      </div>
      <TenantSwitcher tenants={tenants} />
      <UserMenu userLabel={userLabel} />
    </header>
  );
}

// --- search: the pages of the app, by name, in the user's language; Ctrl P (⌘ P) focuses it ---

function PageSearch({ role }: { role: CallerIdentity["role"] }) {
  const t = useT();
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const all = useMemo(() => destinationsFor(role), [role]);
  const results = useMemo(
    () =>
      (query.trim()
        ? all.filter((d) => matches(query, t(d.key), d.parent ? t(d.parent) : ""))
        : all.filter((d) => !d.parent)
      ).slice(0, 8),
    [all, query, t],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "p") {
        e.preventDefault(); // not the browser's print dialog
        input.current?.focus();
        input.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(href: string) {
    setOpen(false);
    setQuery("");
    input.current?.blur();
    router.push(href);
  }

  return (
    <div className="relative w-full max-w-[520px]">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label={t("shell.search.label")}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        placeholder={t("shell.search.placeholder")}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            go(results[active].href);
          } else if (e.key === "Escape") {
            setOpen(false);
            input.current?.blur();
          }
        }}
        className="h-8 w-full rounded-md border bg-surface pr-14 pl-8 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 [&::-webkit-search-cancel-button]:hidden"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-app px-1 font-sans text-[11px] text-muted-foreground">
        Ctrl P
      </kbd>
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={t("shell.search.label")}
          className="absolute inset-x-0 top-9 z-50 overflow-hidden rounded-md border bg-popover py-1 shadow-md"
        >
          {results.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">{t("shell.search.empty")}</div>
          )}
          {results.map((d, i) => {
            const Icon = SHELL_ICONS[d.icon];
            return (
              <div
                key={d.href}
                id={`${listId}-${i}`}
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                // mousedown, not click: the input's blur would close the list first
                onMouseDown={(e) => {
                  e.preventDefault();
                  go(d.href);
                }}
                onMouseEnter={() => setActive(i)}
                className={cn(
                  "flex h-8 cursor-pointer items-center gap-2 px-3 text-[13px]",
                  i === active && "bg-selection",
                )}
              >
                {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
                {d.parent && <span className="text-muted-foreground">{t(d.parent)} ›</span>}
                <span>{t(d.key)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
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
