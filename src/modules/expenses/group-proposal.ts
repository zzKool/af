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
  /** the month a batch group stands for (`yyyy-mm`, the stored fact — T025; a name is never read for it) */
  month?: string | null;
};

export type GroupProposalReason = "trip" | "month";

export type GroupProposal = {
  groupId: string | null;
  reason: GroupProposalReason | null;
};

const day = (s: string | null | undefined): string | null =>
  s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;

/**
 * `proposeGroupForDate(date, groups)`: the trip whose days cover `date` (several → the shortest, the most specific;
 * the same length → the later departure, the trip under way — never list order), else the batch group whose stored
 * `month` is the date's (T025 — the name is never parsed: `monthOfGroupName` became the migration's one-time
 * backfill), else nothing.
 */
export function proposeGroupForDate(
  date: string,
  groups: readonly GroupForProposal[],
): GroupProposal {
  const paperDay = day(date);
  if (!paperDay) return { groupId: null, reason: null };

  let trip: { id: string; span: number; from: string } | null = null;
  for (const g of groups) {
    if (g.kind !== undefined && g.kind !== "trip") continue;
    const from = day(g.departure);
    const to = day(g.return);
    if (!from || !to || paperDay < from || paperDay > to) continue;
    const span = Date.parse(to) - Date.parse(from);
    if (!trip || span < trip.span || (span === trip.span && from > trip.from))
      trip = { id: g.id, span, from };
  }
  if (trip) return { groupId: trip.id, reason: "trip" };

  const month = paperDay.slice(0, 7);
  const byMonth = groups.find((g) => g.kind !== "trip" && g.month === month);
  if (byMonth) return { groupId: byMonth.id, reason: "month" };

  return { groupId: null, reason: null };
}
