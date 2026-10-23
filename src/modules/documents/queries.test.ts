// The library's ListQuery contract on the real database (D20): the role base (financial only for the accountant),
// every filter kind on stored and derived columns (the OCR facts as corrected, `linked`), search, distinct values
// with Excel semantics, the date hierarchy — all under RLS.
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
import type { ListQuery } from "@/kernel/list-query/types";
import { registerLinkable } from "@/modules/linking";
import { getDocuments } from "./library";
import { distinctDocumentValues, documentDateHierarchy, listDocuments, listInbox } from "./queries";

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";

let adminPool: Pool;
let tenantId: string;
let owner: CallerIdentity;
let accountant: CallerIdentity;
let ids: Record<string, string>;
const becameExpenseId = crypto.randomUUID();

const q = (over: Partial<ListQuery> = {}): ListQuery => ({
  page: 1,
  pageSize: 25,
  sort: [],
  filters: {},
  ...over,
});
const run = <T>(caller: CallerIdentity, fn: Parameters<typeof withTenantTransaction<T>>[2]) =>
  withTenantTransaction(prisma, caller.tenantId, fn);

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  // the expense the receipt became stands in for the expenses module: its summary gives the key (FR-005)
  registerLinkable({
    type: "expense",
    exists: async (_tx, id) => id === becameExpenseId,
    summary: async (_tx, id) =>
      id === becameExpenseId
        ? {
            type: "expense",
            id,
            label: "Ex213-Tr-04 · 2026-03-10 · 120.50 CHF · SBB",
            amount: null,
            currency: null,
          }
        : null,
  });
});
afterAll(async () => {
  await cleanupTestData(adminPool);
  await adminPool.end();
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  tenantId = (await createTestTenant(adminPool)).id;
  const otherTenant = (await createTestTenant(adminPool)).id;
  const userId = (await createTestUser(adminPool)).id;
  owner = { userId, tenantId, role: "owner", source: "web" };
  accountant = { userId, tenantId, role: "accountant", source: "web" };
  const make = (over: Parameters<typeof createTestDocument>[3]) =>
    createTestDocument(adminPool, tenantId, userId, over);
  const receipt = await make({
    businessKey: "exp_20260310_001",
    fileName: "sbb.pdf",
    prefixType: "expense",
    status: "extracted",
    fileSize: 2048,
  });
  const invoice = await make({
    businessKey: "inv_20260312_001",
    fileName: "openai.pdf",
    prefixType: "invoice",
    status: "extracted",
    fileSize: 4096,
  });
  const contract = await make({
    businessKey: "ctrt_20260101_001",
    fileName: "contract.pdf",
    prefixType: "contract",
    documentType: "relationship",
    status: "uploaded",
    fileSize: 100_000,
  });
  const generated = await make({
    businessKey: "InvoiceAF_VA26-INV-001.pdf",
    fileName: "InvoiceAF_VA26-INV-001.pdf",
    prefixType: "invoice",
    status: "generated",
    fileSize: 30_000,
  });
  await createTestDocument(adminPool, otherTenant, userId, { businessKey: "foreign" });
  // OCR facts on the receipt (corrected vendor), on the invoice (as extracted)
  await adminPool.query(
    `UPDATE documents SET ocr_data = $2::jsonb, corrections = $3::jsonb, reviewed_at = now() WHERE id = $1`,
    [
      receipt.id,
      JSON.stringify({
        extractedData: {
          vendorName: "SBB CFF",
          invoiceTotal: 120.5,
          currency: "CHF",
          invoiceDate: "2026-03-10",
        },
      }),
      JSON.stringify({ vendorName: "SBB" }),
    ],
  );
  await adminPool.query(`UPDATE documents SET ocr_data = $2::jsonb WHERE id = $1`, [
    invoice.id,
    JSON.stringify({
      extractedData: {
        vendorName: "OpenAI",
        invoiceTotal: 20,
        currency: "USD",
        invoiceDate: "2026-03-12",
      },
    }),
  ]);
  // the receipt became an expense (created_from) → linked
  await adminPool.query(
    `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
     VALUES ($1, 'expense', $4, 'document', $2, 'created_from', $3)`,
    [tenantId, receipt.id, userId, becameExpenseId],
  );
  ids = {
    receipt: receipt.id,
    invoice: invoice.id,
    contract: contract.id,
    generated: generated.id,
  };
});

