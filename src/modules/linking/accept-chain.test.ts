// *When you accept* on real rows (F185): the chain of an inbox document — the kind, the partner match, the category
// (the partner's default when nothing was proposed), the month's group and the key peeked from its series, the best
// HIGH bank row that justifyRow can take; a new month group when none covers the date; an expense without its row
// needs the form (its payer); a filed document has no chain; and the click's payload goes through justifyRow as is.
// Invented facts (D51).
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimit } from "@/kernel/actions/rate-limit";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { cleanupTestData, createTestDocument } from "@/kernel/db/test-fixtures";
import { supplierPayload } from "@/modules/documents";
import * as expenses from "@/modules/expenses";
import {
  importRows,
  noopAudit,
  type Owner,
  realAudit,
  run,
  setupOwner,
} from "@/modules/expenses/__fixtures__/harness";
import * as partners from "@/modules/partners";
import * as settings from "@/modules/settings";
import { documentAcceptChain } from "./accept-chain";
import { justifyRow } from "./justify";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
let nordeaFormatId: string;
let owner: Owner;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
  const r = await adminPool.query(`SELECT id FROM bank_formats WHERE name = 'Nordea CSV (Sweden)'`);
  nordeaFormatId = r.rows[0].id;
});

beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  for (const date of ["2026-07-06", "2026-07-07", "2026-07-08"])
    await adminPool.query(
      `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES ($1, 'EUR/SEK', 11.6), ($1, 'EUR/CHF', 1)`,
      [date],
    );
  owner = await setupOwner(adminPool, nordeaFormatId);
});

afterAll(async () => {
  await adminPool.end();
});

const INVOICE = {
  vendorName: "Lindgren Kontorsservice AB",
  vendorTaxId: "SE559900112201",
  invoiceNumber: "30418",
  invoiceDate: "2026-07-06",
  invoiceTotal: 1297.2,
  subtotal: 1037.76,
  totalTax: 259.44,
  currency: "SEK",
  modelUsed: "prebuilt-invoice",
};

/** an inbox document read as `facts` */
async function readDoc(
  caller: CallerIdentity,
  facts: Record<string, unknown>,
  prefixType = "invoice",
) {
  const d = await createTestDocument(adminPool, caller.tenantId, caller.userId, {
    status: "extracted",
    prefixType,
  });
  await adminPool.query(`UPDATE documents SET ocr_data = $1::jsonb WHERE id = $2`, [
    JSON.stringify({ extractedData: facts, quality: "high" }),
    d.id,
  ]);
  return d.id;
}

/** the vendor (default 6540 · IT) and, optionally, July's group */
async function scene(caller: CallerIdentity, withGroup = true) {
  return run(caller, async (tx) => {
    await settings.activateBasCategories(tx, caller, noopAudit, ["6540"]);
    await settings.updateBasPreference(tx, caller, noopAudit, "6540", { shortCode: "IT" });
    const vendor = await partners.createPartner(tx, caller, noopAudit, {
      name: "Lindgren Kontorsservice AB",
      shortCode: "LKS",
      types: ["vendor"],
      vatNumber: "SE559900112201",
      defaultCurrency: "SEK",
      defaultBasCategoryCode: "6540",
    });
    const group = withGroup
      ? await expenses.createGroup(tx, caller, noopAudit, {
          description: "July 2026",
          month: "2026-07",
        })
      : null;
    if (vendor.error || group?.error) throw new Error("scene");
    return { vendorId: vendor.data?.id as string, group: group?.data ?? null };
  });
}

const chainOf = (caller: CallerIdentity, id: string) =>
  run(caller, (tx) => documentAcceptChain(tx, caller, id));

describe("documentAcceptChain (F185)", () => {
  it("creates · links · files: the match, the partner's category, the month's group, the key, the HIGH row", async () => {
    const caller = owner.caller;
    const s = await scene(caller);
    const [row] = await run(caller, (tx) =>
      importRows(tx, caller, owner.accounts.sek, "SEK", [
        {
          date: "2026-07-08",
          amount: "-1297.20",
          name: "LINDGREN KONTORSSERVICE",
          message: "30418",
        },
      ]),
    );
    const id = await readDoc(caller, INVOICE);

    const r = await chainOf(caller, id);
    expect(r.error).toBeUndefined();
    const c = r.data;
    expect(c).toMatchObject({
      documentId: id,
      kind: "supplier_invoice",
      vendor: "Lindgren Kontorsservice AB",
      partner: { id: s.vendorId, name: "Lindgren Kontorsservice AB" },
      category: { code: "6540", source: "partner" },
      group: { id: s.group?.id, number: s.group?.number, isNew: false },
      key: `SI${s.group?.number}-IT-01`,
      bankRow: { id: row, date: "2026-07-08", amount: "-1297.20", currency: "SEK" },
      fields: {
        invoiceNumber: "30418",
        date: "2026-07-06",
        currency: "SEK",
        amountTotal: "1297.20",
        vatAmount: "259.44",
        amountNet: "1037.76",
      },
      missing: [],
    });
    expect(c?.partner?.percent).toBeGreaterThanOrEqual(60);
    expect(c?.bankRow?.score).toBeGreaterThanOrEqual(80);

    // the click: the payload is justifyRow's own input — the key the chain showed is the one it gets
    const done = await run(caller, (tx) =>
      justifyRow(tx, caller, realAudit(tx, caller), {
        transactionId: row as string,
        documentId: id,
        kind: "supplier_invoice",
        supplier: supplierPayload(c as NonNullable<typeof c>, s.group?.id as string),
      }),
    );
    expect(done.error).toBeUndefined();
    expect(done.data?.entity.key).toBe(c?.key);
    // made: out of the inbox, no chain any more
    expect((await chainOf(caller, id)).data).toBeNull();
  });

  it("no group for the month: a new one, numbered by the group series; no open row: no link step", async () => {
    const caller = owner.caller;
    await scene(caller, false);
    const id = await readDoc(caller, INVOICE);
    const c = (await chainOf(caller, id)).data;
    expect(c?.group).toMatchObject({ id: null, isNew: true, month: "2026-07", name: "2026-07" });
    expect(c?.key).toBe(`SI${c?.group?.number}-IT-01`);
    expect(c?.bankRow).toBeNull();
    expect(c?.missing).toEqual([]);
  });

  it("an expense without its bank row needs the form (the payer); nothing matched, nothing proposed", async () => {
    const caller = owner.caller;
    const id = await readDoc(
      caller,
      {
        merchantName: "Kafé Solrosen",
        transactionDate: "2026-07-07",
        invoiceTotal: 84,
        currency: "SEK",
        modelUsed: "prebuilt-receipt",
      },
      "document",
    );
    const c = (await chainOf(caller, id)).data;
    expect(c?.kind).toBe("expense");
    expect(c?.partner).toBeNull();
    expect(c?.category).toBeNull();
    expect(c?.missing).toEqual(["category", "payer"]);
  });

  it("no chain for a document that is filed, or whose reading asks what it is", async () => {
    const caller = owner.caller;
    const filed = await readDoc(caller, INVOICE);
    await adminPool.query(`UPDATE documents SET reviewed_at = now() WHERE id = $1`, [filed]);
    expect((await chainOf(caller, filed)).data).toBeNull();
    const unread = await readDoc(
      caller,
      { vendorName: "Nobody", modelUsed: "prebuilt-invoice" },
      "document",
    );
    expect((await chainOf(caller, unread)).data).toBeNull();
  });
});
