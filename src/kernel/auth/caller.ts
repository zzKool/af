// Server-side helper for pages and layouts: resolve the caller once, in one place.
// (Server actions get the same identity through the action middleware chain.)
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/kernel/db/client";
import { getAuthContext } from "./auth";
import type { CallerIdentity } from "./caller-identity";
import { type Action, can, isKnownOrgRole, roleFromMembership, type Subject } from "./can";

/**
 * The caller of a page, or null: no session, no active tenant, **no membership of that tenant, or an unknown
 * organisation role** — the same four refusals as the action middleware (`kernel/actions/tenant.ts`). A member
 * removed from the tenant keeps a session cookie until it expires; the pages must not render for it (F105).
 */
export async function getCaller(): Promise<CallerIdentity | null> {
  const hdrs = await headers();
  const auth = await getAuthContext(hdrs);
  if (!auth?.tenantId) return null;
  const member = await prisma.member.findFirst({
    where: { userId: auth.userId, organizationId: auth.tenantId },
    select: { role: true },
  });
  if (!member || !isKnownOrgRole(member.role)) return null;
  return {
    userId: auth.userId,
    tenantId: auth.tenantId,
    role: roleFromMembership(member.role),
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
