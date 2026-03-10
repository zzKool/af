/**
 * Golden seed dataset for DefterFab development.
 *
 * Creates via Better Auth API (not direct SQL):
 * - Owner: owner@dev.test
 * - Accountant: accountant@dev.test
 * - Org: "Dev AB" → auto-creates Tenant via afterCreateOrganization hook
 * - TenantConfig entries for company profile
 *
 * Idempotent: safe to run multiple times.
 */

import { auth } from "../src/server/auth";
import { prisma } from "../src/server/db/client";
import { withTenantTransaction } from "../src/server/db/tenant-client";

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed script cannot run in production");
}

const PASSWORD = process.env.SEED_PASSWORD ?? "password123";

async function seed() {
  console.log("🌱 Seeding database...");

  // 1. Create owner user (idempotent: try sign-in first)
  let ownerUserId: string;
  const ownerSignIn = await auth.api.signInEmail({
    body: { email: "owner@dev.test", password: PASSWORD },
  });
  if (ownerSignIn?.user) {
    ownerUserId = ownerSignIn.user.id;
    console.log("  ✓ Owner user already exists:", ownerUserId);
  } else {
    const ownerSignUp = await auth.api.signUpEmail({
      body: { email: "owner@dev.test", password: PASSWORD, name: "Zik Owner" },
    });
    ownerUserId = ownerSignUp.user.id;
    console.log("  ✓ Created owner user:", ownerUserId);
  }

  // 2. Create accountant user (idempotent)
  let accountantUserId: string;
  const accountantSignIn = await auth.api.signInEmail({
    body: { email: "accountant@dev.test", password: PASSWORD },
  });
  if (accountantSignIn?.user) {
    accountantUserId = accountantSignIn.user.id;
    console.log("  ✓ Accountant user already exists:", accountantUserId);
  } else {
    const accountantSignUp = await auth.api.signUpEmail({
      body: { email: "accountant@dev.test", password: PASSWORD, name: "Test Accountant" },
    });
    accountantUserId = accountantSignUp.user.id;
    console.log("  ✓ Created accountant user:", accountantUserId);
  }

  // 3. Create org "Dev AB" (idempotent: check if exists first)
  // The afterCreateOrganization hook auto-creates the Tenant row
  let orgId: string;
  const existingOrg = await prisma.organization.findFirst({
    where: { slug: "dev-ab" },
  });
  if (existingOrg) {
    orgId = existingOrg.id;
    console.log("  ✓ Organization already exists:", orgId);
  } else {
    // Need owner session headers for creating org
    const ownerSession = await auth.api.signInEmail({
      body: { email: "owner@dev.test", password: PASSWORD },
      asResponse: true,
    });
    const cookies = ownerSession.headers.getSetCookie();
    const ownerHeaders = new Headers();
    ownerHeaders.set("cookie", cookies.map((c: string) => c.split(";")[0]).join("; "));

    const org = await auth.api.createOrganization({
      headers: ownerHeaders,
      body: { name: "Dev AB", slug: "dev-ab" },
    });
    orgId = org.id;
    console.log("  ✓ Created organization:", orgId, "(Tenant auto-created via hook)");

    // 4. Add accountant as member
    await auth.api.createInvitation({
      headers: ownerHeaders,
      body: { email: "accountant@dev.test", role: "member", organizationId: orgId },
    });

    // Accept invitation as accountant
    const accountantSession = await auth.api.signInEmail({
      body: { email: "accountant@dev.test", password: PASSWORD },
      asResponse: true,
    });
    const acctCookies = accountantSession.headers.getSetCookie();
    const accountantHeaders = new Headers();
    accountantHeaders.set("cookie", acctCookies.map((c: string) => c.split(";")[0]).join("; "));

    const invitations = await auth.api.listInvitations({
      headers: accountantHeaders,
    });
    const pendingInvite = invitations?.find(
      (inv: { organizationId: string; status: string }) =>
        inv.organizationId === orgId && inv.status === "pending",
    );
    if (pendingInvite) {
      await auth.api.acceptInvitation({
        headers: accountantHeaders,
        body: { invitationId: pendingInvite.id },
      });
      console.log("  ✓ Accountant added to organization");
    }

    // 5. Set active org for both users
    await auth.api.setActiveOrganization({
      headers: ownerHeaders,
      body: { organizationId: orgId },
    });
    await auth.api.setActiveOrganization({
      headers: accountantHeaders,
      body: { organizationId: orgId },
    });
    console.log("  ✓ Active organization set for both users");
  }

  // 6. Update Tenant profile fields via RLS-scoped transaction
  await withTenantTransaction(prisma, orgId, async (tx) => {
    await tx.tenant.update({
      where: { id: orgId },
      data: {
        orgNumber: "556677-8899",
        address: "Testgatan 1, 111 22 Stockholm",
        currency: "SEK",
      },
    });
  });
  console.log("  ✓ Tenant profile updated");

  // 7. Seed TenantConfig entries via withTenantTransaction (respects RLS)
  await withTenantTransaction(prisma, orgId, async (tx) => {
    const configs = [
      { key: "company_name", value: "Dev AB" },
      { key: "org_number", value: "556677-8899" },
      { key: "address", value: "Testgatan 1, 111 22 Stockholm" },
      { key: "currency", value: "SEK" },
    ];

    for (const config of configs) {
      await tx.tenantConfig.upsert({
        where: { tenantId_key: { tenantId: orgId, key: config.key } },
        update: { value: config.value },
        create: {
          tenantId: orgId,
          key: config.key,
          value: config.value,
          createdBy: ownerUserId,
          source: "seed",
        },
      });
    }
    console.log("  ✓ TenantConfig entries seeded");
  });

  console.log("\n🌱 Seed complete!");
  console.log("  Owner:      owner@dev.test / password123");
  console.log("  Accountant: accountant@dev.test / password123");
  console.log("  Org:        Dev AB");
}

seed()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
