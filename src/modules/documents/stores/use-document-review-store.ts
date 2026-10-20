import { createTenantStore } from "@/kernel/stores/create-tenant-store";
import type { OcrExtractedData } from "@/modules/documents/documents.actions";

type SaveStatus = "idle" | "saving" | "saved" | "error";

type DocumentReviewStore = {
  corrections: Partial<OcrExtractedData>;
  saveStatus: Record<string, SaveStatus>;
  setCorrection: (field: string, value: unknown) => void;
  setCorrections: (patch: Partial<OcrExtractedData>) => void;
  setSaveStatus: (field: string, status: SaveStatus) => void;
  resetFromServer: (corrections: Partial<OcrExtractedData>) => void;
};

export const useDocumentReviewStore = createTenantStore<DocumentReviewStore>({
  corrections: {},
  saveStatus: {},
  setCorrection: () => {},
  setCorrections: () => {},
  setSaveStatus: () => {},
  resetFromServer: () => {},
});

// Initialize store actions (called once on mount)
const store = useDocumentReviewStore.store;
store.setState({
  setCorrection: (field: string, value: unknown) => {
    store.setState((state) => ({
      corrections: { ...state.corrections, [field]: value },
    }));
  },
  setCorrections: (patch: Partial<OcrExtractedData>) => {
    store.setState((state) => ({
      corrections: { ...state.corrections, ...patch },
    }));
  },
  setSaveStatus: (field: string, status: SaveStatus) => {
    store.setState((state) => ({
      saveStatus: { ...state.saveStatus, [field]: status },
    }));
  },
  resetFromServer: (corrections: Partial<OcrExtractedData>) => {
    store.setState({ corrections, saveStatus: {} });
  },
});
