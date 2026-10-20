import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireCaller } from "@/kernel/auth/caller";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { can } from "@/kernel/auth/can";
import { PageHeader } from "@/kernel/ui/shell/page";

type TabConfig = {
  value: string;
  label: string;
  href: string;
  roles: CallerIdentity["role"][];
  separator?: boolean;
};

const SETTINGS_TABS: TabConfig[] = [
  { value: "company", label: "Company", href: "/settings/company", roles: ["owner"] },
  {
    value: "bas-categories",
    label: "BAS Categories",
    href: "/settings/bas-categories",
    roles: ["owner"],
  },
  {
    value: "vat-registrations",
    label: "VAT Registrations",
    href: "/settings/vat-registrations",
    roles: ["owner"],
  },
  {
    value: "bank-accounts",
    label: "Bank Accounts",
    href: "/settings/bank-accounts",
    roles: ["owner"],
  },
  {
    value: "traktamente",
    label: "Traktamente",
    href: "/settings/traktamente",
    roles: ["owner"],
  },
  // Visual separator — "My Preferences" is user-scoped, tabs above are tenant-scoped
  {
    value: "my-preferences",
    label: "My Preferences",
    href: "/settings/my-preferences",
    roles: ["owner", "accountant"],
    separator: true,
  },
];

export default async function SettingsPage() {
  const caller = await requireCaller();
  const role = caller.role;

  const visibleTabs = SETTINGS_TABS.filter((tab) => tab.roles.includes(role));
  const defaultTab = can(caller, "manage", "tenant_settings") ? "company" : "my-preferences";

  return (
    <div className="p-4 md:p-6">
      <PageHeader title="Settings" className="mb-4" />
      <Tabs defaultValue={defaultTab}>
        <TabsList>
          {visibleTabs.map((tab) => (
            <span key={tab.value} className={tab.separator ? "ml-2 border-l pl-2" : undefined}>
              <TabsTrigger value={tab.value} nativeButton={false} render={<Link href={tab.href} />}>
                {tab.label}
              </TabsTrigger>
            </span>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
