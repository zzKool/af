// The subscriptions tests' world (F94), on top of the expenses harness's owner (the tests set it up): a vendor,
// September–October 2026 EUR rates, receipts with OCR facts, a subscription. Invented values only (D51).
import type { Pool } from "pg";
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { type TransactionClient, withTenantTransaction } from "@/kernel/db/tenant-client";
import { createTestDocument, createTestPartner } from "@/kernel/db/test-fixtures";
import { createSubscription, type SubscriptionInput } from "../subscriptions";

export const TODAY = "2026-10-26";

// the expenses harness's two helpers, restated (a fixture outside a test file may import surfaces only)
const noopAudit: AuditLogger = { log: async () => {} };
const run = <T>(caller: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, caller.tenantId, fn);

/** EUR/SEK 11.50 and EUR/CHF 0.95 every day of September–October 2026. */
export async function seedOctoberRates(adminPool: Pool): Promise<void> {
  for (let d = new Date("2026-09-01T00:00:00Z"); d <= new Date("2026-10-31T00:00:00Z"); ) {
    const day = d.toISOString().slice(0, 10);
    for (const [pair, rate] of [
      ["EUR/SEK", "11.50"],
      ["EUR/CHF", "0.95"],
    ] as const) {
      await adminPool.query(
        `INSERT INTO ecb_rates (date, currency_pair, rate) SELECT $1::date, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM ecb_rates WHERE date = $1::date AND currency_pair = $2)`,
        [day, pair, rate],
      );
    }
    d = new Date(d.getTime() + 86_400_000);
  }
}

export async function vendor(
  adminPool: Pool,
  caller: CallerIdentity,
  name: string,
  vatNumber?: string,
): Promise<string> {
  const p = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
    name,
    types: ["vendor"],
  });
  if (vatNumber)
    await adminPool.query("UPDATE partners SET vat_number = $1 WHERE id = $2", [vatNumber, p.id]);
  return p.id;
}

/** A receipt / bill in the inbox with the OCR facts given (as Azure's mapping stores them). */
export async function inboxDocument(
  adminPool: Pool,
  caller: CallerIdentity,
  facts: Record<string, unknown>,
  prefixType: "expense" | "invoice" = "expense",
): Promise<string> {
  const doc = await createTestDocument(adminPool, caller.tenantId, caller.userId, {
    prefixType,
    status: "extracted",
  });
  await adminPool.query(`UPDATE documents SET ocr_data = $1::jsonb WHERE id = $2`, [
    JSON.stringify({ extractedData: facts, quality: "good" }),
    doc.id,
  ]);
  return doc.id;
}

export async function subscription(
  caller: CallerIdentity,
  input: SubscriptionInput,
): Promise<string> {
  const r = await run(caller, (tx) => createSubscription(tx, caller, noopAudit, input));
  if (r.error) throw new Error(`subscription: ${r.error.message}`);
  return r.data.id;
}
