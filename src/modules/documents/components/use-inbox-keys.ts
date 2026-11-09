"use client";

// The document inbox's keyboard (FR-022) in one place: the map the help dialog lists and the handler that reads it.
// Quiet while typing or inside a dialog; the accountant has j k ? Esc only (US4-7). Split out of the workbench
// (F67, lessons *Components over 400 lines*) — the workbench hands the current state and its commands each render.
import { useEffect } from "react";
import type { MessageKey } from "@/kernel/i18n/translate";
import type { InboxTab } from "@/modules/documents/inbox";
import type { InboxItem } from "@/modules/documents/queries";

/** The keyboard map (FR-022); the accountant's help lists the reading keys only (US4-7). */
export const INBOX_KEYS: readonly { keys: string; label: MessageKey; write: boolean }[] = [
  { keys: "j / ↓ · k / ↑", label: "documents.inbox.help.move", write: false },
  { keys: "x", label: "documents.inbox.help.select", write: true },
  { keys: "a", label: "documents.inbox.help.selectAll", write: true },
  { keys: "o", label: "documents.inbox.help.ocr", write: true },
  { keys: "e", label: "documents.inbox.help.expense", write: true },
  { keys: "i", label: "documents.inbox.help.supplier", write: true },
  { keys: "l", label: "documents.inbox.help.link", write: true },
  { keys: "Enter", label: "documents.inbox.help.enter", write: true },
  { keys: "1 – 3", label: "documents.inbox.help.nth", write: true },
  { keys: "d", label: "documents.inbox.help.archive", write: true },
  { keys: "r", label: "documents.inbox.help.restore", write: true },
  { keys: "u / z", label: "documents.inbox.help.undo", write: true },
  { keys: "?", label: "documents.inbox.help.help", write: false },
  { keys: "Esc", label: "documents.inbox.help.esc", write: false },
];

/** Typing in a field, or inside a dialog / an open list: the page's keys stay quiet (`Esc` included — the
 *  dialog closes itself). */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    el.isContentEditable ||
    !!el.closest("[role=dialog]") ||
    !!el.closest("[role=alertdialog]") ||
    !!el.closest("[role=listbox]")
  );
}

/** What the keys read and do — the workbench's state and commands at this render. */
export type InboxKeyContext = {
  /** a creation dialog is open: every key is its own */
  dialogOpen: boolean;
  helpOpen: boolean;
  toggleHelp: () => void;
  canWrite: boolean;
  open: InboxItem | null;
  tab: InboxTab;
  /** the checked rows, null when none */
  selection: string[] | null;
  canMake: (row: InboxItem) => boolean;
  canLink: (row: InboxItem) => boolean;
  /** Esc: close the pane, else clear the selection */
  escape: () => void;
  move: (delta: number) => void;
  toggle: (id: string) => void;
  toggleAll: () => void;
  ocr: (row: InboxItem) => void;
  make: (dialog: "expense" | "supplier") => void;
  openSearch: () => void;
  park: (kind: "archive" | "restore", ids: string[]) => void;
  refresh: () => void;
  undo: () => void;
  /** Enter applies the first suggestion when it is high; 1 – 3 the nth */
  apply: (index: number, requireHigh: boolean) => void;
};

/** The keydown listener, rebound every render so it always reads the current context (as before the split). */
export function useInboxKeys(ctx: InboxKeyContext): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || ctx.dialogOpen) return;
      const key = e.key;
      const { open } = ctx;
      if (key === "?") {
        e.preventDefault();
        ctx.toggleHelp();
        return;
      }
      if (ctx.helpOpen) return; // the help dialog closes on Esc by itself
      if (key === "Escape") {
        ctx.escape();
        return;
      }
      if (key === "j" || key === "ArrowDown") {
        e.preventDefault();
        ctx.move(1);
        return;
      }
      if (key === "k" || key === "ArrowUp") {
        e.preventDefault();
        ctx.move(-1);
        return;
      }
      if (!ctx.canWrite) return;
      if (key === "x" && open) {
        e.preventDefault();
        ctx.toggle(open.id);
      } else if (key === "a") {
        e.preventDefault();
        ctx.toggleAll();
      } else if (key === "o" && open) {
        e.preventDefault();
        ctx.ocr(open);
      } else if ((key === "e" || key === "i") && open) {
        e.preventDefault();
        if (ctx.canMake(open)) ctx.make(key === "e" ? "expense" : "supplier");
      } else if (key === "l" && open && ctx.canLink(open)) {
        e.preventDefault();
        ctx.openSearch();
      } else if (key === "d") {
        e.preventDefault();
        if (ctx.tab === "archived") return;
        const ids = ctx.selection ?? (open ? [open.id] : []);
        ctx.park("archive", ids);
      } else if (key === "r") {
        e.preventDefault();
        if (ctx.tab === "archived" && ctx.selection) ctx.park("restore", ctx.selection);
        else ctx.refresh();
      } else if (key === "u" || key === "z") {
        e.preventDefault();
        ctx.undo();
      } else if ((key === "Enter" || /^[1-3]$/.test(key)) && open && ctx.canLink(open)) {
        e.preventDefault();
        ctx.apply(key === "Enter" ? 0 : Number(key) - 1, key === "Enter");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
