// Client surface of the module: components, server actions (client-safe references) and DTO types.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./traktamente.actions";
export type * from "./types";
