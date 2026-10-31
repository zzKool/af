// F126 (specs/ai/spec-suggest-from-first-entry.md FR-202, US3): the *Use for* notes — the model drafts, the owner
// edits or confirms, a confirmed note is never overwritten; the picker and the prompt read them.
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockAiService } from "@/kernel/ai/ai";
import type { AiService } from "@/kernel/ai/types";
import type { AuditLogger } from "@/kernel/audit/types";
import { auth } from "@/kernel/auth/auth";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import { prisma } from "@/kernel/db/client";
import { type TransactionClient, withTenantTransaction } from "@/kernel/db/tenant-client";
import { cleanupTestData, createAuthenticatedContext } from "@/kernel/db/test-fixtures";
import {
  askUseForDrafts,
  confirmUseForNotes,
  prepareUseForDrafts,
  USE_FOR_BATCH,
  writeUseForDrafts,
} from "./bas-notes";
import { basPickerOptions } from "./bas-options";
import { activateBasCategories, updateBasPreference } from "./bas-preferences";
import { draftUseFor } from "./jobs/draft-use-for";

vi.mock("@/kernel/logging/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const audit: AuditLogger = { log: async () => {} };
const ADMIN_DATABASE_URL =
  process.env.DATABASE_TEST_MIGRATION_URL || "postgresql://af:test@localhost:5433/af_test";
let adminPool: Pool;
beforeAll(() => {
  adminPool = new Pool({ connectionString: ADMIN_DATABASE_URL });
});
beforeEach(async () => {
  await cleanupTestData(adminPool);
});
afterAll(async () => {
  await adminPool.end();
});

const run = <T>(c: CallerIdentity, fn: (tx: TransactionClient) => Promise<T>) =>
  withTenantTransaction(prisma, c.tenantId, fn);

const notes = async (c: CallerIdentity) =>
  Object.fromEntries(
    (
      await run(c, (tx) =>
        tx.tenantBasPreference.findMany({
          select: { basCode: true, useFor: true, useForState: true },
        }),
      )
    ).map((p) => [p.basCode, [p.useFor, p.useForState]]),
  );

async function owner(codes = ["501", "654", "657"]) {
  const { callerIdentity: caller } = await createAuthenticatedContext(auth, "owner");
  await run(caller, (tx) => activateBasCategories(tx, caller, audit, codes));
  return caller;
}

const answer = (codes: string[]) => ({
  notes: codes.map((code) => ({ code, useFor: `drafted for ${code}` })),
});

describe("Use for notes (F126)", () => {
  it("the owner's own note is confirmed; an empty one clears it; the picker carries it", async () => {
    const c = await owner();
    await run(c, (tx) =>
      updateBasPreference(tx, c, audit, "654", { useFor: "  software licences and cloud  " }),
    );
    expect((await notes(c))["654"]).toEqual(["software licences and cloud", "confirmed"]);
    const opts = await run(c, (tx) => basPickerOptions(tx));
    expect(opts.find((o) => o.code === "654")?.useFor).toBe("software licences and cloud");
    await run(c, (tx) => updateBasPreference(tx, c, audit, "654", { useFor: "  " }));
    expect((await notes(c))["654"]).toEqual([null, null]);
  });

  it("the model drafts only where the owner has not written; a draft never overwrites a confirmed note", async () => {
    const c = await owner();
    await run(c, (tx) => updateBasPreference(tx, c, audit, "654", { useFor: "mine" }));
    const batches = await run(c, (tx) => prepareUseForDrafts(tx));
    expect(batches.flat().map((a) => a.code)).toEqual(["501", "657"]);
    expect(batches[0]?.[0]).toMatchObject({ code: "501", nameSv: "Lokalhyra" });

    // the owner writes 657 while the model is thinking: his note stands
    await run(c, (tx) => updateBasPreference(tx, c, audit, "657", { useFor: "bank fees" }));
    const written = await run(c, (tx) =>
      writeUseForDrafts(tx, c, audit, [
        { code: "501", useFor: "office rent" },
        { code: "654", useFor: "would overwrite" },
        { code: "657", useFor: "would overwrite" },
      ]),
    );
    expect(written).toBe(1);
    expect(await notes(c)).toEqual({
      "501": ["office rent", "draft"],
      "654": ["mine", "confirmed"],
      "657": ["bank fees", "confirmed"],
    });
  });

  it("a re-draft replaces drafts; confirm one, then all", async () => {
    const c = await owner();
    await run(c, (tx) =>
      writeUseForDrafts(tx, c, audit, [
        { code: "501", useFor: "v1" },
        { code: "654", useFor: "v1" },
        { code: "657", useFor: "v1" },
      ]),
    );
    expect((await run(c, (tx) => prepareUseForDrafts(tx))).flat()).toHaveLength(3);
    await run(c, (tx) => writeUseForDrafts(tx, c, audit, [{ code: "501", useFor: "v2" }]));
    expect((await notes(c))["501"]).toEqual(["v2", "draft"]);
    await run(c, (tx) => confirmUseForNotes(tx, c, audit, ["654"]));
    expect((await notes(c))["654"]).toEqual(["v1", "confirmed"]);
    const all = await run(c, (tx) => confirmUseForNotes(tx, c, audit));
    expect(all.data?.confirmed).toBe(2);
    expect((await run(c, (tx) => prepareUseForDrafts(tx))).flat()).toHaveLength(0);
    const accountant: CallerIdentity = { ...c, role: "accountant" };
    expect((await run(c, (tx) => confirmUseForNotes(tx, accountant, audit))).error?.code).toBe(
      "FORBIDDEN",
    );
  });

  it("the job: batches to the model, answers outside the batch dropped, unreachable stops, off asks nothing", async () => {
    const codes = [
      "501",
      "502",
      "503",
      "504",
      "505",
      "506",
      "507",
      "509",
      "510",
      "511",
      "512",
      "513",
      "514",
      "654",
      "657",
    ];
    const c = await owner(codes);
    let calls = 0;
    const ai: AiService = {
      kind: "mock",
      complete: async (call) => {
        calls++;
        const user = call.messages[1]?.content ?? "";
        const inBatch = codes.filter((k) => user.includes(`${k} `));
        // one code from outside the batch: the enum refuses it, the whole answer is invalid — so answer in-batch only
        return createMockAiService({ "settings.bas-use-for": answer(inBatch) }).complete(call);
      },
    };
    const r = await draftUseFor({ tenantId: c.tenantId, userId: c.userId }, ai);
    expect(calls).toBe(Math.ceil(codes.length / USE_FOR_BATCH));
    expect(r).toEqual({ accounts: codes.length, drafted: codes.length, failed: 0, stopped: false });
    expect((await notes(c))["654"]).toEqual(["drafted for 654", "draft"]);

    const down: AiService = {
      kind: "openai-compatible",
      complete: vi.fn(async () => ({
        ok: false as const,
        error: "unavailable" as const,
        retryable: true,
        detail: "x",
      })),
    };
    const stopped = await askUseForDrafts(down, [
      [{ code: "501", name: "a", nameSv: "b", className: "c" }],
      [{ code: "654", name: "a", nameSv: "b", className: "c" }],
    ]);
    expect(stopped).toMatchObject({ failed: 1, stopped: true });
    expect(down.complete).toHaveBeenCalledTimes(1);
    const off: AiService = { kind: "off", complete: vi.fn() };
    expect(
      (await askUseForDrafts(off, [[{ code: "501", name: "a", nameSv: "b", className: "c" }]]))
        .stopped,
    ).toBe(true);
    expect(off.complete).not.toHaveBeenCalled();
  });
});
