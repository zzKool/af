"use client";

// The docked details panel (D40): the list page's side panel sits **in** the canvas, on its right, and the
// table narrows — not an overlay. The shell renders the slot; `components/ui/sheet.tsx` portals a right-side
// SheetContent into it when the slot exists (inside the app shell), and falls back to the overlay elsewhere
// (tests, print). Modules keep writing <Sheet><SheetContent>…; they inherit the dock.
//
// Open / hidden per table (F74): the page's DataTable registers its remembered state here (`useDockedPanel`,
// stored in the table's layout — `table_preferences`); the panel's *Hide* button collapses it to a rail with
// *Show*, and a hidden panel stays a rail when another row is picked, across reloads. × and Escape still close
// the row (the module's `onOpenChange`), as before.
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/** A table's remembered panel state, as the dock sees it. */
export type DockedPanelState = { hidden: boolean; setHidden(hidden: boolean): void };

type Registration = { owner: symbol; state: DockedPanelState };

type DockContextValue = {
  dock: HTMLElement | null;
  panel: DockedPanelState | null;
  register(reg: Registration | null, owner: symbol): void;
};

const DockContext = createContext<DockContextValue | null>(null);

/** The element the details panel docks into, or null outside the app shell. */
export function useDetailsDock(): HTMLElement | null {
  return useContext(DockContext)?.dock ?? null;
}

/** The page table's remembered open / hidden, or null when no table registered one (the panel just opens). */
export function useDockedPanelState(): DockedPanelState | null {
  return useContext(DockContext)?.panel ?? null;
}

/**
 * Called by a DataTable: offer its remembered panel state to the dock. The first table on a page wins (a page with
 * a details panel has one main table); the registration goes when the table unmounts.
 */
export function useDockedPanel(hidden: boolean, setHidden: (hidden: boolean) => void): void {
  const ctx = useContext(DockContext);
  const register = ctx?.register;
  const owner = useRef(Symbol("table")).current;
  const setter = useRef(setHidden);
  setter.current = setHidden;
  useEffect(() => {
    if (!register) return;
    register({ owner, state: { hidden, setHidden: (h) => setter.current(h) } }, owner);
  }, [register, owner, hidden]);
  useEffect(() => {
    if (!register) return;
    return () => register(null, owner);
  }, [register, owner]);
}

/** The canvas row: the page's scroll container on the left, the dock on the right. */
export function DockedCanvas({ children }: { children: ReactNode }) {
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const [reg, setReg] = useState<Registration | null>(null);
  const register = useCallback((next: Registration | null, owner: symbol) => {
    setReg((current) => {
      if (next) return !current || current.owner === owner ? next : current;
      return current?.owner === owner ? null : current;
    });
  }, []);
  const value = useMemo(
    () => ({ dock, panel: reg?.state ?? null, register }),
    [dock, reg, register],
  );
  return (
    <DockContext.Provider value={value}>
      <div className="flex min-h-0 min-w-0 flex-1">
        {children}
        {/* empty = no width; a docked SheetContent gives it its own (380 px), a hidden one its rail */}
        <div ref={setDock} data-slot="details-dock" className="flex min-h-0 shrink-0" />
      </div>
    </DockContext.Provider>
  );
}
