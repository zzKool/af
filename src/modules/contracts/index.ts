// Server surface of the module: DTO types, read API (queries), services (writes, schemas, helpers), actions, jobs.
// The ONLY path other modules and src/app may import for server-side code (constitution §2).
// Never import this file from a client component — use ./ui for components and stores.

export type { CreateContractInput, UpdateContractInput } from "./contracts";
export {
  createContract,
  createContractSchema,
  deactivateContract,
  reactivateContract,
  toContractDto,
  updateContract,
  updateContractSchema,
} from "./contracts";
export {
  createContractAction,
  deactivateContractAction,
  getContractAction,
  getContractsAction,
  reactivateContractAction,
  updateContractAction,
} from "./contracts.actions";
export { contractLinkable } from "./linkable";
export * from "./queries";
export type * from "./types";
