"use client";

// Per-user table layouts (ui-conventions v2): hidden columns, their order and widths, remembered under the
// table's key. The app layout provides what the server already knows (`TablePreferencesProvider` with the
// user's rows and a save action); the hook keeps a copy in localStorage so the layout is there before the
// first paint and still works without a provider (tests, previews). Writes go to storage at once and to the
// server debounced.
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
import {
  clampWidth,
  dropColumn,
  EMPTY_LAYOUT,
  isDefaultLayout,
  moveColumn,
  normalizeLayout,
  type TableLayout,
} from "./layout";

export type SaveTableLayout = (input: {
  tableKey: string;
  preferences: Record<string, unknown>;
}) => Promise<unknown>;

type Store = {
  get(tableKey: string): TableLayout | undefined;
  save(tableKey: string, layout: TableLayout): void;
};

const TablePreferencesContext = createContext<Store | null>(null);

export const SAVE_DEBOUNCE_MS = 600;

export function TablePreferencesProvider({
  initial,
  save,
  children,
}: {
  /** the user's stored layouts, by table key — what the server already knows */
  initial: Record<string, unknown>;
  save: SaveTableLayout;
  children: ReactNode;
}) {
  const layouts = useRef(new Map(Object.entries(initial).map(([k, v]) => [k, normalizeLayout(v)])));
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const store = useMemo<Store>(
    () => ({
      get: (key) => layouts.current.get(key),
      save: (key, layout) => {
        layouts.current.set(key, layout);
        const pending = timers.current.get(key);
        if (pending) clearTimeout(pending);
        timers.current.set(
          key,
          setTimeout(() => {
            timers.current.delete(key);
            void save({ tableKey: key, preferences: layout }).catch(() => {
              // the local copy stands; the next change tries again
            });
          }, SAVE_DEBOUNCE_MS),
        );
      },
    }),
    [save],
  );
  return (
    <TablePreferencesContext.Provider value={store}>{children}</TablePreferencesContext.Provider>
  );
}

const STORAGE_KEY = (tableKey: string) => `af.table.${tableKey}.layout`;
/** the key the visibility-only version wrote (ui-conventions v1) — read once, then superseded */
const LEGACY_HIDDEN_KEY = (tableKey: string) => `af.table.${tableKey}.hidden`;

function readLocal(tableKey: string): TableLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(tableKey));
    if (raw) return normalizeLayout(JSON.parse(raw));
    const legacy = localStorage.getItem(LEGACY_HIDDEN_KEY(tableKey));
    if (legacy)
      return { ...EMPTY_LAYOUT, hidden: normalizeLayout({ hidden: JSON.parse(legacy) }).hidden };
  } catch {
    // storage unavailable
  }
  return null;
}

function writeLocal(tableKey: string, layout: TableLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY(tableKey), JSON.stringify(layout));
  } catch {
    // ignore
  }
}

export type TableLayoutState = {
  layout: TableLayout;
  hidden: Set<string>;
  setHidden(next: Set<string>): void;
  /** move a column by `delta` places (the Columns menu's arrows) */
  move(key: string, delta: number): void;
  /** drop a dragged column onto another (header drag and drop) */
  drop(key: string, target: string): void;
  setWidth(key: string, px: number): void;
  reset(): void;
  isDefault: boolean;
  /** the docked details panel of this table's page collapsed to its rail — remembered like the columns */
  panelHidden: boolean;
  setPanelHidden(hidden: boolean): void;
};

/** The layout of one table: server copy first, else the browser's, else the columns' defaults. */
export function useTableLayout<
  C extends { key: string; header?: unknown; defaultHidden?: boolean; alwaysVisible?: boolean },
>(tableKey: string, columns: readonly C[]): TableLayoutState {
  const store = useContext(TablePreferencesContext);
  const defaultHidden = useMemo(
    () => columns.filter((c) => c.defaultHidden && !c.alwaysVisible).map((c) => c.key),
    [columns],
  );
  const [layout, setLayout] = useState<TableLayout>(
    () => store?.get(tableKey) ?? { ...EMPTY_LAYOUT, hidden: defaultHidden },
  );
  // the browser's copy, after mount (localStorage is not there on the server) — only when the server had none
  useEffect(() => {
    if (store?.get(tableKey)) return;
    const local = readLocal(tableKey);
    if (local) setLayout(local);
  }, [store, tableKey]);

  const commit = useCallback(
    (next: TableLayout) => {
      setLayout(next);
      writeLocal(tableKey, next);
      store?.save(tableKey, next);
    },
    [store, tableKey],
  );

  const hidden = useMemo(() => new Set(layout.hidden), [layout.hidden]);
  return {
    layout,
    hidden,
    setHidden: (next) => commit({ ...layout, hidden: [...next] }),
    move: (key, delta) =>
      commit({ ...layout, order: moveColumn(columns, layout.order, key, delta) }),
    drop: (key, target) =>
      commit({ ...layout, order: dropColumn(columns, layout.order, key, target) }),
    setWidth: (key, px) =>
      commit({ ...layout, widths: { ...layout.widths, [key]: clampWidth(px) } }),
    reset: () =>
      commit({
        ...EMPTY_LAYOUT,
        hidden: defaultHidden,
        ...(layout.panelHidden ? { panelHidden: true as const } : {}),
      }),
    isDefault: isDefaultLayout(layout, defaultHidden),
    panelHidden: layout.panelHidden === true,
    setPanelHidden: (h) => {
      const { panelHidden: _, ...rest } = layout;
      commit(h ? { ...rest, panelHidden: true } : rest);
    },
  };
}
