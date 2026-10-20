// The contract a module implements to make one of its entity types linkable (constitution §2).
// Implementations live in the owning module (e.g. src/modules/partners/linkable.ts) and are registered
// in src/modules/linking/linkables.ts. The linking module never imports a module's internals.
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { LinkableSummary, LinkableType } from "./types";

export type Linkable = {
  type: LinkableType;
  /** True when the entity exists in the caller's tenant (RLS-scoped tx). */
  exists(tx: TransactionClient, id: string): Promise<boolean>;
  /** Human-readable summary for lists, suggestions and the graph; null when the entity does not exist. */
  summary(tx: TransactionClient, id: string): Promise<LinkableSummary | null>;
};

const registry = new Map<LinkableType, Linkable>();

export function registerLinkable(linkable: Linkable): void {
  registry.set(linkable.type, linkable);
}

export function getLinkable(type: LinkableType): Linkable | undefined {
  return registry.get(type);
}

export function listLinkableTypes(): LinkableType[] {
  return [...registry.keys()];
}

/** Test seam: forget every registration (tests register fakes). */
export function _resetLinkables(): void {
  registry.clear();
}
