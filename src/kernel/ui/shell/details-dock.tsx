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
//
// Width per table (F131, the work surface): the panel is resizable — a handle on its left edge, min 340 px,
// max 75 % of the canvas — and the chosen width is remembered with the same layout (`panelWidth`); the page
// names its default (`defaultWidth` on SheetContent: px, or a fraction of the canvas such as "55%"). The dock
// measures the canvas so a fraction resolves to pixels; the table narrows by layout (the dock is `shrink-0`).
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
export type DockedPanelState = {
  hidden: boolean;
  setHidden(hidden: boolean): void;
  /** the width the user dragged to, px; null = the page's default */
  width: number | null;
  setWidth(px: number | null): void;
};

/** A page's default panel width: px, or a fraction of the canvas ("55%"). */
export type PanelWidth = number | `${number}%`;

/** the narrowest the panel goes */
export const MIN_PANEL_WIDTH = 340;
/** the widest, as a share of the canvas (the list keeps a quarter at least) */
export const MAX_PANEL_FRACTION = 0.75;
/** ← / → on the handle move it by this much */
export const PANEL_RESIZE_STEP = 40;
/** the kit's default (`w-[380px] xl:w-[400px]`) — what the keyboard starts from when nothing is measured */
export const DEFAULT_PANEL_WIDTH = 380;

/** A width inside the bounds: at least `MIN_PANEL_WIDTH`, at most 75 % of a known canvas. */
export function clampPanelWidth(px: number, canvasWidth: number): number {
  const max =
    canvasWidth > 0 ? Math.floor(canvasWidth * MAX_PANEL_FRACTION) : Number.POSITIVE_INFINITY;
  return Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(max, px)));
}

/**
 * The width to apply, in px — the remembered one, else the page's default; null = the kit's CSS default (a
 * fraction cannot be resolved before the canvas is measured, so it waits for the measure rather than guess).
 */
export function resolvePanelWidth(
  stored: number | null | undefined,
  defaultWidth: PanelWidth | undefined,
  canvasWidth: number,
): number | null {
  if (stored != null && Number.isFinite(stored)) return clampPanelWidth(stored, canvasWidth);
  if (typeof defaultWidth === "number") return clampPanelWidth(defaultWidth, canvasWidth);
  if (typeof defaultWidth === "string") {
    const pct = Number.parseFloat(defaultWidth);
    if (!Number.isFinite(pct) || canvasWidth <= 0) return null;
    return clampPanelWidth((canvasWidth * pct) / 100, canvasWidth);
  }
  return null;
}

type Registration = { owner: symbol; state: DockedPanelState };

type DockContextValue = {
  dock: HTMLElement | null;
  panel: DockedPanelState | null;
  /** the canvas row's width in px (0 until measured — tests, the server) */
  canvasWidth: number;
  register(reg: Registration | null, owner: symbol): void;
};

const DockContext = createContext<DockContextValue | null>(null);

/** The element the details panel docks into, or null outside the app shell. */
export function useDetailsDock(): HTMLElement | null {
  return useContext(DockContext)?.dock ?? null;
}

/** The page table's remembered open / hidden / width, or null when no table registered one (the panel just opens). */
export function useDockedPanelState(): DockedPanelState | null {
  return useContext(DockContext)?.panel ?? null;
}

/** The width of the canvas row the dock sits in (the list + the panel), 0 when unknown. */
export function useDockCanvasWidth(): number {
  return useContext(DockContext)?.canvasWidth ?? 0;
}

/**
 * Called by a DataTable: offer its remembered panel state to the dock. The first table on a page wins (a page with
 * a details panel has one main table); the registration goes when the table unmounts.
 */
export function useDockedPanel(state: DockedPanelState): void {
  const ctx = useContext(DockContext);
  const register = ctx?.register;
  const owner = useRef(Symbol("table")).current;
  const setters = useRef({ setHidden: state.setHidden, setWidth: state.setWidth });
  setters.current = { setHidden: state.setHidden, setWidth: state.setWidth };
  const { hidden, width } = state;
  useEffect(() => {
    if (!register) return;
    register(
      {
        owner,
        state: {
          hidden,
          width,
          setHidden: (h) => setters.current.setHidden(h),
          setWidth: (px) => setters.current.setWidth(px),
        },
      },
      owner,
    );
  }, [register, owner, hidden, width]);
  useEffect(() => {
    if (!register) return;
    return () => register(null, owner);
  }, [register, owner]);
}

/** The canvas row: the page's scroll container on the left, the dock on the right. */
export function DockedCanvas({ children }: { children: ReactNode }) {
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const [reg, setReg] = useState<Registration | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);
  const register = useCallback((next: Registration | null, owner: symbol) => {
    setReg((current) => {
      if (next) return !current || current.owner === owner ? next : current;
      return current?.owner === owner ? null : current;
    });
  }, []);
  // the row's width, kept current (a fraction of it is the work surface's default; the max is 75 % of it)
  const observer = useRef<ResizeObserver | null>(null);
  const setRow = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    setCanvasWidth(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setCanvasWidth(Math.round(w));
    });
    observer.current.observe(el);
  }, []);
  const value = useMemo(
    () => ({ dock, panel: reg?.state ?? null, canvasWidth, register }),
    [dock, reg, canvasWidth, register],
  );
  return (
    <DockContext.Provider value={value}>
      <div ref={setRow} className="flex min-h-0 min-w-0 flex-1" data-slot="details-canvas">
        {children}
        {/* empty = no width; a docked SheetContent gives it its own (380 px, or the page's), a hidden one its rail */}
        <div ref={setDock} data-slot="details-dock" className="flex min-h-0 shrink-0" />
      </div>
    </DockContext.Provider>
  );
}
