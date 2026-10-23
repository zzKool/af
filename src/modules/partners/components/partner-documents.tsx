"use client";

// The partner page's Documents tab: the documents linked to the partner, each with its key, file name, category
// and its derived state (D40) — the state comes from the documents module (`documentsByIds`), never typed here.
import Link from "next/link";
import type { ComponentProps } from "react";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { CodeChip, Tag } from "@/kernel/ui/tags";
import { DocumentStateLabel } from "@/modules/documents/ui";

/** a document linked to the partner (belongs_to) — plain facts from the documents module */
export type PartnerDocument = {
  id: string;
  businessKey: string;
  fileName: string;
  documentType: string;
  status: string;
  /** derived by the documents module (`documentsByIds`) */
  documentState: ComponentProps<typeof DocumentStateLabel>["state"];
};

const DOCUMENT_CATEGORY: Readonly<Record<string, MessageKey>> = {
  financial: "documents.category.financial",
  relationship: "documents.category.relationship",
};

export function PartnerDocuments({ documents }: { documents: readonly PartnerDocument[] }) {
  const t = useT();
  return (
    <ul className="rounded-lg border text-[13px]" data-testid="partner-documents">
      {documents.map((d) => {
        const category = DOCUMENT_CATEGORY[d.documentType];
        return (
          <li
            key={d.id}
            className="flex min-h-8 items-center justify-between gap-3 border-b border-subtle px-3 py-1 last:border-b-0"
          >
            <span className="flex min-w-0 items-center gap-2">
              <Link href={`/documents/${d.id}`} className="shrink-0 hover:underline">
                <CodeChip>{d.businessKey}</CodeChip>
              </Link>
              <span className="truncate font-mono text-xs text-muted-foreground">{d.fileName}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              {category && <Tag>{t(category)}</Tag>}
              <DocumentStateLabel
                state={d.documentState}
                testId={`partner-document-state-${d.id}`}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
