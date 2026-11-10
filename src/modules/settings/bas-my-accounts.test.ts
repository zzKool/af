// F187 (D84): *Use my usual accounts* — the owner's set active with its notes (confirmed, never over his own), the
// others removed on request except those holding his data or used by a record; idempotent; owner only; per tenant.
// Invented data (D51).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { type TransactionClient, withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestPartner,
} from "@/kernel/db/test-fixtures";
import { applyMyAccounts, planMyAccounts } from "./bas-my-accounts";
import { activateBasCategories, updateBasPreference } from "./bas-preferences";
import { MY_ACCOUNT_SET } from "./my-accounts";

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));

const noop: AuditLogger = { log: async () => {} };
const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
beforeAll(() => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  resetRateLimit();
  mockHeaders = new Headers();
});
afterAll(async () => {
  await adminPool.end();
});

import { applyMyAccountsAction } from "./bas-preferences.actions";

const run = <T>(c: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, c.tenantId, fn);

const SET = MY_ACCOUNT_SET.map((a) => a.code);
const NOTE = new Map(MY_ACCOUNT_SET.map((a) => [a.code, a.useFor]));

const active = async (c: CallerIdentity) =>
  new Map(
    (
      await run(c, (tx) =>
        tx.tenantBasPreference.findMany({
          select: { basCode: true, useFor: true, useForState: true },
        }),
      )
    ).map((p) => [p.basCode, p]),
  );

/** An owner with the common accounts the quick-start used to activate, plus some of his own data on a few. */
async function ownerWithHistory() {
  const ctx = await createAuthenticatedContext(auth, "owner");
  const c = ctx.callerIdentity;
  // 5010, 6540 in the set; the others not
  const codes = ["5010", "6540", "1930", "2440", "5830", "5700", "6310", "6900", "7690", "4010"];
  await run(c, (tx) => activateBasCategories(tx, c, noop, codes));
  await run(c, async (tx) => {
    await updateBasPreference(tx, c, noop, "5010", { useFor: "My own words on rent" }); // confirmed, his
    await tx.tenantBasPreference.update({
      where: { tenantId_basCode: { tenantId: c.tenantId, basCode: "6540" } },
      data: { useFor: "a model's draft", useForState: "draft" },
    });
    await updateBasPreference(tx, c, noop, "5830", { shortCode: "Rep" }); // short code
    await updateBasPreference(tx, c, noop, "5700", { isFavorite: true }); // favourite
    await updateBasPreference(tx, c, noop, "6310", { translations: { en: "Insurance" } }); // his name
    await updateBasPreference(tx, c, noop, "7690", { useFor: "Staff events" }); // his note
    // a draft on another account is not his word: it does not keep the account
    await tx.tenantBasPreference.update({
      where: { tenantId_basCode: { tenantId: c.tenantId, basCode: "1930" } },
      data: { useFor: "drafted", useForState: "draft" },
    });
    // a rule on 6900 — used by a record
    await tx.categorisationRule.create({
      data: {
        tenantId: c.tenantId,
        name: "Invented vendor",
        matchType: "contains",
        matchPattern: "INVENTED VENDOR",
        basCode: "6900",
        createdBy: c.userId,
      },
    });
  });
  // a partner's default on 4010 — used by a record
  await createTestPartner(adminPool, c.tenantId, c.userId, { defaultBasCategoryCode: "4010" });
  return ctx;
}

