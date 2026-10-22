// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions, jobs.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and stores.

export type { CreatePartnerContactInput, UpdatePartnerContactInput } from "./contacts";
export {
  createPartnerContact,
  createPartnerContactSchema,
  deletePartnerContact,
  listPartnerContacts,
  updatePartnerContact,
  updatePartnerContactSchema,
} from "./contacts";
export { partnerLinkable } from "./linkable";
export { BEST_MATCH_PERCENT, matchPartners, rankPartnerMatches, scorePartnerMatch } from "./match";
export type { CreatePartnerInput, UpdatePartnerInput } from "./partners";
export {
  createPartner,
  createPartnerSchema,
  deactivatePartner,
  reactivatePartner,
  toPartnerDto,
  updatePartner,
  updatePartnerSchema,
} from "./partners";
export {
  createPartnerAction,
  createPartnerContactAction,
  deactivatePartnerAction,
  deletePartnerContactAction,
  distinctPartnersAction,
  getPartnerAction,
  getPartnersAction,
  listPartnerContactsAction,
  matchPartnersAction,
  partnerDateHierarchyAction,
  reactivatePartnerAction,
  searchPartnersAction,
  updatePartnerAction,
  updatePartnerContactAction,
} from "./partners.actions";
export * from "./queries";
export type * from "./types";
