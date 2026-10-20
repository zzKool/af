"use client";

// URL ⇄ ListQuery for a list page. The URL is the state (shareable, back-button safe); updating it
// re-renders the server component that loads the rows, so the table never fetches by itself.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useTransition } from "react";
import { parseListQuery, serializeListQuery } from "@/kernel/list-query/codec";
import type { Filter, ListQuery, SortSpec } from "@/kernel/list-query/types";

export interface UseListQueryOptions {
  columns: readonly string[];
  defaultSort?: SortSpec[];
  defaultPageSize?: number;
}

export interface ListQueryState {
  query: ListQuery;
  /** A navigation is in flight (rows are being reloaded). */
  isPending: boolean;
  setFilter: (column: string, filter: Filter | null) => void;
  clearFilters: () => void;
  setSort: (sort: SortSpec[]) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setSearch: (search: string) => void;
}

export function useListQuery(options: UseListQueryOptions): ListQueryState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const parseOptions = useMemo(
    () => ({
      columns: options.columns,
      defaultSort: options.defaultSort,
      defaultPageSize: options.defaultPageSize,
    }),
    [options.columns, options.defaultSort, options.defaultPageSize],
  );

  const query = useMemo(
    () => parseListQuery(searchParams, parseOptions),
    [searchParams, parseOptions],
  );

  const navigate = useCallback(
    (next: ListQuery) => {
      const params = serializeListQuery(next, parseOptions).toString();
      startTransition(() => {
        router.replace(params ? `${pathname}?${params}` : pathname, { scroll: false });
      });
    },
    [router, pathname, parseOptions],
  );

  const setFilter = useCallback(
    (column: string, filter: Filter | null) => {
      const filters = { ...query.filters };
      if (filter) filters[column] = filter;
      else delete filters[column];
      navigate({ ...query, filters, page: 1 });
    },
    [query, navigate],
  );

  return {
    query,
    isPending,
    setFilter,
    clearFilters: () => navigate({ ...query, filters: {}, search: undefined, page: 1 }),
    setSort: (sort) => navigate({ ...query, sort, page: 1 }),
    setPage: (page) => navigate({ ...query, page }),
    setPageSize: (pageSize) => navigate({ ...query, pageSize, page: 1 }),
    setSearch: (search) => navigate({ ...query, search: search.trim() || undefined, page: 1 }),
  };
}
