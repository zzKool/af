// Client surface of the module: components, stores, server actions (client-safe references) and DTO types.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./components/partner-detail-tabs";
export * from "./components/partner-form";
export * from "./components/partner-list";
export * from "./partners.actions";
export type * from "./types";
