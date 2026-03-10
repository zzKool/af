import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger value="company" render={<Link href="/settings/company" />}>
            Company
          </TabsTrigger>
          <TabsTrigger value="users" disabled>
            Users (Coming soon)
          </TabsTrigger>
          <TabsTrigger value="bank-accounts" disabled>
            Bank Accounts (Coming soon)
          </TabsTrigger>
          <TabsTrigger value="bas-categories" disabled>
            BAS Categories (Coming soon)
          </TabsTrigger>
          <TabsTrigger value="vat" disabled>
            VAT (Coming soon)
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
