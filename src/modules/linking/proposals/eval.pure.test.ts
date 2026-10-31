// F98 PR 2 (specs/ai US5, FR-010): the eval's report — agreement per source, per family and per code, the model's
// timing — and what it prints: counts, rates and codes, never a text or an amount.
import { describe, expect, it } from "vitest";
import { type EvalOutcome, formatEval, summariseEval } from "./eval";

const O: EvalOutcome[] = [
  { truth: "654", stage1: { source: "rule", code: "654", confidence: 1 }, model: null },
  { truth: "654", stage1: { source: "memory", code: "659", confidence: 0.8 }, model: null },
  { truth: "501", stage1: null, model: { code: "501", confidence: 0.9, ms: 2_000 } },
  { truth: "657", stage1: null, model: { code: "654", confidence: 0.6, ms: 4_000 } },
  { truth: "657", stage1: null, model: { code: "657", confidence: 0.3, ms: 3_000 } }, // LOW: not shown
  { truth: "580", stage1: null, model: { error: "timeout" } },
];

describe("summariseEval", () => {
  it("counts what the owner would have seen, per source, family and code", () => {
    const r = summariseEval(O);
    expect(r.rows).toBe(6);
    expect(r.shown).toEqual({ n: 4, agree: 2 });
    expect(r.none).toBe(2);
    expect(r.bySource).toEqual([
      { source: "memory", n: 1, agree: 0 },
      { source: "model", n: 3, agree: 2 },
      { source: "rule", n: 1, agree: 1 },
    ]);
    expect(r.byFamily).toEqual([
      { family: "high", n: 3, agree: 2 },
      { family: "medium", n: 1, agree: 0 },
    ]);
    expect(r.byCode.find((c) => c.code === "657")).toEqual({ code: "657", n: 2, agree: 0 });
    expect(r.model).toEqual({ asked: 4, failed: 1, p50Ms: 3_000, p95Ms: 4_000 });
  });

  it("prints counts and codes only", () => {
    const text = formatEval(summariseEval(O));
    expect(text).toContain("rows replayed: 6");
    expect(text).toContain("model: asked 4, failed 1, p50 3.0 s, p95 4.0 s");
    expect(text).not.toMatch(/SEK|CHF|EUR|\d+\.\d{2}\b/);
  });
});
