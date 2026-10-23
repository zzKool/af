// Column layout of a DataTable — pure: what a user may change about a table (hidden columns, their order,
// their widths), how a stored layout is read back safely, and the arithmetic of moving and resizing.
// The layout is remembered per user per `tableKey` (`table_preferences`, ui-conventions v2).

export type TableLayout = {
  /** keys of the columns the user hid (defaults: `defaultHidden`) */
  hidden: string[];
  /** keys in display order; columns not listed keep their default place after the listed ones */
  order: string[];
  /** px per column key */
  widths: Record<string, number>;
  /** the docked details panel collapsed to its rail on this table's page (F74) — absent = open */
  panelHidden?: true;
};

export const MIN_COLUMN_WIDTH = 48;
export const MAX_COLUMN_WIDTH = 1200;
/** the arrow keys on the resize handle move by this much */
export const RESIZE_STEP = 8;

export const EMPTY_LAYOUT: TableLayout = { hidden: [], order: [], widths: {} };

/** A stored layout read back: anything malformed is dropped, so a stale or foreign value never breaks a table. */
export function normalizeLayout(raw: unknown): TableLayout {
  if (!raw || typeof raw !== "object") return EMPTY_LAYOUT;
  const r = raw as Record<string, unknown>;
  const strings = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const widths: Record<string, number> = {};
  if (r.widths && typeof r.widths === "object") {
    for (const [k, v] of Object.entries(r.widths as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) widths[k] = clampWidth(v);
    }
  }
  return {
    hidden: strings(r.hidden),
    order: [...new Set(strings(r.order))],
    widths,
    ...(r.panelHidden === true ? { panelHidden: true as const } : {}),
  };
}

export function clampWidth(px: number): number {
  return Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, px)));
}

/**
 * The columns in display order: the stored order first (keys that still exist), then every other column in its
 * default place. Pinned columns (no header — row actions) always stay at the end, in their default order.
 */
export function orderColumns<C extends { key: string; header?: unknown }>(
  columns: readonly C[],
  order: readonly string[],
): C[] {
  const byKey = new Map(columns.map((c) => [c.key, c]));
  const pinned = columns.filter((c) => isPinned(c));
  const movable = columns.filter((c) => !isPinned(c));
  const listed = order.map((k) => byKey.get(k)).filter((c): c is C => !!c && !isPinned(c));
  const seen = new Set(listed.map((c) => c.key));
  return [...listed, ...movable.filter((c) => !seen.has(c.key)), ...pinned];
}

export function isPinned(column: { header?: unknown }): boolean {
  return column.header === "";
}

/** The order after moving `key` by `delta` places among the movable columns (clamped to the ends). */
export function moveColumn<C extends { key: string; header?: unknown }>(
  columns: readonly C[],
  order: readonly string[],
  key: string,
  delta: number,
): string[] {
  const current = orderColumns(columns, order)
    .filter((c) => !isPinned(c))
    .map((c) => c.key);
  const from = current.indexOf(key);
  if (from < 0 || delta === 0) return [...current];
  const to = Math.max(0, Math.min(current.length - 1, from + delta));
  const next = [...current];
  next.splice(from, 1);
  next.splice(to, 0, key);
  return next;
}

/** The order after dropping `key` onto `target` (it takes the target's place, the target shifts). */
export function dropColumn<C extends { key: string; header?: unknown }>(
  columns: readonly C[],
  order: readonly string[],
  key: string,
  target: string,
): string[] {
  const current = orderColumns(columns, order)
    .filter((c) => !isPinned(c))
    .map((c) => c.key);
  const from = current.indexOf(key);
  const to = current.indexOf(target);
  if (from < 0 || to < 0 || from === to) return [...current];
  return moveColumn(columns, order, key, to - from);
}

/** True when the columns are as a default table shows them (the panel's open / hidden is not a column matter). */
export function isDefaultLayout(layout: TableLayout, defaultHidden: readonly string[]): boolean {
  const h = [...layout.hidden].sort().join("|");
  const d = [...defaultHidden].sort().join("|");
  return h === d && layout.order.length === 0 && Object.keys(layout.widths).length === 0;
}
