// Client surface of the module: components, stores, server actions (client-safe references) and DTO types.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./bank-accounts.actions";
export * from "./components/bank-accounts-tab";
