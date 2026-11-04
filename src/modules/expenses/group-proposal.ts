// The group a paper's date proposes (review 2026-10-31 §5.2, F131): an open trip group whose departure–return covers
// the date wins (*213 Switzerland, March 2026 — proposed (the trip)*), else the group of the date's month, else
// nothing — the caller offers *+ New group*. A proposal comes from a fact, never from list order (lessons *F124
// build*). Pure and client-safe: the reading dialog (linking) and the Expenses pickers (T018) both run it in the
// browser on the groups the page loaded.

export type GroupForProposal = {
  id: string;
  name: string;
  kind?: "trip" | "batch";
  /** the trip's first and last day (`yyyy-mm-dd`, a timestamp is read to its day); both needed for a trip to count */
  departure?: string | null;
  return?: string | null;
  /** the month a batch group stands for (`yyyy-mm`); `monthOfGroupName` reads it from the name when nothing stored it */
  month?: string | null;
};

export type GroupProposalReason = "trip" | "month";

export type GroupProposal = {
  groupId: string | null;
  reason: GroupProposalReason | null;
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const day = (s: string | null | undefined): string | null =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

/** The month a group's name says it stands for: `2026-07 …` / `… 2026-07` → `2026-07`; `July 2026`, `Jul 2026` → `2026-07`; else null. */
export function monthOfGroupName(name: string): string | null {
  const iso = /(?:^|[^\d])(\d{4})-(\d{2})(?!\d)/.exec(name);
  if (iso) {
    const m = Number(iso[2]);
    if (m >= 1 && m <= 12) return `${iso[1]}-${iso[2]}`;
  }
  const words = /\b([A-Za-z]{3,9})\.?\s+(\d{4})\b/.exec(name);
  if (words) {
    const token = words[1].toLowerCase();
    const index = MONTHS.findIndex(
      (m) => m === token || (token.length >= 3 && m.startsWith(token)),
    );
    if (index >= 0) return `${words[2]}-${String(index + 1).padStart(2, "0")}`;
  }
  return null;
}

/**
 * `proposeGroupForDate(date, groups)`: the trip whose days cover `date` (several → the shortest, the most specific),
 * else the group whose month is the date's (a stored `month`, else the one its name says), else nothing.
 */
export function proposeGroupForDate(
  date: string,
  groups: readonly GroupForProposal[],
): GroupProposal {
  const paperDay = day(date);
  if (!paperDay) return { groupId: null, reason: null };

  let trip: { id: string; span: number } | null = null;
  for (const g of groups) {
    if (g.kind !== undefined && g.kind !== "trip") continue;
    const from = day(g.departure);
    const to = day(g.return);
    if (!from || !to || paperDay < from || paperDay > to) continue;
    const span = Date.parse(to) - Date.parse(from);
    if (!trip || span < trip.span) trip = { id: g.id, span };
  }
  if (trip) return { groupId: trip.id, reason: "trip" };

  const month = paperDay.slice(0, 7);
  const byMonth = groups.find(
    (g) => g.kind !== "trip" && (g.month ?? monthOfGroupName(g.name)) === month,
  );
  if (byMonth) return { groupId: byMonth.id, reason: "month" };

  return { groupId: null, reason: null };
}
