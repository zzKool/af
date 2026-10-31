// F98 PR 2 (specs/ai FR-005, spec-suggest-from-first-entry FR-201, SC-202): the BAS prompt — the static part is the
// same for every row (the server's cache), the answer is bound to the active set, the owner's notes steer it, and
// no vendor or product is mapped to an account in the prompt text.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  basProposalSchema,
  basProposalSystem,
  basProposalUser,
  type PromptAccount,
  promptFactsHash,
} from "./bas-proposal";

const ACCOUNTS: PromptAccount[] = [
  { code: "501", name: "Premises rent", nameSv: "Lokalhyra" },
  { code: "654", name: "IT services", nameSv: "IT-tjänster" },
  { code: "657", name: "Banking costs", nameSv: "Bankkostnader" },
];
const EXAMPLES = [
  { text: "DESKSHARE AB 2026-09", amount: "-2500.00", currency: "SEK", basCode: "501" },
];

describe("the BAS prompt", () => {
  it("the static part does not depend on the row — every row of a run reuses the cache", () => {
    const sys = basProposalSystem(ACCOUNTS, EXAMPLES);
    expect(sys).toContain("654 IT services (IT-tjänster)");
    expect(sys).toContain("DESKSHARE AB 2026-09 | -2500.00 SEK → 501");
    const a = basProposalUser({
      bookingDate: "2026-09-01",
      amount: "-99.00",
      currency: "SEK",
      text: "X",
    });
    const b = basProposalUser({
      bookingDate: "2026-09-02",
      amount: "-12.00",
      currency: "EUR",
      text: "Y",
    });
    expect(a).not.toBe(b);
    expect(sys).not.toContain("-99.00");
  });

  it("the owner's note is in the account line, and editing it changes the prompt's facts", () => {
    const noted = ACCOUNTS.map((a) =>
      a.code === "654" ? { ...a, useFor: "software licences and cloud subscriptions" } : a,
    );
    expect(basProposalSystem(noted, [])).toContain(
      "654 IT services (IT-tjänster) — use for: software licences and cloud subscriptions",
    );
    expect(promptFactsHash(noted)).not.toBe(promptFactsHash(ACCOUNTS));
    expect(promptFactsHash(ACCOUNTS)).toBe(promptFactsHash([...ACCOUNTS]));
  });

  it("the answer is bound to the active codes", () => {
    const schema = basProposalSchema(ACCOUNTS.map((a) => a.code));
    const ok = { basCode: "654", confidence: 0.9, reason: "A software service", alternatives: [] };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, basCode: "999" }).success).toBe(false);
    expect(
      schema.safeParse({ ...ok, alternatives: [{ basCode: "580", why: "travel" }] }).success,
    ).toBe(false);
    expect(schema.safeParse({ ...ok, confidence: 1.2 }).success).toBe(false);
  });

  it("SC-202: the prompt files name no account — every code comes from the tenant's active set at run time", () => {
    const text = readdirSync(__dirname)
      .filter((f) => f.endsWith(".ts") && !f.includes(".test."))
      .map((f) => readFileSync(join(__dirname, f), "utf8"))
      .join("\n");
    // a literal code is the start of a hard-coded mapping (a vendor or a word → an account): none allowed
    expect(text.match(/["'`]\d{3,4}["'`]/g)).toBeNull();
    expect(basProposalSystem([], [])).not.toMatch(/\b\d{3,4}\b/);
  });
});
