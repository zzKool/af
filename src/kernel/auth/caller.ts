// Server-side helper for pages and layouts: resolve the caller once, in one place.
// (Server actions get the same identity through the action middleware chain.)
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/kernel/db/client";
import { getAuthContext } from "./auth";
import type { CallerIdentity } from "./caller-identity";
import { type Action, can, roleFromMembership, type Subject } from "./can";

export async function getCaller(): Promise<CallerIdentity | null> {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) return null;
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
    select: { role: true },
  });
  return {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role: roleFromMembership(member?.role),
    source: "web",
  };
}

/** Caller or redirect to /login. With a permission, redirect to /dashboard when it is missing. */
export async function requireCaller(permission?: {
  action: Action;
  subject: Subject;
}): Promise<CallerIdentity> {
  const caller = await getCaller();
  if (!caller) redirect("/login");
  if (permission && !can(caller, permission.action, permission.subject)) redirect("/dashboard");
  return caller;
}
