import { describe, expect, it } from "vitest";
import fixture from "../../../specs/documents/fixtures/inbox-state-cases.json";
import {
  canArchive,
  duplicateOfMap,
  inboxCounts,
  inboxState,
  inTab,
  OCR_STUCK_AFTER_MS,
} from "./inbox";

type Mapping = {
  v2Status: string;
  updatedAtAgeMs?: number;
  archivedAt: string | null;
  hasLink: boolean;
  inboxState: string | null;
  stuck?: boolean;
};
type Fixture = {
  limits: { ocrStuckAfterMs: number };
  v3StateMapping: Mapping[];
  countsExample: {
    documents: { id: string; state: string | null; hash: string }[];
    expect: { pending: number; ready: number; total: number; duplicates: number; archived: number };
    duplicateOf: Record<string, string | null>;
  };
};
const fx = fixture as unknown as Fixture;
const NOW = new Date("2026-10-21T12:00:00Z");

describe("inbox state (harvest §4.3, specs/documents US4)", () => {
  it("maps the v2 status + the flags to the state, stuck after five minutes", () => {
    expect(OCR_STUCK_AFTER_MS).toBe(fx.limits.ocrStuckAfterMs);
    for (const m of fx.v3StateMapping) {
      const got = inboxState(
        {
          status: m.v2Status,
          archivedAt: m.archivedAt ? new Date(m.archivedAt) : null,
          reviewedAt: null,
          updatedAt: new Date(NOW.getTime() - (m.updatedAtAgeMs ?? 0)),
          became: m.hasLink,
        },
        NOW,
      );
      // the fixture's "pending.x" / "ready" / "archived" / null → v3's flat states, stuck when flagged
      const expected =
        m.inboxState === null
          ? null
          : m.stuck
            ? "stuck"
            : m.inboxState.replace("pending.", "").replace("ocr_processing", "processing");
      expect(got, JSON.stringify(m)).toBe(expected);
    }
  });

  it("filed (reviewed, nothing created) and generated are out; archived keeps its row", () => {
    const base = { archivedAt: null, reviewedAt: null, updatedAt: NOW, became: false };
    expect(inboxState({ ...base, status: "extracted", reviewedAt: NOW }, NOW)).toBeNull();
    expect(inboxState({ ...base, status: "generated" }, NOW)).toBeNull();
    expect(inboxState({ ...base, status: "uploaded", archivedAt: NOW }, NOW)).toBe("archived");
    expect(canArchive({ ...base, status: "extracted" }, NOW)).toBe(true);
    expect(canArchive({ ...base, status: "extracted", became: true }, NOW)).toBe(false);
    expect(canArchive({ ...base, status: "extracted", reviewedAt: NOW }, NOW)).toBe(false);
    expect(canArchive({ ...base, status: "extracted", archivedAt: NOW }, NOW)).toBe(false);
    expect(canArchive({ ...base, status: "generated" }, NOW)).toBe(false);
  });

  it("counts and duplicate-of on the fixture's example (a linked twin still counts)", () => {
    const docs = fx.countsExample.documents.map((d, i) => ({
      id: d.id,
      contentHash: d.hash,
      createdAt: new Date(NOW.getTime() + i * 1000), // d1 < d2 < … in upload order
      state: d.state,
    }));
    const dup = duplicateOfMap(docs);
    expect(dup.get("d1")).toBe(fx.countsExample.duplicateOf.d1);
    expect(dup.get("d3")).toBe(fx.countsExample.duplicateOf.d3);
    expect(dup.get("d6")).toBe("d1");
    expect(dup.get("d4")).toBeNull();
    const twinCount = new Map<string, number>();
    for (const d of docs) twinCount.set(d.contentHash, (twinCount.get(d.contentHash) ?? 0) + 1);
    const rows = docs
      .filter((d) => d.state !== null)
      .map((d) => ({
        state: (d.state as string).replace("pending.", "") as "needs_ocr" | "ready" | "archived",
        hasTwin: (twinCount.get(d.contentHash) ?? 0) > 1,
      }));
    expect(inboxCounts(rows)).toEqual(fx.countsExample.expect);
    expect(rows.filter((r) => inTab(r, "duplicates"))).toHaveLength(2);
    expect(rows.filter((r) => inTab(r, "all"))).toHaveLength(4);
    expect(rows.filter((r) => inTab(r, "archived"))).toHaveLength(1);
  });

  it("documents without a hash never pair", () => {
    const dup = duplicateOfMap([
      { id: "a", contentHash: null, createdAt: NOW },
      { id: "b", contentHash: null, createdAt: NOW },
    ]);
    expect(dup.get("a")).toBeNull();
    expect(dup.get("b")).toBeNull();
  });
});
