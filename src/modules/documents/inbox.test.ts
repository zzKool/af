// The inbox on the real database (specs/documents US4, T011 / T012): archive / restore / OCR re-run with their
// refusals and audit rows, and `listInbox` — states, twins, tabs, search, counts that ignore the filters, the
// accountant's financial-only view — all under RLS.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuditEntry } from "@/kernel/audit/audit";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { createTestClock } from "@/kernel/clock/clock";
import { prisma } from "@/kernel/db/client";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createTestDocument,
  createTestTenant,
  createTestUser,
} from "@/kernel/db/test-fixtures";
import {
  ARCHIVE_BULK_MAX,
  archiveDocuments,
  prepareOcrRerun,
  unarchiveDocuments,
} from "./documents";
import { inboxOpenCount, listInbox } from "./queries";

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

const NOW = new Date("2026-03-14T15:00:00Z");
const clock = createTestClock(NOW);
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

let adminPool: Pool;
let tenantId: string;
let owner: CallerIdentity;
let accountant: CallerIdentity;

const run = <T>(
  caller: CallerIdentity,
  fn: (tx: TransactionClient, audit: AuditLogger) => Promise<T>,
) =>
  withTenantTransaction(prisma, caller.tenantId, (tx) =>
    fn(tx, { log: (params) => createAuditEntry(tx, caller, params).then(() => undefined) }),
  );

const make = (over: Parameters<typeof createTestDocument>[3]) =>
  createTestDocument(adminPool, tenantId, owner.userId, over);

async function setDoc(id: string, sql: string, params: unknown[] = []) {
  await adminPool.query(`UPDATE documents SET ${sql} WHERE id = $1`, [id, ...params]);
}

async function became(documentId: string) {
  await adminPool.query(
    `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
     VALUES ($1, 'expense', gen_random_uuid(), 'document', $2, 'created_from', $3)`,
    [tenantId, documentId, owner.userId],
  );
}

async function docRow(id: string) {
  const r = await adminPool.query(
    `SELECT status, archived_at, archived_by, reviewed_at, corrections FROM documents WHERE id = $1`,
    [id],
  );
  return r.rows[0];
}

async function auditEvents(id: string): Promise<string[]> {
  const r = await adminPool.query(
    `SELECT new_data->>'event' AS event FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`,
    [id],
  );
  return r.rows.map((x) => x.event);
}

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  tenantId = (await createTestTenant(adminPool)).id;
  const userId = (await createTestUser(adminPool)).id;
  owner = { userId, tenantId, role: "owner", source: "web" };
  accountant = { userId, tenantId, role: "accountant", source: "web" };
});

