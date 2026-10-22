// Contact persons — specs/partners/spec.md (F08) US1, US2 against the real database (RLS on).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import { createAuditEntry } from "@/kernel/audit/audit";
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
import { assertAuditLogged } from "@/kernel/test-utils/config-crud-helpers";
import * as contacts from "./contacts";

const noopAudit: AuditLogger = { log: async () => {} };
function realAudit(tx: TransactionClient, caller: CallerIdentity): AuditLogger {
  return { log: async (params) => createAuditEntry(tx, caller, params) };
}

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL ||
  "postgresql://defterfab:test@localhost:5433/defterfab_test";
let adminPool: Pool;

beforeAll(async () => {
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

async function owner() {
  const { callerIdentity } = await createAuthenticatedContext(auth, "owner");
  return callerIdentity;
}

async function partnerOf(caller: CallerIdentity, name = "Vaudoise") {
  const p = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
    name,
    types: ["client"],
  });
  return p.id;
}

const inTenant = <T>(caller: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, caller.tenantId, fn);

describe("US1 — add a contact person", () => {
  it("saves the four values, trimmed, and audits the creation (scenario 1)", async () => {
    const caller = await owner();
    const partnerId = await partnerOf(caller);

    const r = await inTenant(caller, (tx) =>
      contacts.createPartnerContact(tx, caller, realAudit(tx, caller), {
        partnerId,
        name: "  Anne Muster ",
        role: "Head of BI",
        email: "anne.muster@vaudoise.ch",
        phone: " +41 21 618 80 80",
      }),
    );
    expect(r.error).toBeUndefined();
    expect(r.data).toMatchObject({
      partnerId,
      name: "Anne Muster",
      role: "Head of BI",
      email: "anne.muster@vaudoise.ch",
      phone: "+41 21 618 80 80",
    });
    await assertAuditLogged(adminPool, caller.tenantId, "create", "partner_contact", r.data?.id);

    const list = await inTenant(caller, (tx) => contacts.listPartnerContacts(tx, partnerId));
    expect(list.data).toHaveLength(1);
  });

  it("name only: the other fields are null; empty strings are null too (scenario 2)", async () => {
    const caller = await owner();
    const partnerId = await partnerOf(caller);
    const r = await inTenant(caller, (tx) =>
      contacts.createPartnerContact(tx, caller, noopAudit, {
        partnerId,
        name: "Bo",
        role: "",
        email: "  ",
        phone: undefined,
      }),
    );
    expect(r.data).toMatchObject({ name: "Bo", role: null, email: null, phone: null });
  });

  it("refuses an empty name or one of spaces, nothing saved (scenario 3)", async () => {
    const caller = await owner();
    const partnerId = await partnerOf(caller);
    for (const name of ["", "   "]) {
      const r = await inTenant(caller, (tx) =>
        contacts.createPartnerContact(tx, caller, noopAudit, { partnerId, name }),
      );
      expect(r.error).toMatchObject({
        code: "VALIDATION_ERROR",
        message: "Name is required",
        details: { field: "name" },
      });
    }
    const list = await inTenant(caller, (tx) => contacts.listPartnerContacts(tx, partnerId));
    expect(list.data).toHaveLength(0);
  });

  it("refuses an e-mail that is not an address (scenario 4)", async () => {
    const caller = await owner();
    const partnerId = await partnerOf(caller);
    const r = await inTenant(caller, (tx) =>
      contacts.createPartnerContact(tx, caller, noopAudit, {
        partnerId,
        name: "Anne",
        email: "anne@",
      }),
    );
    expect(r.error).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Not a valid e-mail address",
      details: { field: "email" },
    });
  });

  it("refuses a partner that does not exist", async () => {
    const caller = await owner();
    const r = await inTenant(caller, (tx) =>
      contacts.createPartnerContact(tx, caller, noopAudit, {
        partnerId: "00000000-0000-4000-8000-000000000000",
        name: "Anne",
      }),
    );
    expect(r.error?.code).toBe("NOT_FOUND");
  });

  it("lists only the partner's own contacts, sorted by name case-insensitively (scenario 5)", async () => {
    const caller = await owner();
    const a = await partnerOf(caller, "A");
    const b = await partnerOf(caller, "B");
    await inTenant(caller, async (tx) => {
      for (const name of ["carla", "Anne", "bob"]) {
        await contacts.createPartnerContact(tx, caller, noopAudit, { partnerId: a, name });
      }
      await contacts.createPartnerContact(tx, caller, noopAudit, { partnerId: b, name: "Zed" });
    });
    const list = await inTenant(caller, (tx) => contacts.listPartnerContacts(tx, a));
    expect(list.data?.map((c) => c.name)).toEqual(["Anne", "bob", "carla"]);
  });
});