describe("listDocuments", () => {
  it("the owner sees everything, newest first, with the OCR facts as corrected and `linked`", async () => {
    const r = await run(owner, (tx) => listDocuments(tx, owner, q()));
    expect(r.total).toBe(4);
    const receipt = r.rows.find((d) => d.id === ids.receipt);
    expect(receipt).toMatchObject({
      vendor: "SBB",
      amount: "120.50",
      currency: "CHF",
      documentDate: "2026-03-10",
      linked: true,
      status: "extracted",
    });
    expect(r.rows.find((d) => d.id === ids.invoice)).toMatchObject({
      vendor: "OpenAI",
      amount: "20.00",
      linked: false,
    });
    expect(r.rows.find((d) => d.id === ids.contract)).toMatchObject({
      vendor: null,
      amount: null,
      documentType: "relationship",
    });
  });

  it("FR-005: a row says what the document became, with the entity's key; a justified-only document is linked, became nothing", async () => {
    await adminPool.query(
      `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
       VALUES ($1, 'bank_transaction', gen_random_uuid(), 'document', $2, 'justifies', $3)`,
      [tenantId, ids.invoice, owner.userId],
    );
    const r = await run(owner, (tx) => listDocuments(tx, owner, q()));
    expect(r.rows.find((d) => d.id === ids.receipt)?.became).toEqual({
      type: "expense",
      id: becameExpenseId,
      key: "Ex213-Tr-04",
      label: "Ex213-Tr-04 · 2026-03-10 · 120.50 CHF · SBB",
    });
    expect(r.rows.find((d) => d.id === ids.invoice)).toMatchObject({ linked: true, became: null });
    expect(r.rows.find((d) => d.id === ids.contract)).toMatchObject({
      linked: false,
      became: null,
    });
  });

  it("F71: each row carries the inbox's state on the same facts — became / filed out, justified-only still ready, parked archived", async () => {
    await adminPool.query(
      `INSERT INTO links (tenant_id, from_type, from_id, to_type, to_id, kind, created_by)
       VALUES ($1, 'bank_transaction', gen_random_uuid(), 'document', $2, 'justifies', $3)`,
      [tenantId, ids.invoice, owner.userId],
    );
    await adminPool.query(`UPDATE documents SET archived_at = now() WHERE id = $1`, [ids.contract]);
    const r = await run(owner, (tx) => listDocuments(tx, owner, q()));
    const stateOf = (id: string) => r.rows.find((d) => d.id === id)?.state;
    expect(stateOf(ids.receipt)).toBe("filed");
    expect(stateOf(ids.invoice)).toBe("ready"); // FR-016: a bank row justifies it, the decision is still open
    expect(stateOf(ids.contract)).toBe("archived");
    expect(stateOf(ids.generated)).toBe("generated");
    // the facts the state reads stay in the read model
    expect(r.rows[0]).not.toHaveProperty("archivedAt");
    expect(r.rows[0]).not.toHaveProperty("updatedAt");
  });

  it("the accountant sees financial documents only — on the list, the distinct values and the hierarchy", async () => {
    const r = await run(accountant, (tx) => listDocuments(tx, accountant, q()));
    expect(r.total).toBe(3);
    expect(r.rows.every((d) => d.documentType === "financial")).toBe(true);
    const types = await run(accountant, (tx) =>
      distinctDocumentValues(tx, accountant, "documentType", q()),
    );
    expect(types).toEqual([{ value: "financial", count: 3 }]);
    const dates = await run(accountant, (tx) =>
      documentDateHierarchy(tx, accountant, "createdAt", q()),
    );
    expect(dates.years[0]?.count).toBe(3);
  });

  it("filters: enum on a stored column, boolean on a derived one, money range, text, dates; search over key / file / vendor", async () => {
    const byStatus = await run(owner, (tx) =>
      listDocuments(tx, owner, q({ filters: { status: { kind: "in", values: ["extracted"] } } })),
    );
    expect(byStatus.rows.map((d) => d.fileName).sort()).toEqual(["openai.pdf", "sbb.pdf"]);
    const unlinked = await run(owner, (tx) =>
      listDocuments(tx, owner, q({ filters: { linked: { kind: "in", values: ["false"] } } })),
    );
    expect(unlinked.rows.map((d) => d.id).sort()).toEqual(
      [ids.invoice, ids.contract, ids.generated].sort(),
    );
    const bigAmounts = await run(owner, (tx) =>
      listDocuments(tx, owner, q({ filters: { amount: { kind: "range", min: "100" } } })),
    );
    expect(bigAmounts.rows.map((d) => d.id)).toEqual([ids.receipt]);
    const noAmount = await run(owner, (tx) =>
      listDocuments(tx, owner, q({ filters: { amount: { kind: "range", empty: true } } })),
    );
    expect(noAmount.total).toBe(2);
    const vendor = await run(owner, (tx) =>
      listDocuments(
        tx,
        owner,
        q({ filters: { vendor: { kind: "text", op: "startsWith", value: "sb" } } }),
      ),
    );
    expect(vendor.rows.map((d) => d.id)).toEqual([ids.receipt]);
    const march = await run(owner, (tx) =>
      listDocuments(
        tx,
        owner,
        q({ filters: { documentDate: { kind: "dates", months: ["2026-03"] } } }),
      ),
    );
    expect(march.total).toBe(2);
    const search = await run(owner, (tx) => listDocuments(tx, owner, q({ search: "openai" })));
    expect(search.rows.map((d) => d.id)).toEqual([ids.invoice]);
    const bySize = await run(owner, (tx) =>
      listDocuments(tx, owner, q({ sort: [{ col: "fileSize", dir: "desc" }], pageSize: 2 })),
    );
    expect(bySize.rows.map((d) => d.fileSize)).toEqual([100_000, 30_000]);
    expect(bySize.total).toBe(4);
  });

  it("distinct values follow Excel semantics: the other filters apply, the column's own does not", async () => {
    const statuses = await run(owner, (tx) =>
      distinctDocumentValues(
        tx,
        owner,
        "status",
        q({
          filters: {
            status: { kind: "in", values: ["generated"] },
            prefixType: { kind: "in", values: ["invoice"] },
          },
        }),
      ),
    );
    expect(statuses).toEqual([
      { value: "extracted", count: 1 },
      { value: "generated", count: 1 },
    ]);
    const linked = await run(owner, (tx) => distinctDocumentValues(tx, owner, "linked", q()));
    expect(linked).toEqual([
      { value: "false", count: 3 },
      { value: "true", count: 1 },
    ]);
    const vendors = await run(owner, (tx) => distinctDocumentValues(tx, owner, "vendor", q()));
    expect(vendors).toEqual([
      { value: null, count: 2 },
      { value: "OpenAI", count: 1 },
      { value: "SBB", count: 1 },
    ]);
  });
});

