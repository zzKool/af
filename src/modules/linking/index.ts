// Server surface of the linking module (constitution §2, D18).
// Importing it registers every module's linkable (see ./linkables).
import "./linkables";

export {
  canAllocate,
  isSettled,
  remaining,
  settlementTolerance,
  sumAllocations,
} from "./allocation";
export { ALLOCATING_KINDS, isKindAllowed } from "./kinds";
export type { Linkable } from "./linkable";
export { _resetLinkables, getLinkable, listLinkableTypes, registerLinkable } from "./linkable";
export { createLink, removeLink, toLinkDto } from "./linking";
export {
  createLinkAction,
  getAllocationStatusAction,
  getLinksForAction,
  removeLinkAction,
} from "./linking.actions";
export * from "./queries";
export type * from "./types";
export { LINK_KINDS } from "./types";
