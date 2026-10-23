"use client";

// The links of one entity as a list — kind, the other side's label, the allocation — with *Unlink* for the
// owner (US2). Shared by the banking panel, the invoice page and the entity panels. A payment of an expense or a
// supplier invoice is removed from that entity's panel (D37, F58): *Open* there instead of *Unlink*.
import Link from "next/link";
import { useAction } from "next-safe-action/hooks";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { removeLinkAction } from "@/modules/linking/linking.actions";
import type { LinkDto, LinkEndpoint } from "@/modules/linking/types";
import { entityHref } from "../hrefs";
import { needsOwnFlow } from "../kinds";
import { moneyText } from "./money";

export type LinkRow = Omit<LinkDto, "createdAt"> & { createdAt: string; otherLabel: string | null };

export function LinksList({
  self,
  links,
  canWrite,
  fallbackCurrency,
  onChanged,
}: {
  /** the entity whose links these are — the other side is what gets labelled */
  self: LinkEndpoint;
  links: LinkRow[];
  canWrite: boolean;
  fallbackCurrency: string;
  onChanged?: () => void;
}) {
  const t = useT();
  const { executeAsync: remove, isPending } = useAction(removeLinkAction);

  async function unlink(id: string) {
    const r = await remove({ id });
    const error = extractError(r);
    if (error) return toast.error(error);
    toast.success(t("linking.unlinked"));
    onChanged?.();
  }

  if (links.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("linking.noLinks")}</p>;
  }
  return (
    <ul className="divide-y rounded-md border text-sm">
      {links.map((l) => {
        const other = l.from.type === self.type && l.from.id === self.id ? l.to : l.from;
        return (
          <li
            key={l.id}
            className="flex items-center justify-between gap-2 px-3 py-1.5"
            data-testid="link-row"
          >
            <span className="min-w-0 truncate">
              <Badge variant="outline" className="mr-2">
                {t(`linking.kind.${l.kind}`)}
              </Badge>
              <span title={l.otherLabel ?? undefined}>
                {l.otherLabel ?? `${t(`linking.type.${other.type}`)} ${other.id}`}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {l.allocatedAmount && (
                <span className="tabular-nums">
                  {moneyText(l.allocatedAmount, l.currency ?? fallbackCurrency) ??
                    l.allocatedAmount}
                </span>
              )}
              {canWrite && needsOwnFlow(l.kind, l.to.type) && (
                <Button
                  size="sm"
                  variant="ghost"
                  nativeButton={false}
                  render={<Link href={entityHref({ ...l.to, label: l.otherLabel ?? "" })} />}
                  data-testid="open-own"
                >
                  {t("linking.graph.openEntity")}
                </Button>
              )}
              {canWrite && l.kind !== "created_from" && !needsOwnFlow(l.kind, l.to.type) && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isPending}
                  onClick={() => void unlink(l.id)}
                  data-testid="unlink"
                >
                  {t("linking.unlink")}
                </Button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
