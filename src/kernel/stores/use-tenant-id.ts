import { authClient } from "@/kernel/auth/auth-client";

/**
 * Returns the current activeOrganizationId from the Better Auth session.
 * Returns null while the session is loading or if no org is active.
 * Zustand stores subscribe to this for tenant-change detection.
 */
export function useTenantId(): string | null {
  const session = authClient.useSession();
  return session.data?.session?.activeOrganizationId ?? null;
}
