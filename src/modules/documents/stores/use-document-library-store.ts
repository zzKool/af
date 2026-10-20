import { createTenantStore } from "@/kernel/stores/create-tenant-store";
import type { DocumentFilters, DocumentSort } from "@/modules/documents/documents.actions";

type DocumentLibraryStore = {
  filters: DocumentFilters;
  sort: DocumentSort;
  page: number;
  pageSize: number;
  setFilters: (filters: Partial<DocumentFilters>) => void;
  setSort: (sort: DocumentSort) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  clearFilters: () => void;
};

const DEFAULT_SORT: DocumentSort = { field: "createdAt", direction: "desc" };
const DEFAULT_PAGE_SIZE = 25;

export const useDocumentLibraryStore = createTenantStore<DocumentLibraryStore>({
  filters: {},
  sort: DEFAULT_SORT,
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  setFilters: () => {},
  setSort: () => {},
  setPage: () => {},
  setPageSize: () => {},
  clearFilters: () => {},
});

// Initialize store actions (called once on module load)
const store = useDocumentLibraryStore.store;
store.setState({
  setFilters: (filters: Partial<DocumentFilters>) => {
    store.setState((state) => ({
      filters: { ...state.filters, ...filters },
      page: 1, // reset to page 1 on filter change
    }));
  },
  setSort: (sort: DocumentSort) => {
    store.setState({ sort, page: 1 });
  },
  setPage: (page: number) => {
    store.setState({ page });
  },
  setPageSize: (pageSize: number) => {
    store.setState({ pageSize, page: 1 });
  },
  clearFilters: () => {
    store.setState({ filters: {}, page: 1 });
  },
});
