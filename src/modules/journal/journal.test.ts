// Journal — specs/journal/spec.md US1–US4 against the real database (RLS on).
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
import * as linking from "@/modules/linking";
import * as journal from "./journal";
import { distinctJournalValues, listJournalEntries } from "./queries";

let mockHeaders: Headers = new Headers();
vi.mock("next/headers", () => ({ headers: vi.fn(async () => mockHeaders) }));

const noopAudit: AuditLogger = { log: async () => {} };
function realAudit(tx: TransactionClient, caller: CallerIdentity): AuditLogger {
  return { log: async (params) => createAuditEntry(tx, caller, params) };
}

const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;

beforeAll(async () => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
  await adminPool.query("TRUNCATE ecb_rates");
  resetRateLimit();
  mockHeaders = new Headers();
  // 1 CHF = 11.10 / 0.9328 = 11.899657 SEK on 2026-07-08; 1 EUR = 11.25 SEK on 2026-03-02 (Monday; the 1st is a Sunday)
  await adminPool.query(
    `INSERT INTO ecb_rates (date, currency_pair, rate) VALUES
       ('2026-07-08', 'EUR/SEK', '11.1000'), ('2026-07-08', 'EUR/CHF', '0.9328'),
       ('2026-07-07', 'EUR/SEK', '11.0000'), ('2026-07-07', 'EUR/CHF', '0.9300'),
       ('2026-03-02', 'EUR/SEK', '11.2500')`,
  );
});
afterAll(async () => {
  await adminPool.end();
});

const run = <T>(caller: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, caller.tenantId, fn);
const uuid = () => crypto.randomUUID();

describe("US1 — every bank row is a journal entry", () => {
  it("scenario 1: CHF at the ECB rate of the day, nearest weekday when the day has none, SEK at 1", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const ids = [uuid(), uuid(), uuid()];
    const r = await run(caller, (tx) =>
      journal.createBankEntries(tx, caller, realAudit(tx, caller), [
        {
          sourceId: ids[0],
          entryDate: "2026-07-08",
          description: "CHANGE CHFSEK",
          counterpartyKey: "CHANGE CHFSEK",
          amount: "-20000.00",
          currency: "CHF",
        },
        {
          sourceId: ids[1],
          entryDate: "2026-07-11",
          description: "Sat",
          counterpartyKey: "SAT",
          amount: "100.00",
          currency: "CHF",
        },
        {
          sourceId: ids[2],
          entryDate: "2026-07-08",
          description: "SEK row",
          counterpartyKey: "SEK",
          amount: "-132.52",
          currency: "SEK",
        },
      ]),
    );
    expect(r.error).toBeUndefined();
    const [chf, sat, sek] = r.data!;
    expect(chf).toMatchObject({
      amount: "-20000.00",
      currency: "CHF",
      amountBase: "-237993.14",
      rate: "11.899657",
      rateSource: "ecb_daily",
      rateDate: "2026-07-08",
      sourceType: "bank_transaction",
      categorisedBy: null,
      noDocumentNeeded: false,
    });
    expect(sat.rateSource).toBe("ecb_nearest");
    expect(sat.rateDate).toBe("2026-07-08");
    expect(sek).toMatchObject({
      amountBase: "-132.52",
      rate: "1",
      rateSource: "same_currency",
      rateDate: null,
    });
    await assertAuditLogged(adminPool, caller.tenantId, "create", "journal_entry", chf.id);
  });

  it("scenario 2: the money facts are locked by the database; the owner's facts move", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const id = uuid();
    const e = (
      await run(caller, (tx) =>
        journal.createBankEntries(tx, caller, noopAudit, [
          {
            sourceId: id,
            entryDate: "2026-07-08",
            description: "x",
            counterpartyKey: "X",
            amount: "-10.00",
            currency: "SEK",
          },
        ]),
      )
    ).data![0];
    for (const col of [
      "amount = 5",
      "currency = 'CHF'",
      "amount_base = 5",
      "rate = 2",
      "rate_source = 'manual'",
      "entry_date = '2026-01-01'",
      "description = 'y'",
      "source_id = NULL, source_type = 'manual'",
    ]) {
      await expect(
        run(caller, (tx) =>
          tx.$executeRawUnsafe(`UPDATE journal_entries SET ${col} WHERE id = '${e.id}'`),
        ),
      ).rejects.toThrow(/journal_entry_locked/);
    }
    await run(caller, async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE journal_entries SET note = 'ok', bas_code = '657' WHERE id = '${e.id}'`,
      );
      await tx.$executeRawUnsafe(
        `UPDATE journal_entries SET bank_implicit_rate = 11.887 WHERE id = '${e.id}'`,
      );
    });
    await expect(
      run(caller, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE journal_entries SET bank_implicit_rate = 12 WHERE id = '${e.id}'`,
        ),
      ),
    ).rejects.toThrow(/journal_entry_locked/);
  });

  it("scenario 4: one entry per source", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const id = uuid();
    const row = {
      sourceId: id,
      entryDate: "2026-07-08",
      description: "x",
      counterpartyKey: "X",
      amount: "-10.00",
      currency: "SEK",
    };
    await run(caller, (tx) => journal.createBankEntries(tx, caller, noopAudit, [row]));
    await expect(
      run(caller, (tx) => journal.createBankEntries(tx, caller, noopAudit, [row])),
    ).rejects.toThrow();
  });
});

