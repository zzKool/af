// F94 (specs/subscriptions T015): `inboxFinancialFacts` — the subscriptions module's receipt / bill candidates: the
// inbox's own rule, the OCR facts as corrected on review. Real database, RLS on; invented facts.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { withTenantTransaction } from "@/kernel/db/tenant-client";
import {
  cleanupTestData,
  createAuthenticatedContext,
  createTestDocument,
} from "@/kernel/db/test-fixtures";
import { inboxFinancialFacts } from "./queries";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let owner: CallerIdentity;

beforeAll(() => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  owner = (await createAuthenticatedContext(auth, "owner")).callerIdentity;
});
afterAll(async () => {
  await adminPool.end();
});

async function doc(
  facts: Record<string, unknown>,
  o: { corrections?: object; status?: string; documentType?: string } = {},
) {
  const d = await createTestDocument(adminPool, owner.tenantId, owner.userId, {
    status: o.status ?? "extracted",
    documentType: o.documentType ?? "financial",
  });
  await adminPool.query(
    `UPDATE documents SET ocr_data = $1::jsonb, corrections = $2::jsonb WHERE id = $3`,
    [
      JSON.stringify({ extractedData: facts, quality: "good" }),
      o.corrections ? JSON.stringify(o.corrections) : null,
      d.id,
    ],
  );
  return d.id;
}
const read = (q: Parameters<typeof inboxFinancialFacts>[2]) =>
  withTenantTransaction(prisma, owner.tenantId, (tx) => inboxFinancialFacts(tx, owner, q));

describe("inboxFinancialFacts", () => {
  it("dated inside the window by the OCR date; the corrections win; an unknown currency is null", async () => {
    const a = await doc(
      {
        merchantName: "Byteform AB",
        transactionDate: "2026-10-15",
        invoiceTotal: 199,
        currency: "SEK",
      },
      { corrections: { invoiceTotal: 198.5 } },
    );
    await doc({
      merchantName: "Early",
      transactionDate: "2026-10-04",
      invoiceTotal: 1,
      currency: "SEK",
    });
    const b = await doc({
      vendorName: "Siffra AB",
      vendorTaxId: "SE1",
      invoiceNumber: "4711",
      invoiceDate: "2026-10-25",
      invoiceTotal: 1500,
      totalTax: 300,
      subtotal: 1200,
      currency: "XYZ",
    });
    await doc({ merchantName: "Undated", invoiceTotal: 5 });
    const rows = await read({ from: "2026-10-05", to: "2026-10-25" });
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect([...byId.keys()].sort()).toEqual([a, b].sort());
    expect(byId.get(a)).toMatchObject({
      vendorName: "Byteform AB",
      total: "198.50",
      currency: "SEK",
      date: "2026-10-15",
    });
    expect(byId.get(b)).toMatchObject({
      vendorName: "Siffra AB",
      vendorVatNumber: "SE1",
      invoiceNumber: "4711",
      total: "1500.00",
      tax: "300.00",
      subtotal: "1200.00",
      currency: null,
    });
  });

  it("by id, whatever the date; a generated or relationship document is never offered", async () => {
    const undated = await doc({ merchantName: "Undated", invoiceTotal: 5 });
    const generated = await doc(
      { merchantName: "G", transactionDate: "2026-10-15" },
      { status: "generated" },
    );
    const contract = await doc(
      { vendorName: "C", invoiceDate: "2026-10-15" },
      { documentType: "relationship" },
    );
    expect((await read({ ids: [undated] })).map((r) => r.id)).toEqual([undated]);
    expect(await read({ ids: [generated, contract] })).toEqual([]);
    expect(await read({ ids: [] })).toEqual([]);
  });
});
