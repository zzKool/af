// Client surface of the module: components, server actions (client-safe references) and DTO types.
// Stores (Zustand hooks) stay module-internal — a server page importing this file must not pull hooks into its graph.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./components/action-items-widget";
export * from "./components/business-pulse-widget";
export * from "./dashboard.actions";
export type * from "./types";
