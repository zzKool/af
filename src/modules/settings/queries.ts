// Read API of the module — the functions pages and other modules may call for data.
// 3b/3d: declared here as named re-exports; extraction into standalone query implementations
// (ListQuery, distinct values for DataTable headers) happens with the partners reference slice.

export {
  basLabels,
  getBasCategories,
  getBasCategory,
  getTenantBasPreferences,
} from "./bas-preferences";
export { getTenantProfile, listTenantMembers } from "./settings";
export { getTablePreference } from "./table-preferences";
export { getUserPreferences } from "./user-preferences";
export { getVatRegistrations } from "./vat-registrations";
