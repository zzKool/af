"use client";

import { useEffect, useRef } from "react";

// F170: the expenses pages dock one panel at a time — a row's details or the new-expense form. The title row's
// *New expense* and the list are siblings on the page; each says on this window event which panel it opened, the
// other closes its own. One event, no shared state to keep in step with `?new=1` (a module store would be shared
// too — the bundle instantiates a module once; docs/lessons.md *F170*, corrected in F179).
export type DockedExpensePanel = "new" | "row";

const EVENT = "af:expenses-dock";

/** Say which panel just opened in the dock. */
export function announceDockedPanel(panel: DockedExpensePanel): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<DockedExpensePanel>(EVENT, { detail: panel }));
}

/** Called when the other panel opened — close yours. */
export function useOtherDockedPanel(mine: DockedExpensePanel, onOtherOpened: () => void): void {
  const handler = useRef(onOtherOpened);
  handler.current = onOtherOpened;
  useEffect(() => {
    const listen = (e: Event) => {
      if ((e as CustomEvent<DockedExpensePanel>).detail !== mine) handler.current();
    };
    window.addEventListener(EVENT, listen);
    return () => window.removeEventListener(EVENT, listen);
  }, [mine]);
}