describe("US2 — categorise", () => {
  it("by hand: stored with categorised_by manual, audited; a rule never overwrites it; invalid targets refused", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const partner = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "OpenAI",
      types: ["supplier"],
    });
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    const foreign = await createTestPartner(adminPool, other.tenantId, other.userId, {
      name: "Theirs",
    });
    const e = (
      await run(caller, (tx) =>
        journal.createBankEntries(tx, caller, noopAudit, [
          {
            sourceId: uuid(),
            entryDate: "2026-07-08",
            description: "OpenAI",
            counterpartyKey: "OPENAI",
            amount: "-132.52",
            currency: "SEK",
          },
        ]),
      )
    ).data![0];
    await run(caller, async (tx) => {
      // a rule first
      const byRule = await journal.categorise(
        tx,
        caller,
        noopAudit,
        e.id,
        { basCode: "657", noDocumentNeeded: true },
        { by: "rule", ruleId: uuid() },
      );
      expect(byRule.data).toMatchObject({
        basCode: "657",
        noDocumentNeeded: true,
        categorisedBy: "rule",
      });
      expect(byRule.data?.ruleId).not.toBeNull();
      // the owner overrides
      const byHand = await journal.categorise(tx, caller, realAudit(tx, caller), e.id, {
        basCode: "654",
        partnerId: partner.id,
        note: "ChatGPT",
      });
      expect(byHand.data).toMatchObject({
        basCode: "654",
        partnerId: partner.id,
        note: "ChatGPT",
        categorisedBy: "manual",
        ruleId: null,
        noDocumentNeeded: true,
      });
      // a later rule leaves it alone
      const again = await journal.categorise(
        tx,
        caller,
        noopAudit,
        e.id,
        { basCode: "657", partnerId: null },
        { by: "rule", ruleId: uuid() },
      );
      expect(again.data).toMatchObject({
        basCode: "654",
        partnerId: partner.id,
        categorisedBy: "manual",
      });
      // bad targets
      expect(
        (await journal.categorise(tx, caller, noopAudit, e.id, { basCode: "999" })).error?.code,
      ).toBe("NOT_FOUND");
      expect(
        (await journal.categorise(tx, caller, noopAudit, e.id, { partnerId: foreign.id })).error
          ?.code,
      ).toBe("NOT_FOUND");
      expect(
        (await journal.categorise(tx, caller, noopAudit, uuid(), { basCode: "657" })).error?.code,
      ).toBe("NOT_FOUND");
    });
    await assertAuditLogged(adminPool, caller.tenantId, "update", "journal_entry", e.id);
  });

  it("a rule fills only what is empty: category when none, partner when none, the flag OR-ed", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const partner = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "P",
      types: ["supplier"],
    });
    const e = (
      await run(caller, (tx) =>
        journal.createBankEntries(tx, caller, noopAudit, [
          {
            sourceId: uuid(),
            entryDate: "2026-07-08",
            description: "x",
            counterpartyKey: "X",
            amount: "-1.00",
            currency: "SEK",
          },
        ]),
      )
    ).data![0];
    await run(caller, async (tx) => {
      const first = await journal.categorise(
        tx,
        caller,
        noopAudit,
        e.id,
        { partnerId: partner.id },
        { by: "rule", ruleId: uuid() },
      );
      expect(first.data).toMatchObject({
        basCode: null,
        partnerId: partner.id,
        categorisedBy: "rule",
      });
      const second = await journal.categorise(
        tx,
        caller,
        noopAudit,
        e.id,
        { basCode: "657", partnerId: null, noDocumentNeeded: true },
        { by: "rule", ruleId: uuid() },
      );
      expect(second.data).toMatchObject({
        basCode: "657",
        partnerId: partner.id,
        noDocumentNeeded: true,
      });
    });
  });
});

