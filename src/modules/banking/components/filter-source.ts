// The header filters' data for a banking DataTable: one distinct action and one date-hierarchy action.
import type { DateHierarchy, DistinctValue, ListQuery } from "@/kernel/list-query/types";
import type { DataTableFilterSource } from "@/kernel/ui/data-table";

type Answer<T> =
  | {
      data?: { data?: T } | { error: { message: string } };
      serverError?: { message?: string };
    }
  | undefined;
type ReadAction<T> = (input: { column: never; query: ListQuery }) => Promise<Answer<T>>;

function unwrap<T>(r: Answer<T>, fallback: T, failed: string): T {
  if (r?.serverError) throw new Error(r.serverError.message ?? failed);
  const d = r?.data;
  if (d && "error" in d) throw new Error(d.error.message);
  return d?.data ?? fallback;
}

export function filterSourceOf(
  distinct: ReadAction<DistinctValue[]>,
  dateHierarchy: ReadAction<DateHierarchy>,
): DataTableFilterSource {
  return {
    distinct: async (column, query) =>
      unwrap(await distinct({ column: column as never, query }), [], "Failed to load values"),
    dateHierarchy: async (column, query) =>
      unwrap(
        await dateHierarchy({ column: column as never, query }),
        { years: [], empty: 0 },
        "Failed to load dates",
      ),
  };
}
