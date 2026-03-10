import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { prisma } from "@/server/db/client";
import type { CallerIdentity } from "@/types/caller-identity";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL || process.env.AUTH_URL || "http://localhost:3000",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  plugins: [
    organization({
      allowUserToCreateOrganization: true,
      creatorRole: "owner",
    }),
    nextCookies(),
  ],
  experimental: { joins: true },
  advanced: {
    database: {
      generateId: false,
    },
  },
});

type AuthContext = Pick<CallerIdentity, "userId"> & {
  tenantId: string | null;
  role: CallerIdentity["role"] | null;
};

export async function getAuthContext(headers: Headers): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return {
    userId: session.user.id,
    tenantId: session.session.activeOrganizationId ?? null,
    role: null,
  };
}
