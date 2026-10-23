// Client surface of the module: components, server actions (client-safe references) and DTO types.
// Stores (Zustand hooks) stay module-internal — a server page importing this file must not pull hooks into its graph.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./components/new-partner-button";
export * from "./components/ocr-address";
export * from "./components/partner-detail-tabs";
export * from "./components/partner-form";
export * from "./components/partner-labels";
export * from "./components/partner-table";
export * from "./partners.actions";
export type * from "./types";