describe("F187 — Use my usual accounts", () => {
  it("plans first: the set to activate and note, the others to remove, the kept ones with their reasons", async () => {
    const { callerIdentity: c } = await ownerWithHistory();
    const plan = await run(c, (tx) => planMyAccounts(tx, c));
    expect(plan.data?.activate).toEqual(SET.filter((x) => x !== "5010" && x !== "6540"));
    expect(plan.data?.notes).toContain("6540"); // a draft gets the owner's set note
    expect(plan.data?.notes).not.toContain("5010"); // his own note stays
    expect(plan.data?.deactivate.sort()).toEqual(["1930", "2440"]);
    const kept = Object.fromEntries((plan.data?.kept ?? []).map((k) => [k.code, k.reasons]));
    expect(kept).toEqual({
      "4010": ["inUse"],
      "5700": ["favourite"],
      "5830": ["shortCode"],
      "6310": ["translations"],
      "6900": ["inUse"],
      "7690": ["note"],
    });
    expect(plan.data?.kept.find((k) => k.code === "6900")?.label).toMatch(/^6900 · /);
    // nothing written by the plan
    expect((await active(c)).has("1630")).toBe(false);
  });

  it("activates the set with confirmed notes, never over his own; removes the others except the kept; audited", async () => {
    const { callerIdentity: c } = await ownerWithHistory();
    const logged: { action: string; entityId: string }[] = [];
    const audit: AuditLogger = {
      log: async (p) => {
        logged.push({ action: p.action, entityId: p.entityId });
      },
    };
    const res = await run(c, (tx) => applyMyAccounts(tx, c, audit, { deactivateOthers: true }));
    expect(res.error).toBeUndefined();
    expect(res.data).toMatchObject({
      activated: SET.length - 2,
      notes: SET.length - 1,
      deactivated: 2,
      kept: 6,
    });
    const after = await active(c);
    expect([...after.keys()].sort()).toEqual(
      [...SET, "4010", "5700", "5830", "6310", "6900", "7690"].sort(),
    );
    expect(after.get("1630")).toMatchObject({
      useFor: NOTE.get("1630"),
      useForState: "confirmed",
    });
    expect(after.get("6540")).toMatchObject({
      useFor: NOTE.get("6540"),
      useForState: "confirmed",
    });
    expect(after.get("5010")).toMatchObject({
      useFor: "My own words on rent",
      useForState: "confirmed",
    });
    expect(after.get("7690")?.useFor).toBe("Staff events");
    // the list the page shows comes back with the result
    expect(res.data?.preferences.map((p) => p.basCode).sort()).toEqual([...after.keys()].sort());
    // one audit line per account touched
    expect(logged.filter((l) => l.action === "create").length).toBe(SET.length - 2);
    expect(logged.filter((l) => l.action === "update").map((l) => l.entityId)).toEqual(["6540"]);
    expect(
      logged
        .filter((l) => l.action === "delete")
        .map((l) => l.entityId)
        .sort(),
    ).toEqual(["1930", "2440"]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { callerIdentity: c } = await ownerWithHistory();
    await run(c, (tx) => applyMyAccounts(tx, c, noop, { deactivateOthers: true }));
    const before = await active(c);
    const again = await run(c, (tx) => applyMyAccounts(tx, c, noop, { deactivateOthers: true }));
    expect(again.data).toMatchObject({ activated: 0, notes: 0, deactivated: 0, kept: 6 });
    expect(await active(c)).toEqual(before);
    const plan = await run(c, (tx) => planMyAccounts(tx, c));
    expect(plan.data).toMatchObject({ activate: [], notes: [], deactivate: [] });
  });

  it("without the box, the others stay", async () => {
    const { callerIdentity: c } = await ownerWithHistory();
    const res = await run(c, (tx) => applyMyAccounts(tx, c, noop, { deactivateOthers: false }));
    expect(res.data?.deactivated).toBe(0);
    const after = await active(c);
    expect(after.has("1930")).toBe(true);
    expect(after.has("2440")).toBe(true);
    expect(after.has("1630")).toBe(true);
  });

  it("owner only: the accountant is refused, nothing written", async () => {
    const { callerIdentity: c } = await ownerWithHistory();
    const accountant: CallerIdentity = { ...c, role: "accountant" };
    const plan = await run(c, (tx) => planMyAccounts(tx, accountant));
    expect(plan.error?.code).toBe("FORBIDDEN");
    const res = await run(c, (tx) =>
      applyMyAccounts(tx, accountant, noop, { deactivateOthers: true }),
    );
    expect(res.error?.code).toBe("FORBIDDEN");
    expect((await active(c)).has("1630")).toBe(false);
  });

  it("per tenant: another tenant's accounts and records are neither touched nor counted", async () => {
    const { callerIdentity: a } = await ownerWithHistory();
    const { callerIdentity: b } = await createAuthenticatedContext(auth, "owner");
    await run(b, (tx) => activateBasCategories(tx, b, noop, ["1930", "2440"]));
    // B uses 2440 on a rule; A's 2440 holds nothing — A's still goes
    await run(b, (tx) =>
      tx.categorisationRule.create({
        data: {
          tenantId: b.tenantId,
          name: "B's rule",
          matchType: "contains",
          matchPattern: "B VENDOR",
          basCode: "2440",
          createdBy: b.userId,
        },
      }),
    );
    await run(a, (tx) => applyMyAccounts(tx, a, noop, { deactivateOthers: true }));
    expect((await active(a)).has("2440")).toBe(false);
    expect([...(await active(b)).keys()].sort()).toEqual(["1930", "2440"]);
  });

  it("the action: owner only, unknown fields refused", async () => {
    const owner = await ownerWithHistory();
    mockHeaders = owner.headers;
    const bad = await applyMyAccountsAction({ deactivateOthers: true, extra: 1 } as never);
    expect(bad?.validationErrors ?? bad?.serverError).toBeDefined();
    const ok = await applyMyAccountsAction({ deactivateOthers: true });
    expect(ok?.serverError).toBeUndefined();
    expect(ok?.data).toMatchObject({ data: { deactivated: 2 } });
  });
});
