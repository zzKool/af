"use client";

// The entity duplicate panel (specs/documents US3, D32), shared by the expense and the supplier-invoice dialogs:
// a *high* match blocks until the owner says why it is not a duplicate; a *medium* match only warns. The hook
// runs the module's check action when the key fields settle (debounced) and clears it when the dialog closes.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { StateIcon } from "@/kernel/ui/state-label";
import { Tag } from "@/kernel/ui/tags";
import type { DuplicateMatch } from "@/modules/expenses/types";

export const DUPLICATE_CHECK_DEBOUNCE_MS = 400;

/** Where a matched entity opens — the lists' `?open=` (specs/linking hrefs). */
export function duplicateHref(m: DuplicateMatch): string {
  return m.entityType === "expense"
    ? `/expenses?open=${m.entityId}`
    : `/supplier-invoices?open=${m.entityId}`;
}

export function hasHighMatch(matches: readonly DuplicateMatch[]): boolean {
  return matches.some((m) => m.confidence === "high");
}

/**
 * Debounced duplicate check: `check` is the module's action, `key` the serialised query (the fields that
 * matter); an empty key clears. The last answer wins — an older response arriving late is dropped.
 */
export function useDuplicateCheck(
  enabled: boolean,
  key: string,
  check: () => Promise<DuplicateMatch[]>,
): DuplicateMatch[] {
  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const seq = useRef(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the serialised query; `check` reads the live fields
  useEffect(() => {
    if (!enabled || !key) {
      setMatches([]);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      check()
        .then((m) => {
          if (seq.current === mine) setMatches(m);
        })
        .catch(() => {
          if (seq.current === mine) setMatches([]);
        });
    }, DUPLICATE_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [enabled, key]);
  return matches;
}

export function DuplicatePanel({
  matches,
  ackNote,
  onAckNote,
}: {
  matches: readonly DuplicateMatch[];
  ackNote: string;
  onAckNote: (note: string) => void;
}) {
  const t = useT();
  if (matches.length === 0) return null;
  const high = hasHighMatch(matches);
  const reason = (m: DuplicateMatch) => t(m.reason.key as MessageKey, m.reason.params);
  return (
    <div
      // D40: no palette colour — the tag background, the attention icon carries a high match (with the word)
      className="sm:col-span-2 rounded-lg bg-tag px-3 py-2 text-[13px]"
      data-testid="duplicate-panel"
      data-confidence={high ? "high" : "medium"}
      role={high ? "alert" : "status"}
    >
      <div className="flex items-center gap-2 font-medium">
        <StateIcon family={high ? "attention" : "neutral"} />
        {high ? t("documents.duplicate.panel.title") : t("documents.duplicate.panel.similar")}
      </div>
      <ul className="mt-1 space-y-0.5">
        {matches.map((m) => (
          <li key={`${m.entityType}:${m.entityId}`} className="flex flex-wrap items-center gap-x-2">
            <Tag className="bg-surface font-mono text-[11px] uppercase">{m.confidence}</Tag>
            <span>{reason(m)}</span>
            <Link
              href={duplicateHref(m)}
              className="text-primary hover:text-primary-hover hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              {t("documents.duplicate.panel.open", { key: m.entityKey })}
            </Link>
          </li>
        ))}
      </ul>
      {high && (
        <div className="mt-2">
          <label htmlFor="duplicate-ack-note" className="mb-1 block text-xs font-medium">
            {t("documents.duplicate.panel.note")}
          </label>
          <Input
            id="duplicate-ack-note"
            value={ackNote}
            onChange={(e) => onAckNote(e.target.value)}
            placeholder={t("documents.duplicate.panel.notePlaceholder")}
            data-testid="duplicate-ack-note"
          />
        </div>
      )}
    </div>
  );
}