describe("a stored correction that does not fit its field (lessons audit 11)", () => {
  it("the row still lists in the library, the inbox and the paged list, with the OCR value", async () => {
    // a null total and a number for a currency — what the old `record(string, json)` action let through
    await adminPool.query(`UPDATE documents SET corrections = $2::jsonb WHERE id = $1`, [
      ids.invoice,
      JSON.stringify({ invoiceTotal: null, currency: 42, vendorName: "OpenAI Ireland" }),
    ]);

    const library = await run(owner, (tx) => listDocuments(tx, owner, q()));
    expect(library.rows.find((d) => d.id === ids.invoice)).toMatchObject({
      vendor: "OpenAI Ireland",
      amount: "20.00",
      currency: "USD",
    });

    const inbox = await run(owner, (tx) => listInbox(tx, owner));
    expect(inbox.rows.find((d) => d.id === ids.invoice)).toMatchObject({
      vendor: "OpenAI Ireland",
      amount: "20.00",
    });

    const paged = await run(owner, (tx) =>
      getDocuments(
        tx,
        owner,
        {},
        { field: "createdAt", direction: "desc" },
        {
          page: 1,
          pageSize: 25,
        },
      ),
    );
    expect(paged.data?.items.find((d) => d.id === ids.invoice)).toMatchObject({
      extractedAmount: 20,
    });
  });
});
