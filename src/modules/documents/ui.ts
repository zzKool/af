// Client surface of the module: components, server actions (client-safe references) and DTO types.
// Stores (Zustand hooks) stay module-internal — a server page importing this file must not pull hooks into its graph.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./components/document-classification-section";
export * from "./components/document-library-client";
export * from "./components/document-library-filters";
export * from "./components/document-preview";
export * from "./components/document-review-client";
export * from "./components/document-review-footer";
export * from "./components/document-review-form";
export * from "./components/document-review-header";
export * from "./components/document-stats-bar";
export * from "./components/document-upload-zone";
export * from "./components/file-upload-zone";
export * from "./components/financial-fields-section";
export * from "./components/line-items-section";
export * from "./components/payment-details-section";
export * from "./components/relationship-fields-section";
export * from "./documents.actions";
