"use client";

import { Label } from "@/components/ui/label";

type RelationshipFieldsSectionProps = {
  rawText?: string;
};

export function RelationshipFieldsSection({ rawText }: RelationshipFieldsSectionProps) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium">Document Content</h2>
      <div className="space-y-1">
        <Label htmlFor="rawText">Extracted Text (read-only)</Label>
        <textarea
          id="rawText"
          value={rawText ?? "No text extracted"}
          readOnly
          rows={12}
          className="w-full rounded-md border bg-muted/50 px-3 py-2 text-sm font-mono resize-y"
        />
      </div>
    </div>
  );
}
