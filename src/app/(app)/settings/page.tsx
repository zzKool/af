import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import type { CallerIdentity } from "@/types/caller-identity";

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
    value: "document-prefixes",
    label: "Document Prefixes",
    href: "/settings/document-prefixes",
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
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) redirect("/login");

  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  const role: CallerIdentity["role"] = member?.role === "owner" ? "owner" : "accountant";

  const visibleTabs = SETTINGS_TABS.filter((tab) => tab.roles.includes(role));
  const defaultTab = role === "owner" ? "company" : "my-preferences";

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
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
