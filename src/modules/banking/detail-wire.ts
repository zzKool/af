// The bank-transaction detail as it crosses to the browser (audit 29) — pure, a leaf: the action maps the service's
// detail through it, the panel types its state with it, and nothing is cast on the way.
import type { TransactionDetail } from "./queries";

type Entry = NonNullable<TransactionDetail["entry"]>;
type Import = NonNullable<TransactionDetail["import"]>;

/** The detail's journal entry with its timestamps as ISO strings. */
export type TransactionEntryWire = Omit<Entry, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

/**
 * The detail as it crosses to the browser (the side panel): every timestamp an ISO string, so the type the panel
 * reads is the value it gets — no cast on the client side.
 */
export type TransactionDetailWire = Omit<
  TransactionDetail,
  "transaction" | "entry" | "links" | "import"
> & {
  transaction: Omit<TransactionDetail["transaction"], "createdAt"> & { createdAt: string };
  entry: TransactionEntryWire | null;
  links: (Omit<TransactionDetail["links"][number], "createdAt"> & { createdAt: string })[];
  import: (Omit<Import, "importedAt"> & { importedAt: string }) | null;
};

export function toTransactionEntryWire(e: Entry): TransactionEntryWire {
  return { ...e, createdAt: e.createdAt.toISOString(), updatedAt: e.updatedAt.toISOString() };
}

export function toTransactionDetailWire(d: TransactionDetail): TransactionDetailWire {
  return {
    ...d,
    transaction: { ...d.transaction, createdAt: d.transaction.createdAt.toISOString() },
    entry: d.entry ? toTransactionEntryWire(d.entry) : null,
    links: d.links.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    import: d.import ? { ...d.import, importedAt: d.import.importedAt.toISOString() } : null,
  };
}
