// F71: the derived document state → D40 family map (one place in the module), tested on the rule — every state
// covered, only kit families, and "asks for something" (attention / in progress) exactly while the document
// waits in the inbox — on the inbox fixture, plus the filed and generated documents that never enter it.
import { describe, expect, it } from "vitest";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import fixture from "../../../specs/documents/fixtures/inbox-state-cases.json";
import { type InboxDocumentFacts, inboxState } from "./inbox";
import {
  DOCUMENT_STATE_FAMILY,
  DOCUMENT_STATES,
  type DocumentState,
  documentState,
  documentStateFamily,
} from "./state-family";

const NOW = new Date("2026-10-21T12:00:00Z");
const base: InboxDocumentFacts = {
  status: "extracted",
  archivedAt: null,
  reviewedAt: null,
  updatedAt: NOW,
  became: false,
};
type Mapping = {
  v2Status: string;
  updatedAtAgeMs?: number;
  archivedAt: string | null;
  hasLink: boolean;
};
const cases: InboxDocumentFacts[] = [
  ...(fixture as unknown as { v3StateMapping: Mapping[] }).v3StateMapping.map((m) => ({
    status: m.v2Status,
    archivedAt: m.archivedAt ? new Date(m.archivedAt) : null,
    reviewedAt: null,
    updatedAt: new Date(NOW.getTime() - (m.updatedAtAgeMs ?? 0)),
    became: m.hasLink,
  })),
  { ...base, reviewedAt: NOW }, // filed as is (D34)
  { ...base, status: "ocr_failed", reviewedAt: NOW }, // typed by hand, then filed
  { ...base, status: "generated" },
  { ...base, status: "generated", archivedAt: NOW },
];

describe("document state → family", () => {
  it("maps every derived state, and only to a kit family", () => {
    expect(Object.keys(DOCUMENT_STATE_FAMILY).sort()).toEqual([...DOCUMENT_STATES].sort());
    for (const s of DOCUMENT_STATES) expect(STATE_FAMILIES).toContain(documentStateFamily(s));
  });

  it("follows the D40 table for the words it names (OCR pending / Ready · OCR failed · Filed · Archived)", () => {
    const expected: Record<DocumentState, string> = {
      needs_ocr: "progress",
      processing: "progress",
      stuck: "attention",
      ocr_failed: "attention",
      ready: "progress",
      archived: "neutral",
      filed: "done",
      generated: "neutral",
    };
    expect(DOCUMENT_STATE_FAMILY).toEqual(expected);
  });

  it("only a broken OCR asks for attention — the owner's hand is needed before anything else", () => {
    expect(DOCUMENT_STATES.filter((s) => documentStateFamily(s) === "attention")).toEqual([
      "stuck",
      "ocr_failed",
    ]);
  });
});

describe("from the facts to the family", () => {
  it("asks for something exactly while the document waits in the inbox (not parked)", () => {
    for (const doc of cases) {
      const inbox = inboxState(doc, NOW);
      const family = documentStateFamily(documentState(doc, NOW));
      const waiting = inbox !== null && inbox !== "archived";
      expect(family === "attention" || family === "progress", JSON.stringify(doc)).toBe(waiting);
    }
  });

  it("an inbox row keeps the inbox's own state — the library, the inbox and the review page say the same word", () => {
    for (const doc of cases) {
      const inbox = inboxState(doc, NOW);
      if (inbox !== null) expect(documentState(doc, NOW)).toBe(inbox);
    }
  });

  it("out of the inbox: decided is filed (done), the app's own PDF is generated (neutral) even if parked", () => {
    expect(documentState({ ...base, became: true }, NOW)).toBe("filed");
    expect(documentState({ ...base, reviewedAt: NOW }, NOW)).toBe("filed");
    expect(documentState({ ...base, status: "generated", archivedAt: NOW }, NOW)).toBe("generated");
    expect(documentStateFamily("filed")).toBe("done");
  });

  it("stuck after five minutes of processing turns from in progress to attention", () => {
    const processing = { ...base, status: "processing" };
    expect(documentStateFamily(documentState(processing, NOW))).toBe("progress");
    const old = { ...processing, updatedAt: new Date(NOW.getTime() - 6 * 60_000) };
    expect(documentStateFamily(documentState(old, NOW))).toBe("attention");
  });
});
