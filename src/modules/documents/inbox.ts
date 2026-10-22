// The document inbox read model (specs/documents US4, D34): every document that still needs a decision, its
// state derived from the pipeline status + the archived flag + the review mark + the `created_from` link —
// nothing stored. The pure rules live here and are tested on `specs/documents/fixtures/inbox-state-cases.json`;
// `listInbox` in queries.ts feeds them.

export type InboxState = "needs_ocr" | "processing" | "stuck" | "ocr_failed" | "ready" | "archived";
export type InboxTab = "all" | "pending" | "ready" | "duplicates" | "archived";
export const INBOX_TABS: readonly InboxTab[] = [
  "all",
  "pending",
  "ready",
  "duplicates",
  "archived",
];

/** processing for longer than this → *stuck*: Run OCR is offered (harvest R23) */
export const OCR_STUCK_AFTER_MS = 5 * 60_000;
export const PENDING_STATES: readonly InboxState[] = [
  "needs_ocr",
  "processing",
  "stuck",
  "ocr_failed",
];

export type InboxDocumentFacts = {
  status: string;
  archivedAt: Date | null;
  reviewedAt: Date | null;
  updatedAt: Date;
  /** a `created_from` link points at it */
  became: boolean;
};

/**
 * The inbox state of a document, or null when it is out of the inbox: generated PDFs never enter; a document
 * that became something or was filed (reviewed with nothing created) has had its decision (D34). Archived rows keep their state under the Archived tab.
 */
export function inboxState(doc: InboxDocumentFacts, now: Date): InboxState | null {
  if (doc.status === "generated") return null;
  if (doc.archivedAt) return "archived";
  if (doc.became || doc.reviewedAt) return null;
  switch (doc.status) {
    case "uploaded":
      return "needs_ocr";
    case "processing":
      return now.getTime() - doc.updatedAt.getTime() > OCR_STUCK_AFTER_MS ? "stuck" : "processing";
    case "ocr_failed":
      return "ocr_failed";
    case "extracted":
      return "ready";
    default:
      return null;
  }
}

/** Whether a document may be archived: only a live inbox row (D32 — archive is for parking, not for history). */
export function canArchive(doc: InboxDocumentFacts, now: Date): boolean {
  const s = inboxState(doc, now);
  return s !== null && s !== "archived";
}

/**
 * The oldest document of each content hash, over every document of the tenant (a linked twin still counts —
 * harvest R19); `null` for the oldest itself and for documents without a hash or a twin.
 */
export function duplicateOfMap(
  docs: readonly { id: string; contentHash: string | null; createdAt: Date }[],
): Map<string, string | null> {
  const oldest = new Map<string, { id: string; createdAt: Date; count: number }>();
  for (const d of docs) {
    if (!d.contentHash) continue;
    const cur = oldest.get(d.contentHash);
    if (!cur) oldest.set(d.contentHash, { id: d.id, createdAt: d.createdAt, count: 1 });
    else {
      cur.count++;
      if (
        d.createdAt < cur.createdAt ||
        (d.createdAt.getTime() === cur.createdAt.getTime() && d.id < cur.id)
      ) {
        cur.id = d.id;
        cur.createdAt = d.createdAt;
      }
    }
  }
  const out = new Map<string, string | null>();
  for (const d of docs) {
    const group = d.contentHash ? oldest.get(d.contentHash) : undefined;
    out.set(d.id, group && group.count > 1 && group.id !== d.id ? group.id : null);
  }
  return out;
}

export type InboxCounts = {
  pending: number;
  ready: number;
  duplicates: number;
  archived: number;
  /** pending + ready — "documents need attention" */
  total: number;
};

/** Counts over the whole inbox, filters ignored (harvest R21). `hasTwin` = another document holds the same bytes. */
export function inboxCounts(rows: readonly { state: InboxState; hasTwin: boolean }[]): InboxCounts {
  let pending = 0;
  let ready = 0;
  let duplicates = 0;
  let archived = 0;
  for (const r of rows) {
    if (r.state === "archived") archived++;
    else if (r.state === "ready") ready++;
    else pending++;
    if (r.state !== "archived" && r.hasTwin) duplicates++;
  }
  return { pending, ready, duplicates, archived, total: pending + ready };
}

export function inTab(row: { state: InboxState; hasTwin: boolean }, tab: InboxTab): boolean {
  switch (tab) {
    case "all":
      return row.state !== "archived";
    case "pending":
      return PENDING_STATES.includes(row.state);
    case "ready":
      return row.state === "ready";
    case "duplicates":
      return row.state !== "archived" && row.hasTwin;
    case "archived":
      return row.state === "archived";
  }
}
