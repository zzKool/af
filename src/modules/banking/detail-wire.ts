// The bank-transaction detail as it crosses to the browser (audit 29) — pure, a leaf: the action maps the service's
// detail through it, the panel types its state with it, and nothing is cast on the way.
import type { TransactionDetail } from "./queries";
import type { BankTransactionDto } from "./types";

type Import = NonNullable<TransactionDetail["import"]>;

/** The row with its facts, timestamps as ISO strings. */
export type TransactionWire = Omit<BankTransactionDto, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

/**
 * The detail as it crosses to the browser (the side panel): every timestamp an ISO string, so the type the panel
 * reads is the value it gets — no cast on the client side.
 */
export type TransactionDetailWire = Omit<TransactionDetail, "transaction" | "links" | "import"> & {
  transaction: TransactionWire & { bankImplicitRate: string | null };
  links: (Omit<TransactionDetail["links"][number], "createdAt"> & { createdAt: string })[];
  import: (Omit<Import, "importedAt"> & { importedAt: string }) | null;
};

export function toTransactionWire<T extends BankTransactionDto>(
  t: T,
): Omit<T, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string } {
  return { ...t, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() };
}

export function toTransactionDetailWire(d: TransactionDetail): TransactionDetailWire {
  return {
    ...d,
    transaction: toTransactionWire(d.transaction),
    links: d.links.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    import: d.import ? { ...d.import, importedAt: d.import.importedAt.toISOString() } : null,
  };
}
