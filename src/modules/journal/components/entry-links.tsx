"use client";

// The panel's Proof section (T003, US3, FR-004). A manual entry lists its links (linking's read API) and, for the
// owner, offers *Link to…* — a document or a client invoice (supplier invoices and expenses write their own
// payments, D37); the allocation is proposed server-side. A bank entry is justified from its bank row (T001):
// the section points there.
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { DetailsSection } from "@/kernel/ui/details-section";
import { Tag } from "@/kernel/ui/tags";
import { linkEntryAction } from "@/modules/journal/journal.actions";
import {
  type EntityFacts,
  getLinksWithLabelsAction,
  type LinkRow,
  LinksList,
  searchLinkablesAction,
} from "@/modules/linking/ui";

const TARGETS = ["document", "invoice"] as const;

export function EntryLinks({
  entry,
  canWrite,
  onChanged,
}: {
  entry: {
    id: string;
    sourceType: "bank_transaction" | "manual";
    sourceId: string | null;
    currency: string;
  };
  canWrite: boolean;
  /** a link was added or removed — the host refreshes the ledger (the Proof column) */
  onChanged?: () => void;
}) {
  const t = useT();
  const manual = entry.sourceType === "manual";
  const [links, setLinks] = useState<LinkRow[] | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<EntityFacts[] | null>(null);
  const { executeAsync: load } = useAction(getLinksWithLabelsAction);
  const { executeAsync: search } = useAction(searchLinkablesAction);
  const { executeAsync: link, isPending: linking } = useAction(linkEntryAction);

  const reload = useCallback(async () => {
    if (!manual) return;
    const r = await load({ type: "journal_entry", id: entry.id });
    const d = r?.data && "data" in r.data ? r.data.data : undefined;
    if (d) setLinks(d.map((l) => ({ ...l, createdAt: String(l.createdAt) })));
  }, [manual, entry.id, load]);

  useEffect(() => {
    setLinks(null);
    setSearchOpen(false);
    setQuery("");
    setHits(null);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!searchOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const h = setTimeout(async () => {
      const r = await search({ q, types: [...TARGETS] });
      const d = r?.data && "data" in r.data ? r.data.data : undefined;
      if (!cancelled && d) setHits(d);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [query, searchOpen, search]);

  async function linkTo(hit: EntityFacts) {
    if (hit.type !== "document" && hit.type !== "invoice") return;
    const r = await link({ id: entry.id, to: { type: hit.type, id: hit.id } });
    const error = extractError(r);
    if (error) return toast.error(error);
    toast.success(t("linking.linked", { label: hit.label }));
    setSearchOpen(false);
    setQuery("");
    setHits(null);
    changed();
  }

  function changed() {
    void reload();
    onChanged?.();
  }

  return (
    <DetailsSection title={t("journal.panel.proof")}>
      <div data-testid="journal-proof" className="grid gap-2">
        {!manual ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>{t("journal.panel.bankProof")}</span>
            {entry.sourceId && (
              <Button
                size="sm"
                variant="outline"
                nativeButton={false}
                // the banking workbench opens its panel on `?open=` (linking's entityHref for a bank row)
                render={<Link href={`/banking?open=${entry.sourceId}`} />}
                data-testid="journal-open-transaction"
              >
                {t("journal.panel.openTransaction")}
              </Button>
            )}
          </div>
        ) : links === null ? (
          <p className="text-sm text-muted-foreground">…</p>
        ) : (
          <LinksList
            self={{ type: "journal_entry", id: entry.id }}
            links={links}
            canWrite={canWrite}
            fallbackCurrency={entry.currency}
            onChanged={changed}
          />
        )}
        {manual && canWrite && (
          <div>
            {!searchOpen ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSearchOpen(true)}
                data-testid="journal-link-to"
              >
                {t("linking.linkTo")}
              </Button>
            ) : (
              <div className="grid gap-2">
                <Input
                  placeholder={t("journal.panel.searchTargets")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  autoFocus
                  data-testid="journal-link-search"
                />
                {hits && (
                  <ul className="max-h-56 divide-y overflow-auto rounded-md border text-sm">
                    {hits.length === 0 && (
                      <li className="px-3 py-2 text-muted-foreground">
                        {t("linking.search.none")}
                      </li>
                    )}
                    {hits.map((h) => (
                      <li
                        key={`${h.type}:${h.id}`}
                        className="flex items-center gap-2 px-3 py-1.5"
                        data-testid="journal-link-hit"
                      >
                        <Tag>{t(`linking.type.${h.type}`)}</Tag>
                        <span className="min-w-0 flex-1 truncate" title={h.label}>
                          {h.label}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={linking}
                          onClick={() => void linkTo(h)}
                          data-testid="journal-link-hit-link"
                        >
                          {t("linking.link")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </DetailsSection>
  );
}
