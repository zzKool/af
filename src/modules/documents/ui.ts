// Client surface of the module: components, server actions (client-safe references) and DTO types.
// Stores (Zustand hooks) stay module-internal — a server page importing this file must not pull hooks into its graph.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.
// document-preview (react-pdf) is NOT exported: pdfjs touches DOMMatrix at import time, which breaks SSR of any page
// whose graph reaches this barrel; the review client loads it with next/dynamic({ ssr: false }).

export * from "./components/document-classification-section";
export * from "./components/document-review-client";
export * from "./components/document-review-footer";
export * from "./components/document-review-form";
export * from "./components/document-review-header";
export * from "./components/document-state-label";
export * from "./components/documents-table";
export * from "./components/file-upload-zone";
export * from "./components/financial-fields-section";
export * from "./components/inbox-workbench";
export * from "./components/line-items-section";
export * from "./components/make-it-section";
export * from "./components/payment-details-section";
export * from "./components/relationship-fields-section";
export * from "./documents.actions";
export type { BilledToCheck, CompanyIdentity } from "./types";