describe("US3 — manual entries", () => {
  it("EUR at the ECB rate of the day, or a typed rate; delete refused while linked; bank entries not deletable by hand", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    await run(caller, async (tx) => {
      const ecb = await journal.createManualEntry(tx, caller, realAudit(tx, caller), {
        entryDate: "2026-03-02",
        description: "Prepaid licence",
        amount: "1200.00",
        currency: "EUR",
        basCode: "654",
      });
      expect(ecb.data).toMatchObject({
        sourceType: "manual",
        sourceId: null,
        amountBase: "13500.00",
        rate: "11.25",
        rateSource: "ecb_daily",
        categorisedBy: "manual",
      });
      const typed = await journal.createManualEntry(tx, caller, noopAudit, {
        entryDate: "2026-03-02",
        description: "Forfait",
        amount: "-100.00",
        currency: "CHF",
        rate: "11.887",
      });
      expect(typed.data).toMatchObject({
        amountBase: "-1188.70",
        rate: "11.887",
        rateSource: "manual",
        categorisedBy: null,
      });
      const sek = await journal.createManualEntry(tx, caller, noopAudit, {
        entryDate: "2026-03-02",
        description: "SEK",
        amount: "10.00",
        currency: "SEK",
      });
      expect(sek.data).toMatchObject({ rate: "1", rateSource: "same_currency" });
      expect(
        (
          await journal.createManualEntry(tx, caller, noopAudit, {
            entryDate: "2026-03-02",
            description: "",
            amount: "1.00",
            currency: "SEK",
          })
        ).error?.code,
      ).toBe("VALIDATION_ERROR");
      expect(
        (
          await journal.createManualEntry(tx, caller, noopAudit, {
            entryDate: "2026-03-02",
            description: "zero",
            amount: "0",
            currency: "SEK",
          })
        ).error?.code,
      ).toBe("VALIDATION_ERROR");
      expect(
        (
          await journal.createManualEntry(tx, caller, noopAudit, {
            entryDate: "2025-01-01",
            description: "no rate",
            amount: "1.00",
            currency: "USD",
          })
        ).error?.message,
      ).toMatch(/No exchange rate/);

      // linked → delete refused; unlinked → deleted
      const doc = await adminPool.query(
        `INSERT INTO documents (tenant_id, business_key, file_name, blob_url, mime_type, file_size, prefix_type, document_type, status, created_by, updated_at)
         VALUES ($1, 'exp_x', 'x.pdf', 'https://x', 'application/pdf', 1, 'expense', 'financial', 'uploaded', $2, now()) RETURNING id`,
        [caller.tenantId, caller.userId],
      );
      const link = await linking.createLink(tx, caller, noopAudit, {
        from: { type: "journal_entry", id: ecb.data?.id as string },
        to: { type: "document", id: doc.rows[0].id },
        kind: "justifies",
      });
      expect(link.error).toBeUndefined();
    });
    const entries = await run(caller, (tx) =>
      tx.journalEntry.findMany({ orderBy: { createdAt: "asc" } }),
    );
    const refused = await run(caller, (tx) =>
      journal.deleteManualEntry(tx, caller, noopAudit, entries[0].id),
    );
    expect(refused.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    const ok = await run(caller, (tx) =>
      journal.deleteManualEntry(tx, caller, realAudit(tx, caller), entries[1].id),
    );
    expect(ok.data?.id).toBe(entries[1].id);
    const bank = (
      await run(caller, (tx) =>
        journal.createBankEntries(tx, caller, noopAudit, [
          {
            sourceId: uuid(),
            entryDate: "2026-07-08",
            description: "x",
            counterpartyKey: "X",
            amount: "-1.00",
            currency: "SEK",
          },
        ]),
      )
    ).data![0];
    const notByHand = await run(caller, (tx) =>
      journal.deleteManualEntry(tx, caller, noopAudit, bank.id),
    );
    expect(notByHand.error?.code).toBe("BUSINESS_RULE_VIOLATION");
    await assertAuditLogged(adminPool, caller.tenantId, "delete", "journal_entry", entries[1].id);
  });
});

