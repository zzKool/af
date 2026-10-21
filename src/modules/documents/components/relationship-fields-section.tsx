"use client";

import { Label } from "@/components/ui/label";
import { useT } from "@/kernel/i18n/use-t";

type RelationshipFieldsSectionProps = {
  rawText?: string;
};

export function RelationshipFieldsSection({ rawText }: RelationshipFieldsSectionProps) {
  const t = useT();
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">{t("documents.review.content")}</h2>
      <div className="space-y-1">
        <Label htmlFor="rawText">{t("documents.review.rawText")}</Label>
        <textarea
          id="rawText"
          value={rawText ?? t("documents.review.noText")}
          readOnly
          rows={12}
          className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono resize-y"
        />
      </div>
    </div>
  );
}
