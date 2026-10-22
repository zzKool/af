// What documents hand the matcher, on the real database (F61, lessons audit 9–11): the receipt's currency as the
// owner corrected it, the corrections read through their schema, and "linked" derived from the links.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createTestDocument,
  createTestTenant,
  createTestUser,
} from "@/kernel/db/test-fixtures";
import { type RowFacts, scoreMatch } from "@/modules/linking";
import { documentLinkable, isDocumentLinked, unlinkedIds } from "./linkable";

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

let adminPool: Pool;
let owner: CallerIdentity;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  const tenantId = (await createTestTenant(adminPool)).id;
  const userId = (await createTestUser(adminPool)).id;
  owner = { userId, tenantId, role: "owner", source: "web" };
});

const run = <T>(fn: Parameters<typeof withTenantTransaction<T>>[2]) =>
  withTenantTransaction(prisma, owner.tenantId, fn);

/** A receipt as OCR leaves it — prebuilt-receipt reads no currency — plus the owner's corrections. */
async function receipt(corrections: unknown): Promise<string> {
  const doc = await createTestDocument(adminPool, owner.tenantId, owner.userId, {
    status: "extracted",
    prefixType: "expense",
  });
  await adminPool.query(
    `UPDATE documents SET ocr_data = $2::jsonb, corrections = $3::jsonb WHERE id = $1`,
    [
      doc.id,
      JSON.stringify({
        extractedData: {
          merchantName: "SBB CFF",
          invoiceTotal: 42.8,
          transactionDate: "2026-03-10",
          confidence: 0.9,
          modelUsed: "prebuilt-receipt",
          pageCount: 1,
          processingTimeMs: 10,
        },
      }),
      corrections === null ? null : JSON.stringify(corrections),
    ],
  );
  return doc.id;
}

async function link(kind: string, documentId: string, fromType = "expense"): Promise<void> {
  await adminPool.query(
    `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
     VALUES ($1, $2, gen_random_uuid(), 'document', $3, $4, $5)`,
    [owner.tenantId, fromType, documentId, kind, owner.userId],
  );
}

/** The document's facts as linking reads them (fails the test when there are none). */
async function factsOf(id: string) {
  const f = await run((tx) => documentLinkable.facts?.(tx, id) ?? Promise.resolve(null));
  if (!f) throw new Error(`no facts for ${id}`);
  return f;
}

const row = (currency: string, amount = "42.80"): RowFacts => ({
  amount,
  currency,
  amountBase: null,
  date: "2026-03-10",
  texts: ["Card purchase"],
});

describe("a receipt's currency", () => {
  it("a CHF receipt is scored as CHF: an exact amount against a CHF row, no amount against a SEK row", async () => {
    const id = await receipt({ currency: "CHF" });
    const facts = await factsOf(id);
    expect(facts).toMatchObject({ amount: "42.80", currency: "CHF" });
    const entity = { ...facts, remaining: facts.amount };

    const chf = scoreMatch(row("CHF"), entity);
    expect(chf?.crossCurrency).toBe(false);
    expect(chf?.reasons).toContain("Exact amount match");

    // the same digits in SEK are another amount: cross-currency, no base to compare, no reference → no match
    expect(scoreMatch(row("SEK"), entity)).toBeNull();
  });

  it("the label never claims a currency OCR did not read", async () => {
    const id = await receipt(null);
    const facts = await factsOf(id);
    expect(facts.label).toMatch(/· 42\.80$/);
  });
});

describe("corrections read through their schema", () => {
  it("a bad stored correction falls back to the OCR value instead of throwing", async () => {
    const id = await receipt({ invoiceTotal: null, currency: 42, vendorName: "SBB" });
    const facts = await factsOf(id);
    expect(facts).toMatchObject({ amount: "42.80", partnerName: "SBB" });
  });
});

describe("linked — derived from the links, never the stored status", () => {
  it("created_from and justifies make a document linked; belongs_to does not; the status is ignored", async () => {
    const became = await receipt(null);
    const justified = await receipt(null);
    const belongs = await receipt(null);
    const free = await receipt(null);
    await link("created_from", became);
    await link("justifies", justified, "bank_transaction");
    await adminPool.query(
      `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
       VALUES ($1, 'document', $2, 'partner', gen_random_uuid(), 'belongs_to', $3)`,
      [owner.tenantId, belongs, owner.userId],
    );
    // a stale "linked" status on a free document changes nothing
    await adminPool.query(`UPDATE documents SET status = 'linked' WHERE id = $1`, [free]);

    const unlinked = await run((tx) => unlinkedIds(tx, [became, justified, belongs, free]));
    expect([...unlinked].sort()).toEqual([belongs, free].sort());
    expect(await run((tx) => isDocumentLinked(tx, became))).toBe(true);
    expect(await run((tx) => isDocumentLinked(tx, free))).toBe(false);
  });
});
