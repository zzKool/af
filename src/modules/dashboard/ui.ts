// Client surface of the module: components, stores, server actions (client-safe references) and DTO types.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./components/action-items-widget";
export * from "./components/business-pulse-widget";
export * from "./dashboard.actions";
export type * from "./types";