describe("archiveDocuments", () => {
  it("parks inbox rows, refuses what is not one, reports per id and audits each archive", async () => {
    const uploaded = await make({ status: "uploaded" });
    const ready = await make({ status: "extracted" });
    const madeInto = await make({ status: "extracted" });
    await became(madeInto.id);
    const filed = await make({ status: "extracted" });
    await setDoc(filed.id, "reviewed_at = now()");
    const generated = await make({ status: "generated" });
    const missing = "00000000-0000-4000-8000-000000000000";

    const r = await run(owner, (tx, audit) =>
      archiveDocuments(tx, owner, audit, clock, [
        uploaded.id,
        ready.id,
        madeInto.id,
        filed.id,
        generated.id,
        missing,
      ]),
    );
    expect(r.error).toBeUndefined();
    expect(r.data).toEqual([
      { id: uploaded.id, outcome: "archived" },
      { id: ready.id, outcome: "archived" },
      { id: madeInto.id, outcome: "refused", reason: "not_inbox" },
      { id: filed.id, outcome: "refused", reason: "not_inbox" },
      { id: generated.id, outcome: "refused", reason: "not_inbox" },
      { id: missing, outcome: "missing" },
    ]);

    const parked = await docRow(ready.id);
    expect(parked.archived_at).toEqual(NOW);
    expect(parked.archived_by).toBe(owner.userId);
    expect(parked.status).toBe("extracted");
    expect((await docRow(madeInto.id)).archived_at).toBeNull();
    expect(await auditEvents(ready.id)).toEqual(["archive"]);
    expect(await auditEvents(madeInto.id)).toEqual([]);
  });

  it("refuses an already archived row (archive is not a toggle)", async () => {
    const doc = await make({ status: "extracted" });
    await run(owner, (tx, audit) => archiveDocuments(tx, owner, audit, clock, [doc.id]));
    const again = await run(owner, (tx, audit) =>
      archiveDocuments(tx, owner, audit, clock, [doc.id]),
    );
    expect(again.data).toEqual([{ id: doc.id, outcome: "refused", reason: "not_inbox" }]);
  });

  it("takes 1 to 50 ids and only from the owner", async () => {
    const doc = await make({ status: "extracted" });
    const tooMany = Array.from(
      { length: ARCHIVE_BULK_MAX + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const big = await run(owner, (tx, audit) => archiveDocuments(tx, owner, audit, clock, tooMany));
    expect(big.error?.code).toBe("VALIDATION_ERROR");
    const none = await run(owner, (tx, audit) => archiveDocuments(tx, owner, audit, clock, []));
    expect(none.error?.code).toBe("VALIDATION_ERROR");
    const denied = await run(accountant, (tx, audit) =>
      archiveDocuments(tx, accountant, audit, clock, [doc.id]),
    );
    expect(denied.error?.code).toBe("FORBIDDEN");
    expect((await docRow(doc.id)).archived_at).toBeNull();
  });
});

describe("unarchiveDocuments", () => {
  it("clears only the flag — status, review mark and corrections stay — and refuses a live row", async () => {
    const parked = await make({ status: "extracted" });
    await setDoc(parked.id, "corrections = $2::jsonb", [JSON.stringify({ vendorName: "SBB" })]);
    const live = await make({ status: "uploaded" });
    await run(owner, (tx, audit) => archiveDocuments(tx, owner, audit, clock, [parked.id]));
    const before = await docRow(parked.id);

    const r = await run(owner, (tx, audit) =>
      unarchiveDocuments(tx, owner, audit, [parked.id, live.id]),
    );
    expect(r.data).toEqual([
      { id: parked.id, outcome: "restored" },
      { id: live.id, outcome: "refused", reason: "not_archived" },
    ]);
    const after = await docRow(parked.id);
    expect(after.archived_at).toBeNull();
    expect(after.archived_by).toBeNull();
    expect(after.status).toBe(before.status);
    expect(after.reviewed_at).toEqual(before.reviewed_at);
    expect(after.corrections).toEqual({ vendorName: "SBB" });
    expect(await auditEvents(parked.id)).toEqual(["archive", "restore"]);
  });

  it("is the owner's", async () => {
    const doc = await make({ status: "extracted" });
    const r = await run(accountant, (tx, audit) =>
      unarchiveDocuments(tx, accountant, audit, [doc.id]),
    );
    expect(r.error?.code).toBe("FORBIDDEN");
  });
});

describe("prepareOcrRerun", () => {
  it("sends a failed row back to uploaded, audited", async () => {
    const doc = await make({ status: "ocr_failed" });
    const r = await run(owner, (tx, audit) => prepareOcrRerun(tx, owner, audit, clock, doc.id));
    expect(r.data).toEqual({ id: doc.id, previousStatus: "ocr_failed" });
    expect((await docRow(doc.id)).status).toBe("uploaded");
    expect(await auditEvents(doc.id)).toEqual(["ocr_rerun"]);
  });

  it("re-runs a stuck row (processing > 5 min), refuses a fresh one", async () => {
    const stuck = await make({ status: "processing" });
    await setDoc(stuck.id, "updated_at = $2", [new Date(NOW.getTime() - 6 * 60_000)]);
    const fresh = await make({ status: "processing" });
    await setDoc(fresh.id, "updated_at = $2", [new Date(NOW.getTime() - 60_000)]);

    const ok = await run(owner, (tx, audit) => prepareOcrRerun(tx, owner, audit, clock, stuck.id));
    expect(ok.data?.previousStatus).toBe("processing");
    expect((await docRow(stuck.id)).status).toBe("uploaded");

    const no = await run(owner, (tx, audit) => prepareOcrRerun(tx, owner, audit, clock, fresh.id));
    expect(no.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect((await docRow(fresh.id)).status).toBe("processing");
  });

  it("re-runs a completed row only with force, its corrections kept", async () => {
    const doc = await make({ status: "extracted" });
    await setDoc(doc.id, "corrections = $2::jsonb", [JSON.stringify({ invoiceTotal: 42 })]);

    const refused = await run(owner, (tx, audit) =>
      prepareOcrRerun(tx, owner, audit, clock, doc.id),
    );
    expect(refused.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    expect((await docRow(doc.id)).status).toBe("extracted");

    const forced = await run(owner, (tx, audit) =>
      prepareOcrRerun(tx, owner, audit, clock, doc.id, { force: true }),
    );
    expect(forced.data?.previousStatus).toBe("extracted");
    const after = await docRow(doc.id);
    expect(after.status).toBe("uploaded");
    expect(after.corrections).toEqual({ invoiceTotal: 42 });
  });

  it("is the owner's; an unknown id is NOT_FOUND", async () => {
    const doc = await make({ status: "ocr_failed" });
    const denied = await run(accountant, (tx, audit) =>
      prepareOcrRerun(tx, accountant, audit, clock, doc.id),
    );
    expect(denied.error?.code).toBe("FORBIDDEN");
    const missing = await run(owner, (tx, audit) =>
      prepareOcrRerun(tx, owner, audit, clock, "00000000-0000-4000-8000-000000000000"),
    );
    expect(missing.error?.code).toBe("NOT_FOUND");
  });
});

describe("listInbox", () => {
  async function seed() {
    const needsOcr = await make({ businessKey: "exp_20260301_001", status: "uploaded" });
    const failed = await make({ businessKey: "exp_20260302_001", status: "ocr_failed" });
    const stuck = await make({ businessKey: "exp_20260303_001", status: "processing" });
    await setDoc(stuck.id, "updated_at = $2", [new Date(NOW.getTime() - 10 * 60_000)]);
    const ready = await make({
      businessKey: "inv_20260304_001",
      fileName: "openai-march.pdf",
      prefixType: "invoice",
      status: "extracted",
      contentHash: HASH_A,
    });
    await setDoc(ready.id, "ocr_data = $2::jsonb, corrections = $3::jsonb, created_at = $4", [
      JSON.stringify({
        extractedData: {
          vendorName: "OpenAI LLC",
          invoiceTotal: 20,
          currency: "USD",
          invoiceDate: "2026-03-04",
        },
        quality: "high",
      }),
      JSON.stringify({ vendorName: "OpenAI" }),
      new Date("2026-03-04T10:00:00Z"),
    ]);
    // the same bytes again, younger: a twin of `ready`
    const twin = await make({
      businessKey: "inv_20260305_001",
      prefixType: "invoice",
      status: "extracted",
      contentHash: HASH_A,
    });
    await setDoc(twin.id, "created_at = $2", [new Date("2026-03-05T10:00:00Z")]);
    const parked = await make({ businessKey: "exp_20260306_001", status: "extracted" });
    await setDoc(parked.id, "archived_at = now(), archived_by = $2", [owner.userId]);
    const madeInto = await make({ businessKey: "exp_20260307_001", status: "extracted" });
    await became(madeInto.id);
    const filed = await make({ businessKey: "exp_20260308_001", status: "extracted" });
    await setDoc(filed.id, "reviewed_at = now()");
    await make({ businessKey: "InvoiceAF_VA26-INV-001.pdf", status: "generated" });
    const contract = await make({
      businessKey: "ctrt_20260309_001",
      prefixType: "contract",
      documentType: "relationship",
      status: "extracted",
    });
    const otherTenant = (await createTestTenant(adminPool)).id;
    await createTestDocument(adminPool, otherTenant, owner.userId, { businessKey: "foreign" });
    return { needsOcr, failed, stuck, ready, twin, parked, madeInto, filed, contract };
  }

  it("derives the state of every inbox row; became, filed and generated are out", async () => {
    const d = await seed();
    const r = await run(owner, (tx) => listInbox(tx, owner, { now: NOW }));
    const state = Object.fromEntries(r.rows.map((x) => [x.id, x.state]));
    expect(state).toEqual({
      [d.needsOcr.id]: "needs_ocr",
      [d.failed.id]: "ocr_failed",
      [d.stuck.id]: "stuck",
      [d.ready.id]: "ready",
      [d.twin.id]: "ready",
      [d.contract.id]: "ready",
    });
    expect(r.counts).toEqual({ pending: 3, ready: 3, duplicates: 2, archived: 1, total: 6 });
  });

  it("gives the facts as corrected and the oldest twin as *duplicate of*", async () => {
    const d = await seed();
    const r = await run(owner, (tx) => listInbox(tx, owner, { now: NOW }));
    const ready = r.rows.find((x) => x.id === d.ready.id);
    expect(ready).toMatchObject({
      vendor: "OpenAI",
      amount: "20.00",
      currency: "USD",
      documentDate: "2026-03-04",
      quality: "high",
      hasTwin: true,
      duplicateOf: null,
    });
    const twin = r.rows.find((x) => x.id === d.twin.id);
    expect(twin?.duplicateOf).toEqual({ id: d.ready.id, businessKey: "inv_20260304_001" });
  });

  it("FR-011: a twin of a generated PDF counts — the forced upload of an issued invoice's copy is captioned", async () => {
    const issued = await make({
      businessKey: "InvoiceAF_VA26-INV-007.pdf",
      prefixType: "invoice",
      status: "generated",
      contentHash: HASH_B,
    });
    await setDoc(issued.id, "created_at = $2", [new Date("2026-03-01T10:00:00Z")]);
    const copy = await make({
      businessKey: "inv_20260310_001",
      prefixType: "invoice",
      status: "extracted",
      contentHash: HASH_B,
    });
    const r = await run(owner, (tx) => listInbox(tx, owner, { now: NOW }));
    expect(r.rows.map((x) => x.id)).toEqual([copy.id]); // the generated PDF is never an inbox row
    expect(r.rows[0]).toMatchObject({
      hasTwin: true,
      duplicateOf: { id: issued.id, businessKey: "InvoiceAF_VA26-INV-007.pdf" },
    });
    expect(r.counts.duplicates).toBe(1);
  });

  it("filters by tab and search while the counts stay those of the whole inbox", async () => {
    const d = await seed();
    const ids = async (opts: Parameters<typeof listInbox>[2]) => {
      const r = await run(owner, (tx) => listInbox(tx, owner, { now: NOW, ...opts }));
      expect(r.counts.total).toBe(6);
      return r.rows.map((x) => x.id).sort();
    };
    expect(await ids({ tab: "pending" })).toEqual([d.needsOcr.id, d.failed.id, d.stuck.id].sort());
    expect(await ids({ tab: "ready" })).toEqual([d.ready.id, d.twin.id, d.contract.id].sort());
    expect(await ids({ tab: "duplicates" })).toEqual([d.ready.id, d.twin.id].sort());
    expect(await ids({ tab: "archived" })).toEqual([d.parked.id]);
    // search on the key, the file name and the vendor as corrected
    expect(await ids({ q: "20260301" })).toEqual([d.needsOcr.id]);
    expect(await ids({ q: "OPENAI-MARCH" })).toEqual([d.ready.id]);
    expect(await ids({ tab: "ready", q: "openai" })).toEqual([d.ready.id]);
    expect(await ids({ q: "nothing like it" })).toEqual([]);
  });

  it("restoring brings a row back in its pipeline state", async () => {
    const d = await seed();
    await run(owner, (tx, audit) => unarchiveDocuments(tx, owner, audit, [d.parked.id]));
    const r = await run(owner, (tx) => listInbox(tx, owner, { now: NOW }));
    expect(r.rows.find((x) => x.id === d.parked.id)?.state).toBe("ready");
    expect(r.counts.archived).toBe(0);
  });

  it("shows the accountant financial documents only", async () => {
    const d = await seed();
    const r = await run(accountant, (tx) => listInbox(tx, accountant, { now: NOW }));
    expect(r.rows.map((x) => x.id)).not.toContain(d.contract.id);
    expect(r.counts).toEqual({ pending: 3, ready: 2, duplicates: 2, archived: 1, total: 5 });
  });

  it("F72: the sidebar's cheap count is the inbox's total, for each role", async () => {
    await seed();
    expect(await run(owner, (tx) => inboxOpenCount(tx, owner, NOW))).toBe(6);
    expect(await run(accountant, (tx) => inboxOpenCount(tx, accountant, NOW))).toBe(5);
  });
});
