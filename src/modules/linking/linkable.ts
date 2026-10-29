// The contract a module implements to make one of its entity types linkable (constitution §2).
// Implementations live in the owning module (e.g. src/modules/partners/linkable.ts) and are registered
// in src/modules/linking/linkables.ts. The linking module never imports a module's internals.
import type { AuditLogger } from "@/kernel/audit/types";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { TransactionClient } from "@/kernel/db/tenant-client";
import type { ServiceResult } from "@/kernel/errors/app-error";
import type { CandidateQuery, EntityFacts, LinkableSummary, LinkableType } from "./types";

/** A bank row pays the entity: the owning module's own payment path (D37 / D60), one `justifies` link. */
export type PayInput = {
  /** the entity */
  id: string;
  bankTransactionId: string;
  /** in the entity's currency; omitted = what is open on it (the module's rule) */
  amount?: string;
};

export type Linkable = {
  type: LinkableType;
  /** True when the entity exists in the caller's tenant (RLS-scoped tx). */
  exists(tx: TransactionClient, id: string): Promise<boolean>;
  /** Human-readable summary for lists, suggestions and the graph; null when the entity does not exist. */
  summary(tx: TransactionClient, id: string): Promise<LinkableSummary | null>;
  /** What the scorer needs about one entity (suggestions the other way round); null when it does not exist. */
  facts?(tx: TransactionClient, id: string): Promise<Omit<EntityFacts, "remaining"> | null>;
  /** The same for many ids in one go (the inbox); missing ids are left out. */
  factsMany?(
    tx: TransactionClient,
    ids: readonly string[],
  ): Promise<Omit<EntityFacts, "remaining">[]>;
  /** The entities a bank row of `direction` could justify, dated inside the window (cap `limit`). */
  candidates?(tx: TransactionClient, q: CandidateQuery): Promise<Omit<EntityFacts, "remaining">[]>;
  /**
   * Bank rows only (F116): the ids of the rows carrying each counterparty key, newest first (cap `limit` per key)
   * — what the counterparty memory reads the links of.
   */
  rowsByCounterparty?(
    tx: TransactionClient,
    keys: readonly string[],
    limit: number,
  ): Promise<Map<string, string[]>>;
  /** The entities whose label or texts contain `q` — the "Link to…" picker (cap `limit`). */
  search?(
    tx: TransactionClient,
    q: string,
    limit: number,
  ): Promise<Omit<EntityFacts, "remaining">[]>;
  /**
   * Entities that write their own payments (D37, `OWN_PAYMENT_FLOW`): the module's payment path, called by
   * linking's generic paths (*Link* on a suggestion, *Apply HIGH*, *Link to…*) so one click pays through the
   * module — its validations run (the payer, the direction, what is open), the link is the record (D60). Returns
   * the link it wrote.
   */
  pay?(
    tx: TransactionClient,
    caller: CallerIdentity,
    audit: AuditLogger,
    input: PayInput,
  ): Promise<ServiceResult<{ linkId: string }>>;
  /** The reverse: *Unlink* on such a link removes the payment through the module. */
  unpay?(
    tx: TransactionClient,
    caller: CallerIdentity,
    audit: AuditLogger,
    input: { id: string; linkId: string },
  ): Promise<ServiceResult<unknown>>;
};

const registry = new Map<LinkableType, Linkable>();
/** The modules' linkables, resolved on first use — module graphs are cyclic (every module imports linking). */
let provider: (() => Linkable[]) | null = null;

export function registerLinkable(linkable: Linkable): void {
  registry.set(linkable.type, linkable);
}

/** Lazy registration (linkables.ts): the thunk reads live module bindings, so import order never matters. */
export function provideLinkables(thunk: () => Linkable[]): void {
  provider = thunk;
}

function flush(): void {
  if (!provider) return;
  const thunk = provider;
  provider = null;
  for (const l of thunk()) if (!registry.has(l.type)) registry.set(l.type, l);
}

export function getLinkable(type: LinkableType): Linkable | undefined {
  flush();
  return registry.get(type);
}

export function listLinkableTypes(): LinkableType[] {
  flush();
  return [...registry.keys()];
}

/** Test seam: forget every registration (tests register fakes). */
export function _resetLinkables(): void {
  provider = null;
  registry.clear();
}
