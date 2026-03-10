import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/domain/sidebar";
import { Providers } from "@/components/shared/providers";
import { getAuthContext } from "@/server/auth";
import { prisma } from "@/server/db/client";
import type { CallerIdentity } from "@/types/caller-identity";

export default async function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth) redirect("/login");
  if (!auth.tenantId) redirect("/login");

  // Resolve role for sidebar filtering (mirrors tenant middleware logic)
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
  });
  const role: CallerIdentity["role"] = member?.role === "owner" ? "owner" : "accountant";

  return (
    <Providers>
      <div className="flex h-screen">
        <Sidebar role={role} />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </Providers>
  );
}
