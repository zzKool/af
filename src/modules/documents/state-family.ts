// The one place documents maps its derived state → the D40 state family (ui-conventions *States and tags*).
// Client-safe (no Prisma): the library, the inbox and the review page all read it.
//
// A document's state is the inbox's (`inboxState`, D34) while it waits for a decision, and once out of the
// inbox it is *filed* (it became something, or was reviewed) or *generated* (the app's own PDF, never in it):
//   needs_ocr    progress    uploaded, the OCR is queued ("OCR pending")
//   processing   progress    the OCR runs
//   stuck        attention   processing for more than five minutes — run the OCR again
//   ocr_failed   attention   the OCR gave nothing — run it again or type the facts
//   ready        progress    the facts are there, the decision is not (Make it… / Just file it)
//   archived     neutral     parked on the inbox
//   filed        done        decided: became an expense / supplier invoice, or filed as is
//   generated    neutral     an issued invoice's PDF — nothing to decide
import type { StateFamily } from "@/kernel/ui/state-label";
import { type InboxDocumentFacts, type InboxState, inboxState } from "./inbox";

export const DOCUMENT_STATES = [
  "needs_ocr",
  "processing",
  "stuck",
  "ocr_failed",
  "ready",
  "archived",
  "filed",
  "generated",
] as const;
export type DocumentState = InboxState | "filed" | "generated";

export const DOCUMENT_STATE_FAMILY: Readonly<Record<DocumentState, StateFamily>> = {
  needs_ocr: "progress",
  processing: "progress",
  stuck: "attention",
  ocr_failed: "attention",
  ready: "progress",
  archived: "neutral",
  filed: "done",
  generated: "neutral",
};

export function documentStateFamily(state: DocumentState): StateFamily {
  return DOCUMENT_STATE_FAMILY[state];
}

/** The state of any document, inbox or not — derived from the same facts as `inboxState`, nothing stored. */
export function documentState(doc: InboxDocumentFacts, now: Date): DocumentState {
  if (doc.status === "generated") return "generated";
  return inboxState(doc, now) ?? "filed";
}
