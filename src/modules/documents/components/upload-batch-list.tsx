"use client";

// F92 (D55): the result of a batch upload — one row per file, in drop order. A row is waiting, uploading,
// uploaded (its own provisional key → the review page), duplicate (the duplicate card's behaviour:
// *Use existing* / *Upload anyway*) or failed (the reason, *Try again*). The batch's state is derived from
// the rows, never stored: the summary line counts them.
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { type StateFamily, StateLabel } from "@/kernel/ui/state-label";
import { CodeChip } from "@/kernel/ui/tags";
import {
  type BatchItemStatus,
  countOutcomes,
  type UploadBatchItem,
} from "@/modules/documents/upload-batch";

/** A row's status → its state family and word, in one place. */
const ROW_STATE: Record<BatchItemStatus, { family: StateFamily; word: MessageKey }> = {
  queued: { family: "neutral", word: "documents.upload.batch.state.queued" },
  uploading: { family: "progress", word: "documents.upload.batch.state.uploading" },
  uploaded: { family: "done", word: "documents.upload.batch.state.uploaded" },
  duplicate: { family: "attention", word: "documents.upload.batch.state.duplicate" },
  failed: { family: "attention", word: "documents.upload.batch.state.failed" },
};

export function UploadBatchList({
  items,
  running,
  onRetry,
  onUploadAnyway,
  onReset,
}: {
  items: UploadBatchItem[];
  running: boolean;
  onRetry: (index: number) => void;
  onUploadAnyway: (index: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const counts = countOutcomes(items.map((it) => it.status));

  return (
    <div className="rounded-md border border-border" data-testid="upload-batch">
      <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2">
        <p className="text-[13px] font-semibold" data-testid="upload-batch-summary">
          {t("documents.upload.batch.summary", {
            done: counts.done,
            total: items.length,
            uploaded: counts.uploaded,
            duplicate: counts.duplicate,
            failed: counts.failed,
          })}
        </p>
        {!running && (
          <Button variant="outline" size="sm" onClick={onReset}>
            {t("documents.upload.batch.more")}
          </Button>
        )}
      </div>
      <ul className="max-h-80 divide-y divide-border-subtle overflow-y-auto">
        {items.map((item, index) => {
          const state = ROW_STATE[item.status];
          const outcome = item.outcome;
          return (
            <li
              // drop order is the identity of a row; a batch never reorders
              // biome-ignore lint/suspicious/noArrayIndexKey: two files may share a name
              key={index}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]"
              data-testid="upload-batch-row"
              data-status={item.status}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-xs" title={item.file.name}>
                {item.file.name}
              </span>
              <StateLabel family={state.family} state={t(state.word)} />

              {outcome?.kind === "uploaded" && (
                <Link href={`/documents/${outcome.doc.id}`} className="hover:underline">
                  <CodeChip>
                    <span data-testid="upload-batch-key">{outcome.doc.businessKey}</span>
                  </CodeChip>
                </Link>
              )}

              {outcome?.kind === "duplicate" && (
                <div className="flex w-full flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{t("documents.upload.batch.sameAs")}</span>
                  <CodeChip>
                    <span data-testid="upload-batch-duplicate-key">
                      {outcome.existing.businessKey}
                    </span>
                  </CodeChip>
                  <span>
                    {outcome.existing.uploadedByName
                      ? t("documents.upload.duplicate.uploadedBy", {
                          date: new Date(outcome.existing.createdAt).toISOString().slice(0, 10),
                          name: outcome.existing.uploadedByName,
                        })
                      : t("documents.upload.duplicate.uploaded", {
                          date: new Date(outcome.existing.createdAt).toISOString().slice(0, 10),
                        })}
                    {outcome.existing.became &&
                      ` · ${t(
                        outcome.existing.became.type === "expense"
                          ? "documents.upload.duplicate.becameExpense"
                          : "documents.upload.duplicate.becameSupplierInvoice",
                        { key: outcome.existing.became.key ?? "" },
                      )}`}
                  </span>
                  <span className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      render={<Link href={`/documents/${outcome.existing.id}`} />}
                    >
                      {t("documents.upload.duplicate.useExisting")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={running}
                      onClick={() => onUploadAnyway(index)}
                    >
                      {t("documents.upload.duplicate.uploadAnyway")}
                    </Button>
                  </span>
                </div>
              )}

              {outcome?.kind === "failed" && (
                <div className="flex w-full items-center gap-2 text-xs">
                  <span className="text-destructive" data-testid="upload-batch-reason">
                    {outcome.reason}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={running}
                    onClick={() => onRetry(index)}
                  >
                    {t("documents.upload.retry")}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
