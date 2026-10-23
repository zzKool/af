"use client";

// A document's derived state on screen (D40): icon + word through the module's one family map. The words are
// the inbox's (`documents.inbox.state.*`), *Filed* and *generated* — the same word on every page.
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { StateLabel } from "@/kernel/ui/state-label";
import { type DocumentState, documentStateFamily } from "../state-family";

export const DOCUMENT_STATE_WORD: Readonly<Record<DocumentState, MessageKey>> = {
  needs_ocr: "documents.inbox.state.needs_ocr",
  processing: "documents.inbox.state.processing",
  stuck: "documents.inbox.state.stuck",
  ocr_failed: "documents.inbox.state.ocr_failed",
  ready: "documents.inbox.state.ready",
  archived: "documents.inbox.state.archived",
  filed: "documents.makeIt.filed",
  generated: "documents.status.generated",
};

export function DocumentStateLabel({
  state,
  testId,
  className,
}: {
  state: DocumentState;
  testId?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <span data-testid={testId} data-document-state={state} className="inline-flex">
      <StateLabel
        family={documentStateFamily(state)}
        state={t(DOCUMENT_STATE_WORD[state])}
        className={className}
      />
    </span>
  );
}
