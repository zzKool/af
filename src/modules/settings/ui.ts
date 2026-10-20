// Client surface of the module: components, server actions (client-safe references) and DTO types.
// Stores (Zustand hooks) stay module-internal — a server page importing this file must not pull hooks into its graph.
// Safe to import from client components and pages. Never re-export services from here — they would pull Prisma into the bundle.

export * from "./bas-preferences.actions";
export * from "./components/bas-categories-tab";
export * from "./components/company-profile-form";
export * from "./components/my-preferences-tab";
export * from "./components/vat-registrations-tab";
export * from "./settings.actions";
export * from "./table-preferences.actions";
export * from "./user-preferences.actions";
export * from "./vat-registrations.actions";
