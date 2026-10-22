"use client";

// The docked details panel (D40): the list page's side panel sits **in** the canvas, on its right, and the
// table narrows — not an overlay. The shell renders the slot; `components/ui/sheet.tsx` portals a right-side
// SheetContent into it when the slot exists (inside the app shell), and falls back to the overlay elsewhere
// (tests, print). Modules keep writing <Sheet><SheetContent>…; they inherit the dock.
import { createContext, type ReactNode, useContext, useState } from "react";

const DockContext = createContext<HTMLElement | null>(null);

/** The element the details panel docks into, or null outside the app shell. */
export function useDetailsDock(): HTMLElement | null {
  return useContext(DockContext);
}

/** The canvas row: the page's scroll container on the left, the dock on the right. */
export function DockedCanvas({ children }: { children: ReactNode }) {
  const [dock, setDock] = useState<HTMLElement | null>(null);
  return (
    <DockContext.Provider value={dock}>
      <div className="flex min-h-0 min-w-0 flex-1">
        {children}
        {/* empty = no width; a docked SheetContent gives it its own (380 px) */}
        <div ref={setDock} data-slot="details-dock" className="flex min-h-0 shrink-0" />
      </div>
    </DockContext.Provider>
  );
}
