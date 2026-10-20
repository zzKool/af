import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth, getAuthContext } from "@/kernel/auth/auth";

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";

let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});

beforeEach(async () => {
  const client = await adminPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "TRUNCATE tenant_configs, tenants, invitations, members, accounts, verifications, sessions, users, organizations CASCADE",
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

afterAll(async () => {
  await adminPool.end();
});

async function signUpUser(email: string, password: string, name: string) {
  return auth.api.signUpEmail({
    body: { email, password, name },
  });
}

/**
 * Sign in and return session headers with cookies.
 * Uses `asResponse: true` to capture Set-Cookie headers from Better Auth.
 */
async function signInAndGetHeaders(email: string, password: string) {
  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  const data = await response.json();
  const cookies = response.headers.getSetCookie();
  const headers = new Headers();
  headers.set("cookie", cookies.map((c) => c.split(";")[0]).join("; "));
  return { headers, data };
}

describe("Better Auth integration", () => {
  describe("signup flow", () => {
    it("creates a user via signUpEmail", async () => {
      const result = await signUpUser("test@example.com", "password123", "Test User");
      expect(result.user).toBeDefined();
      expect(result.user.email).toBe("test@example.com");
      expect(result.user.name).toBe("Test User");
      expect(result.user.id).toBeDefined();
    });
  });

  describe("login flow", () => {
    it("creates a session on signInEmail", async () => {
      await signUpUser("login@example.com", "password123", "Login User");
      const { data } = await signInAndGetHeaders("login@example.com", "password123");
      expect(data.token).toBeDefined();
      expect(data.user).toBeDefined();
      expect(data.user.email).toBe("login@example.com");
    });
  });

  describe("session retrieval", () => {
    it("retrieves session via getSession with headers", async () => {
      await signUpUser("session@example.com", "password123", "Session User");
      const { headers } = await signInAndGetHeaders("session@example.com", "password123");

      const session = await auth.api.getSession({ headers });
      expect(session).not.toBeNull();
      expect(session?.user.email).toBe("session@example.com");
    });
  });

  describe("organization creation", () => {
    it("creates an organization (tenant)", async () => {
      await signUpUser("org@example.com", "password123", "Org User");
      const { headers } = await signInAndGetHeaders("org@example.com", "password123");

      const org = await auth.api.createOrganization({
        headers,
        body: { name: "Test Company", slug: "test-company" },
      });
      expect(org).toBeDefined();
      expect(org.name).toBe("Test Company");
      expect(org.slug).toBe("test-company");
      expect(org.id).toBeDefined();
    });
  });

  describe("active organization", () => {
    it("sets activeOrganizationId on session", async () => {
      await signUpUser("active@example.com", "password123", "Active User");
      const { headers } = await signInAndGetHeaders("active@example.com", "password123");

      const org = await auth.api.createOrganization({
        headers,
        body: { name: "Active Org", slug: "active-org" },
      });

      await auth.api.setActiveOrganization({
        headers,
        body: { organizationId: org.id },
      });

      const session = await auth.api.getSession({ headers });
      expect(session?.session.activeOrganizationId).toBe(org.id);
    });
  });

  describe("owner role", () => {
    it("creator gets owner role in organization", async () => {
      await signUpUser("owner@example.com", "password123", "Owner User");
      const { headers } = await signInAndGetHeaders("owner@example.com", "password123");

      const org = await auth.api.createOrganization({
        headers,
        body: { name: "Owner Org", slug: "owner-org" },
      });

      await auth.api.setActiveOrganization({
        headers,
        body: { organizationId: org.id },
      });

      const member = await auth.api.getActiveMember({ headers });
      expect(member?.role).toBe("owner");
    });
  });

  describe("accountant creation via invitation", () => {
    it("invited user gets member role (accountant)", async () => {
      // Owner signs up and creates org
      await signUpUser("inviter@example.com", "password123", "Inviter User");
      const { headers: ownerHeaders } = await signInAndGetHeaders(
        "inviter@example.com",
        "password123",
      );

      const org = await auth.api.createOrganization({
        headers: ownerHeaders,
        body: { name: "Invite Org", slug: "invite-org" },
      });

      await auth.api.setActiveOrganization({
        headers: ownerHeaders,
        body: { organizationId: org.id },
      });

      // Create invitation for accountant
      const invitation = await auth.api.createInvitation({
        headers: ownerHeaders,
        body: {
          email: "accountant@example.com",
          role: "member",
          organizationId: org.id,
        },
      });
      expect(invitation).toBeDefined();

      // Accountant signs up and signs in
      await signUpUser("accountant@example.com", "password123", "Accountant User");
      const { headers: accountantHeaders } = await signInAndGetHeaders(
        "accountant@example.com",
        "password123",
      );

      // Accept invitation
      await auth.api.acceptInvitation({
        headers: accountantHeaders,
        body: { invitationId: invitation.id },
      });

      // Set org active for accountant
      await auth.api.setActiveOrganization({
        headers: accountantHeaders,
        body: { organizationId: org.id },
      });

      // Verify role is member (our accountant)
      const member = await auth.api.getActiveMember({
        headers: accountantHeaders,
      });
      expect(member?.role).toBe("member");
    });
  });

  describe("tenant isolation smoke test", () => {
    it("getAuthContext returns correct tenantId for each user", async () => {
      // User A: signup, create org, set active
      await signUpUser("usera@example.com", "password123", "User A");
      const { headers: headersA, data: signInA } = await signInAndGetHeaders(
        "usera@example.com",
        "password123",
      );

      const orgA = await auth.api.createOrganization({
        headers: headersA,
        body: { name: "Org A", slug: "org-a" },
      });
      await auth.api.setActiveOrganization({
        headers: headersA,
        body: { organizationId: orgA.id },
      });

      // User B: signup, create org, set active
      await signUpUser("userb@example.com", "password123", "User B");
      const { headers: headersB, data: signInB } = await signInAndGetHeaders(
        "userb@example.com",
        "password123",
      );

      const orgB = await auth.api.createOrganization({
        headers: headersB,
        body: { name: "Org B", slug: "org-b" },
      });
      await auth.api.setActiveOrganization({
        headers: headersB,
        body: { organizationId: orgB.id },
      });

      // Verify getAuthContext returns correct tenantId for each user
      const contextA = await getAuthContext(headersA);
      expect(contextA).not.toBeNull();
      expect(contextA?.tenantId).toBe(orgA.id);
      expect(contextA?.userId).toBe(signInA.user.id);

      const contextB = await getAuthContext(headersB);
      expect(contextB).not.toBeNull();
      expect(contextB?.tenantId).toBe(orgB.id);
      expect(contextB?.userId).toBe(signInB.user.id);

      // Cross-check: they have different tenants
      expect(contextA?.tenantId).not.toBe(contextB?.tenantId);
    });
  });
});
