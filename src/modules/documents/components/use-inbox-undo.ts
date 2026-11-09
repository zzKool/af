"use client";

// The document inbox's undo stack (FR-020): archive and restore push what succeeded, `u` / `z` pops the last. It
// lives as long as the page, at most `INBOX_UNDO_MAX` entries. Split out of the workbench (F67) — F120 cuts the
// undo, which is then this file and its call sites.
import { useCallback, useState } from "react";

export const INBOX_UNDO_MAX = 20;

export type InboxUndoEntry = { kind: "archive" | "restore"; ids: string[] };

export function useInboxUndo(): {
  last: InboxUndoEntry | undefined;
  push: (entry: InboxUndoEntry) => void;
  /** drops the last entry and hands it back (undefined when the stack is empty) */
  pop: () => InboxUndoEntry | undefined;
} {
  const [stack, setStack] = useState<InboxUndoEntry[]>([]);
  const last = stack[stack.length - 1];
  const push = useCallback(
    (entry: InboxUndoEntry) => setStack((s) => [...s, entry].slice(-INBOX_UNDO_MAX)),
    [],
  );
  const pop = useCallback(() => {
    if (!last) return undefined;
    setStack((s) => s.slice(0, -1));
    return last;
  }, [last]);
  return { last, push, pop };
}
