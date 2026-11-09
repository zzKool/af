"use client";

// The Settings sub-menu (F157, the Pulse-Settings board): *You* · *Company* · *Automation*, the current section
// marked. The exchange rates and the rules live in the main menu's pages; the sub-menu links there too.
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";

type Item = { href: string; label: MessageKey };
/** `ownerOnly`: shown to a caller who may manage the tenant's settings */
type Group = { label: MessageKey; items: Item[]; ownerOnly?: boolean };

export const SETTINGS_MENU: readonly Group[] = [
  {
    label: "settings.menu.you",
    items: [{ href: "/settings/my-preferences", label: "settings.preferences.title" }],
  },
  {
    label: "settings.menu.company",
    ownerOnly: true,
    items: [
      { href: "/settings/company", label: "settings.company.heading" },
      { href: "/settings/bank-accounts", label: "settings.bankAccounts.title" },
      { href: "/settings/vat-registrations", label: "settings.vat.title" },
      { href: "/settings/bas-categories", label: "settings.bas.title" },
    ],
  },
  {
    label: "settings.menu.automation",
    ownerOnly: true,
    items: [
      { href: "/rates", label: "rates.title" },
      { href: "/banking/rules", label: "banking.nav.rules" },
      { href: "/settings/traktamente", label: "traktamente.title" },
      { href: "/settings/ai", label: "settings.ai.title" },
    ],
  },
];

export function SettingsMenu({ owner }: { owner: boolean }) {
  const t = useT();
  const pathname = usePathname();
  return (
    <nav
      aria-label={t("settings.menu.label")}
      className="flex flex-col gap-4"
      data-testid="settings-menu"
    >
      {SETTINGS_MENU.filter((g) => owner || !g.ownerOnly).map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <span className="eyebrow px-2.5 pb-1">{t(g.label)}</span>
          {g.items.map((i) => {
            const current = pathname === i.href || pathname.startsWith(`${i.href}/`);
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[13px] transition-colors hover:bg-hover",
                  current
                    ? "bg-surface font-semibold shadow-[var(--elev-card)]"
                    : "text-muted-foreground",
                )}
              >
                {t(i.label)}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
