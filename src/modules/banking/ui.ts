// Client surface of the module: components, server actions (client-safe references) and DTO types.
// Stores (Zustand hooks) stay module-internal — a server page importing this file must not pull hooks into its graph.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./bank-accounts.actions";
export * from "./banking.actions";
export * from "./components/bank-accounts-tab";
export * from "./components/categorise-form";
export * from "./components/header-actions";
export * from "./components/import-dialog";
export * from "./components/imports-table";
export * from "./components/private-instruments";
export * from "./components/rule-dialog";
export * from "./components/rule-near-misses";
export * from "./components/rules-table";
export * from "./components/transaction-panel";
export * from "./components/transaction-state";
export * from "./components/transaction-table";
export type * from "./types";