describe("FR-004 — only manual entries are link endpoints (T001)", () => {
  it("a justifies from a bank entry is refused, from a manual entry accepted", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const doc = await adminPool.query(
      `INSERT INTO documents (tenant_id, business_key, file_name, blob_url, mime_type, file_size, prefix_type, document_type, status, created_by, updated_at)
       VALUES ($1, 'exp_t001', 't001.pdf', 'https://x', 'application/pdf', 1, 'expense', 'financial', 'uploaded', $2, now()) RETURNING id`,
      [caller.tenantId, caller.userId],
    );
    const documentId: string = doc.rows[0].id;
    await run(caller, async (tx) => {
      const bank = await journal.createBankEntries(tx, caller, noopAudit, [
        {
          sourceId: uuid(),
          entryDate: "2026-07-08",
          description: "Prepaid licence",
          counterpartyKey: "LICENCE",
          amount: "-500.00",
          currency: "SEK",
        },
      ]);
      const manual = await journal.createManualEntry(tx, caller, noopAudit, {
        entryDate: "2026-07-08",
        description: "Prepaid licence",
        amount: "-500.00",
        currency: "SEK",
      });
      const fromBank = await linking.createLink(tx, caller, noopAudit, {
        from: { type: "journal_entry", id: bank.data?.[0]?.id as string },
        to: { type: "document", id: documentId },
        kind: "justifies",
      });
      expect(fromBank.error?.code).toBe("NOT_FOUND");
      const fromManual = await linking.createLink(tx, caller, noopAudit, {
        from: { type: "journal_entry", id: manual.data?.id as string },
        to: { type: "document", id: documentId },
        kind: "justifies",
      });
      expect(fromManual.error).toBeUndefined();
      expect(fromManual.data?.from).toEqual({ type: "journal_entry", id: manual.data?.id });
    });
  });
});

describe("US4 — the ledger", () => {
  it("sums the base of the filtered set; distinct values follow Excel semantics; RLS", async () => {
    const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
    const partner = await createTestPartner(adminPool, caller.tenantId, caller.userId, {
      name: "OpenAI",
      types: ["supplier"],
    });
    await run(caller, async (tx) => {
      await journal.createBankEntries(tx, caller, noopAudit, [
        {
          sourceId: uuid(),
          entryDate: "2026-07-08",
          description: "CHF",
          counterpartyKey: "CHF",
          amount: "-100.00",
          currency: "CHF",
        },
        {
          sourceId: uuid(),
          entryDate: "2026-07-09",
          description: "OpenAI",
          counterpartyKey: "OPENAI",
          amount: "-132.52",
          currency: "SEK",
        },
        {
          sourceId: uuid(),
          entryDate: "2026-03-02",
          description: "March",
          counterpartyKey: "MARCH",
          amount: "-10.00",
          currency: "SEK",
        },
      ]);
      const all = await tx.journalEntry.findMany({ orderBy: { entryDate: "asc" } });
      await journal.categorise(tx, caller, noopAudit, all[2].id, {
        basCode: "654",
        partnerId: partner.id,
      });
      await journal.categorise(tx, caller, noopAudit, all[1].id, { basCode: "657" });
    });
    await run(caller, async (tx) => {
      const july = await listJournalEntries(tx, {
        page: 1,
        pageSize: 10,
        sort: [{ col: "entryDate", dir: "asc" }],
        filters: { entryDate: { kind: "dates", months: ["2026-07"] } },
      });
      expect(july.total).toBe(2);
      expect(july.rows.map((r) => r.description)).toEqual(["CHF", "OpenAI"]);
      expect(july.sums?.amountBase).toBe("-1322.49"); // -1189.97 + -132.52
      expect(july.rows[1].partnerName).toBe("OpenAI");
      expect(july.rows[1].basLabel).toBe("654 · IT-tjänster");
      // the category filter inside July shows only July's categories
      const cats = await distinctJournalValues(tx, "basCode", {
        page: 1,
        pageSize: 10,
        sort: [],
        filters: { entryDate: { kind: "dates", months: ["2026-07"] } },
      });
      expect(cats.map((c) => c.value).sort()).toEqual(["654", "657"]);
      // search over the partner name (a derived column)
      const search = await listJournalEntries(tx, {
        page: 1,
        pageSize: 10,
        sort: [],
        filters: {},
        search: "openai",
      });
      expect(search.total).toBe(1);
      // the derived filter
      const byPartner = await listJournalEntries(tx, {
        page: 1,
        pageSize: 10,
        sort: [],
        filters: { partnerName: { kind: "text", op: "contains", value: "open" } },
      });
      expect(byPartner.total).toBe(1);
    });
    const { callerIdentity: other } = await createAuthenticatedContext(auth, "owner");
    await run(other, async (tx) => {
      expect(
        (await listJournalEntries(tx, { page: 1, pageSize: 10, sort: [], filters: {} })).total,
      ).toBe(0);
    });
  });
});
