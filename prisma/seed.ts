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

import { auth } from "@/kernel/auth/auth";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";

if (process.env.NODE_ENV === "production") {
  throw new Error("Seed script cannot run in production");
}

const PASSWORD = process.env.SEED_PASSWORD ?? "password123";

async function seed() {
  console.log("🌱 Seeding database...");

  // 1. Create owner user (idempotent: try sign-in first)
  let ownerUserId: string;
  try {
    const ownerSignIn = await auth.api.signInEmail({
      body: { email: "owner@dev.test", password: PASSWORD },
    });
    ownerUserId = ownerSignIn.user.id;
    console.log("  ✓ Owner user already exists:", ownerUserId);
  } catch {
    const ownerSignUp = await auth.api.signUpEmail({
      body: { email: "owner@dev.test", password: PASSWORD, name: "Zik Owner" },
    });
    ownerUserId = ownerSignUp.user.id;
    console.log("  ✓ Created owner user:", ownerUserId);
  }

  // 2. Create accountant user (idempotent)
  let accountantUserId: string;
  try {
    const accountantSignIn = await auth.api.signInEmail({
      body: { email: "accountant@dev.test", password: PASSWORD },
    });
    accountantUserId = accountantSignIn.user.id;
    console.log("  ✓ Accountant user already exists:", accountantUserId);
  } catch {
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

    // Find invitation directly from DB since listInvitations requires active org
    const pendingInvite = await prisma.invitation.findFirst({
      where: { organizationId: orgId, email: "accountant@dev.test", status: "pending" },
    });
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

  // 8. The owner's three Nordea accounts (anonymised numbers; the two main accounts share one Plusgiro
  //    number and differ by currency) and the two default categorisation rules (specs/banking FR-016).
  await withTenantTransaction(prisma, orgId, async (tx) => {
    const nordea = await tx.bankFormat.findUnique({ where: { name: "Nordea CSV (Sweden)" } });
    if (nordea) {
      const accounts = [
        {
          accountAlias: "Plusgirokonto SEK",
          accountNumber: "123 45 67-8",
          currency: "SEK",
          role: "main" as const,
        },
        {
          accountAlias: "Plusgirokonto CHF",
          accountNumber: "123 45 67-8",
          currency: "CHF",
          role: "main" as const,
        },
        {
          accountAlias: "Sparkonto",
          accountNumber: "1234 56 78901",
          currency: "SEK",
          role: "savings" as const,
        },
      ];
      for (const a of accounts) {
        await tx.bankAccount.upsert({
          where: {
            tenantId_accountNumber_currency: {
              tenantId: orgId,
              accountNumber: a.accountNumber,
              currency: a.currency,
            },
          },
          update: { accountAlias: a.accountAlias, role: a.role },
          create: {
            ...a,
            tenantId: orgId,
            bankFormatId: nordea.id,
            createdBy: ownerUserId,
            source: "seed",
          },
        });
      }
      console.log("  ✓ Bank accounts seeded (SEK, CHF, savings)");
    }
    const rules = [
      {
        name: "Nordea bank fees",
        description: "AVGIFTER NORDEA — the statement is the proof",
        matchType: "contains" as const,
        matchPattern: "AVGIFTER NORDEA",
        matchField: "counterparty_key" as const,
        basCode: "657",
        noDocumentNeeded: true,
        priority: 100,
      },
      {
        name: "Savings interest",
        description: "Ränta / Interest — the yearly interest row of the savings account",
        matchType: "regex" as const,
        matchPattern: "^(R[äa]nta|Interest)\\b",
        matchField: "details" as const,
        basCode: "831",
        noDocumentNeeded: true,
        priority: 90,
      },
    ];
    for (const r of rules) {
      const bas = await tx.basCategory.findUnique({ where: { code: r.basCode } });
      await tx.categorisationRule.upsert({
        where: { tenantId_name: { tenantId: orgId, name: r.name } },
        update: {},
        create: {
          ...r,
          basCode: bas ? r.basCode : null,
          tenantId: orgId,
          createdBy: ownerUserId,
          source: "seed",
        },
      });
    }
    console.log("  ✓ Categorisation rules seeded (bank fees, savings interest)");

    // the owner's working BAS set: the common groups plus the ones his aliases point to (Excel Sheet 3)
    const wanted = new Set([
      ...(await tx.basCategory.findMany({ where: { isCommon: true }, select: { code: true } })).map(
        (c) => c.code,
      ),
      "501",
      "570",
      "654",
      "657",
      "631",
      "721",
      "831",
      "263",
    ]);
    const known = new Set(
      (
        await tx.basCategory.findMany({
          where: { code: { in: [...wanted] } },
          select: { code: true },
        })
      ).map((c) => c.code),
    );
    const active = new Set(
      (await tx.tenantBasPreference.findMany({ select: { basCode: true } })).map((p) => p.basCode),
    );
    const toActivate = [...wanted].filter((c) => known.has(c) && !active.has(c));
    if (toActivate.length) {
      await tx.tenantBasPreference.createMany({
        data: toActivate.map((code) => ({
          tenantId: orgId,
          basCode: code,
          isFavorite: ["654", "657", "570", "501"].includes(code),
          createdBy: ownerUserId,
          source: "seed",
        })),
      });
    }
    console.log(`  ✓ BAS categories activated (${toActivate.length} new)`);

    // the owner's aliases on the categories his expense keys use (Ex213-Tr-01, Ex213-Rep-01)
    for (const [code, shortCode] of [
      ["580", "Tr"],
      ["583", "Rep"],
      ["501", "Lokal"],
      ["654", "IT"],
    ] as const) {
      if (!known.has(code) && !(await tx.basCategory.findUnique({ where: { code } }))) continue;
      await tx.tenantBasPreference.upsert({
        where: { tenantId_basCode: { tenantId: orgId, basCode: code } },
        update: { shortCode },
        create: {
          tenantId: orgId,
          basCode: code,
          shortCode,
          createdBy: ownerUserId,
          source: "seed",
        },
      });
    }

    // the four payment sources (specs/expenses US2): the two main accounts, the owner's private cards
    const mainAccounts = await tx.bankAccount.findMany({
      where: { tenantId: orgId, role: "main" },
      select: { id: true, currency: true },
    });
    const sources = [
      ...mainAccounts.map((a) => ({
        label: `AF ${a.currency}`,
        kind: "bank_account" as const,
        bankAccountId: a.id,
        currency: a.currency,
      })),
      { label: "Private SE", kind: "private" as const, bankAccountId: null, currency: "SEK" },
      { label: "Private CH", kind: "private" as const, bankAccountId: null, currency: "CHF" },
    ];
    for (const src of sources) {
      await tx.paymentSource.upsert({
        where: { tenantId_label: { tenantId: orgId, label: src.label } },
        update: {},
        create: { ...src, tenantId: orgId, createdBy: ownerUserId, source: "seed" },
      });
    }
    console.log(`  ✓ Payment sources seeded (${sources.length})`);

    // Skatteverket's normalbelopp — the 2025 subset v1 carried (specs/traktamente/fixtures/normalbelopp.csv),
    // flagged v1-seed: the owner verifies and pastes the current year's CSV
    const normalbelopp = [
      ["SE", "Sverige", "Sweden", "290", "145"],
      ["DE", "Tyskland", "Germany", "774", null],
      ["GB", "Storbritannien och Nordirland", "United Kingdom", "958", null],
      ["FR", "Frankrike", "France", "774", null],
      ["NL", "Nederländerna", "Netherlands", "774", null],
      ["NO", "Norge", "Norway", "1043", null],
      ["DK", "Danmark", "Denmark", "774", null],
      ["FI", "Finland", "Finland", "542", null],
      ["US", "USA", "United States", "889", null],
      ["CH", "Schweiz", "Switzerland", "1402", null],
    ] as const;
    for (const [countryCode, sv, en, dayAmount, nightAmount] of normalbelopp) {
      const meals =
        countryCode === "SE"
          ? { mealBreakfast: "58", mealLunch: "102", mealDinner: "102", mealAll: "261" }
          : {};
      await tx.normalbelopp.upsert({
        where: { tenantId_year_countryCode: { tenantId: orgId, year: 2025, countryCode } },
        update: {},
        create: {
          tenantId: orgId,
          year: 2025,
          countryCode,
          countryNameSv: sv,
          countryNameEn: en,
          dayAmount,
          nightAmount,
          ...meals,
          rateSource: "v1-seed",
          createdBy: ownerUserId,
          source: "seed",
        },
      });
    }
    console.log(
      `  ✓ Normalbelopp 2025 seeded (${normalbelopp.length} countries, v1-seed — verify)`,
    );
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