describe("US2 — correct or remove a contact", () => {
  async function withContact() {
    const caller = await owner();
    const partnerId = await partnerOf(caller);
    const created = await inTenant(caller, (tx) =>
      contacts.createPartnerContact(tx, caller, noopAudit, {
        partnerId,
        name: "Anne Muster",
        role: "Head of BI",
        email: "anne@vaudoise.ch",
        phone: "+41 21 618 80 80",
      }),
    );
    if (!created.data) throw new Error("setup failed");
    return { caller, partnerId, id: created.data.id };
  }

  it("changes the role, leaves the rest, audits before/after (scenario 1)", async () => {
    const { caller, id } = await withContact();
    const r = await inTenant(caller, (tx) =>
      contacts.updatePartnerContact(tx, caller, realAudit(tx, caller), { id, role: "CDO" }),
    );
    expect(r.data).toMatchObject({
      name: "Anne Muster",
      role: "CDO",
      email: "anne@vaudoise.ch",
      phone: "+41 21 618 80 80",
    });
    await assertAuditLogged(adminPool, caller.tenantId, "update", "partner_contact", id);
    const audit = await adminPool.query(
      "SELECT old_data, new_data FROM audit_logs WHERE entity_id = $1 AND action = 'update'",
      [id],
    );
    expect(audit.rows[0].old_data.role).toBe("Head of BI");
    expect(audit.rows[0].new_data.role).toBe("CDO");
  });

  it("clears the e-mail; the same validation applies on edit (scenario 2)", async () => {
    const { caller, id } = await withContact();
    const cleared = await inTenant(caller, (tx) =>
      contacts.updatePartnerContact(tx, caller, noopAudit, { id, email: "" }),
    );
    expect(cleared.data?.email).toBeNull();

    const bad = await inTenant(caller, (tx) =>
      contacts.updatePartnerContact(tx, caller, noopAudit, { id, email: "nope" }),
    );
    expect(bad.error?.code).toBe("VALIDATION_ERROR");
    const blank = await inTenant(caller, (tx) =>
      contacts.updatePartnerContact(tx, caller, noopAudit, { id, name: " " }),
    );
    expect(blank.error).toMatchObject({ code: "VALIDATION_ERROR", details: { field: "name" } });
  });

  it("deletes the contact and audits it (scenario 3)", async () => {
    const { caller, partnerId, id } = await withContact();
    const r = await inTenant(caller, (tx) =>
      contacts.deletePartnerContact(tx, caller, realAudit(tx, caller), id),
    );
    expect(r.data).toEqual({ id });
    await assertAuditLogged(adminPool, caller.tenantId, "delete", "partner_contact", id);
    const list = await inTenant(caller, (tx) => contacts.listPartnerContacts(tx, partnerId));
    expect(list.data).toHaveLength(0);
  });

  it("an unknown id is not found for edit and delete", async () => {
    const caller = await owner();
    const id = "00000000-0000-4000-8000-000000000000";
    await inTenant(caller, async (tx) => {
      const u = await contacts.updatePartnerContact(tx, caller, noopAudit, { id, role: "x" });
      expect(u.error?.code).toBe("NOT_FOUND");
      const d = await contacts.deletePartnerContact(tx, caller, noopAudit, id);
      expect(d.error?.code).toBe("NOT_FOUND");
    });
  });

  it("another tenant cannot see, edit or delete the contact, nor add to the partner (scenario 4)", async () => {
    const { caller, partnerId, id } = await withContact();
    const other = await owner();
    await inTenant(other, async (tx) => {
      const list = await contacts.listPartnerContacts(tx, partnerId);
      expect(list.data).toHaveLength(0);
      const u = await contacts.updatePartnerContact(tx, other, noopAudit, { id, role: "x" });
      expect(u.error?.code).toBe("NOT_FOUND");
      const d = await contacts.deletePartnerContact(tx, other, noopAudit, id);
      expect(d.error?.code).toBe("NOT_FOUND");
      const c = await contacts.createPartnerContact(tx, other, noopAudit, {
        partnerId,
        name: "Intruder",
      });
      expect(c.error?.code).toBe("NOT_FOUND");
    });
    const mine = await inTenant(caller, (tx) => contacts.listPartnerContacts(tx, partnerId));
    expect(mine.data?.map((c) => c.role)).toEqual(["Head of BI"]);
  });
});
