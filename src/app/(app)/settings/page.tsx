import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { PageHeader } from "@/kernel/ui/shell/page";

type Section = {
  label: string;
  description: string;
  href: string;
  roles: CallerIdentity["role"][];
  /** the user-scoped sections, after a separator — everything above is the company's */
  personal?: boolean;
};

// The settings hub: plain links to the sections (they are pages, not tabs — a Tabs widget here hydrated with
// different ids on server and client). Tenant sections for the owner, the personal ones for everyone.
const SECTIONS: Section[] = [
  {
    label: "Company",
    description: "Name, organisation number, address, contact, base currency.",
    href: "/settings/company",
    roles: ["owner"],
  },
  {
    label: "BAS Categories",
    description: "The categories the journal and the expenses use, with their aliases.",
    href: "/settings/bas-categories",
    roles: ["owner"],
  },
  {
    label: "VAT Registrations",
    description: "Swedish and Swiss registrations, rates and declaration periods.",
    href: "/settings/vat-registrations",
    roles: ["owner"],
  },
  {
    label: "Bank Accounts",
    description: "The Nordea accounts and their CSV formats.",
    href: "/settings/bank-accounts",
    roles: ["owner"],
  },
  {
    label: "Traktamente",
    description: "Skatteverket's normalbelopp per country and year.",
    href: "/settings/traktamente",
    roles: ["owner"],
  },
  {
    label: "Exchange rates",
    description: "ECB reference rates — coverage, and a fetch on demand.",
    href: "/settings/rates",
    roles: ["owner", "accountant"],
  },
  {
    label: "My Preferences",
    description: "The language of the interface.",
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

  const list = (sections: Section[], label: string) =>
    sections.length === 0 ? null : (
      <section aria-label={label} className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">{label}</h2>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {sections.map((s) => (
            <li key={s.href}>
              <Link
                href={s.href}
                className="block rounded-md border p-3 hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-xs text-muted-foreground">{s.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6">
      <PageHeader title="Settings" />
      {list(company, "Company")}
      {list(personal, "Personal")}
    </div>
  );
}
