"use client";

// The invoice page's bank side (specs/linking US1-6, US2): the rows that pay it — linked ones with *Unlink*,
// the suggested ones with *Link* — so a client invoice can be justified from its own page.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/kernel/i18n/use-t";
import {
  getLinksWithLabelsAction,
  type LinkRow,
  LinksList,
  SuggestionsSection,
} from "@/modules/linking/ui";

export function InvoiceLinks({
  invoiceId,
  currency,
  canWrite,
}: {
  invoiceId: string;
  currency: string;
  canWrite: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [version, setVersion] = useState(0);
  const { executeAsync: load } = useAction(getLinksWithLabelsAction);

  const reload = useCallback(async () => {
    const r = await load({ type: "invoice", id: invoiceId });
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) setLinks(d.map((l) => ({ ...l, createdAt: String(l.createdAt) })));
  }, [invoiceId, load]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function changed() {
    void reload();
    setVersion((v) => v + 1);
    router.refresh();
  }

  return (
    <div className="rounded-lg border p-3" data-testid="invoice-links">
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        {t("invoices.links.title")}
      </div>
      <div className="mb-3">
        {links === null ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : (
          <LinksList
            self={{ type: "invoice", id: invoiceId }}
            links={links}
            canWrite={canWrite}
            fallbackCurrency={currency}
            onChanged={changed}
          />
        )}
      </div>
      <SuggestionsSection
        target={{ endpoint: { type: "invoice", id: invoiceId } }}
        canWrite={canWrite}
        onLinked={changed}
        refreshKey={version}
      />
    </div>
  );
}
