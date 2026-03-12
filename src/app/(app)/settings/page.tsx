import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <Tabs defaultValue="company">
        <TabsList>
          <TabsTrigger
            value="company"
            nativeButton={false}
            render={<Link href="/settings/company" />}
          >
            Company
          </TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="bank-accounts" disabled>
            Bank Accounts (Coming soon)
          </TabsTrigger>
          <TabsTrigger
            value="bas-categories"
            nativeButton={false}
            render={<Link href="/settings/bas-categories" />}
          >
            BAS Categories
          </TabsTrigger>
          <TabsTrigger
            value="vat-registrations"
            nativeButton={false}
            render={<Link href="/settings/vat-registrations" />}
          >
            VAT Registrations
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-6">
          <p className="text-sm text-muted-foreground">
            User management coming in a future update.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
