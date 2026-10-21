import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { Msg } from "@/kernel/i18n/msg";
import type { MessageKey } from "@/kernel/i18n/translate";
import { PageHeader } from "@/kernel/ui/shell/page";

type Section = {
  label: MessageKey;
  description: MessageKey;
  href: string;
  roles: CallerIdentity["role"][];
  /** the user-scoped sections, after a separator — everything above is the company's */
  personal?: boolean;
};

// The settings hub: plain links to the sections (they are pages, not tabs — a Tabs widget here hydrated with
// different ids on server and client). Tenant sections for the owner, the personal ones for everyone.
const SECTIONS: Section[] = [
  {
    label: "settings.company.title",
    description: "settings.company.description",
    href: "/settings/company",
    roles: ["owner"],
  },
  {
    label: "settings.bas.title",
    description: "settings.bas.description",
    href: "/settings/bas-categories",
    roles: ["owner"],
  },
  {
    label: "settings.vat.title",
    description: "settings.vat.description",
    href: "/settings/vat-registrations",
    roles: ["owner"],
  },
  {
    label: "settings.bankAccounts.title",
    description: "settings.bankAccounts.description",
    href: "/settings/bank-accounts",
    roles: ["owner"],
  },
  {
    label: "settings.traktamente.title",
    description: "settings.traktamente.description",
    href: "/settings/traktamente",
    roles: ["owner"],
  },
  {
    label: "settings.rates.title",
    description: "settings.rates.description",
    href: "/settings/rates",
    roles: ["owner", "accountant"],
  },
  {
    label: "settings.preferences.title",
    description: "settings.preferences.description",
    href: "/settings/my-preferences",
    roles: ["owner", "accountant"],
    personal: true,
  },
];

export default async function SettingsPage() {
  const caller = await requireCaller();
  const visible = SECTIONS.filter((s) => s.roles.includes(caller.role));
  const company = visible.filter((s) => !s.personal);
  const personal = visible.filter((s) => s.personal);

  const list = (sections: Section[], label: MessageKey) =>
    sections.length === 0 ? null : (
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">
          <Msg k={label} />
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="block rounded-md border p-3 hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="block text-sm font-medium">
                  <Msg k={s.label} />
                </span>
                <span className="block text-xs text-muted-foreground">
                  <Msg k={s.description} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title={<Msg k="settings.title" />} />
      {list(company, "settings.section.company")}
      {list(personal, "settings.section.personal")}
    </div>
  );
}
