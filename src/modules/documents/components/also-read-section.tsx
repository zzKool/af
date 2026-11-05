"use client";

// *Also read (N)* — what DI returned and the form does not show (F127, review 2026-10-31 §3): the scalar fields the
// mapper does not type, as name · printed text, read-only and copyable; the array and object fields (`Items`,
// `TaxDetails`, `PaymentDetails`) as *Name — N entries* with their entries' scalar children one level down, never
// flattened. Collapsed by default. Nothing editable here; nothing when the document has no `fields` (read before
// F127 — *Re-run OCR* fills it) or every field is typed.
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import {
  alsoReadFields,
  fieldEntries,
  fieldText,
  isCompoundField,
  type OcrField,
  type OcrFieldMap,
} from "@/kernel/ocr/fields";
import { DetailsSection } from "@/kernel/ui/details-section";

type AlsoReadSectionProps = {
  fields: OcrFieldMap | undefined;
  modelUsed: string | undefined;
};

type T = ReturnType<typeof useT>;

async function copyText(t: T, name: string, text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t("documents.review.copied", { name }));
  } catch {
    toast.error(t("documents.review.copyFailed"));
  }
}

function FieldName({ name }: { name: string }) {
  return (
    <dt className="truncate font-mono text-xs leading-5 text-muted-foreground" title={name}>
      {name}
    </dt>
  );
}

/** name · the printed text, with a copy button — the one read-only row of the section */
function ScalarRow({ t, name, field }: { t: T; name: string; field: OcrField }) {
  const text = fieldText(field);
  return (
    <div className="contents" data-testid="also-read-field">
      <FieldName name={name} />
      <dd className="flex min-w-0 items-start gap-1">
        <span className="min-w-0 flex-1 break-words leading-5 select-all">
          {text || <span className="text-muted-foreground">—</span>}
        </span>
        {text && (
          <Button
            size="sm"
            variant="ghost"
            className="size-5 shrink-0 p-0 text-muted-foreground"
            onClick={() => void copyText(t, name, text)}
            aria-label={t("documents.review.copy", { name })}
          >
            <Copy className="size-3.5" aria-hidden />
          </Button>
        )}
      </dd>
    </div>
  );
}

function entriesLabel(t: T, n: number) {
  return n === 1 ? t("documents.review.entries.one") : t("documents.review.entries", { count: n });
}

/** an array or object field: *N entries*, then each entry's scalar children one level down (a nested list is named, not opened) */
function CompoundRow({ t, name, field }: { t: T; name: string; field: OcrField }) {
  const entries = fieldEntries(field);
  return (
    <div className="contents" data-testid="also-read-compound">
      <FieldName name={name} />
      <dd className="min-w-0">
        <span className="leading-5 text-muted-foreground">{entriesLabel(t, entries.length)}</span>
        {entries.map(([entryName, entry]) => {
          const children: [string, OcrField][] = isCompoundField(entry)
            ? fieldEntries(entry)
            : [[`${name} ${entryName}`, entry]];
          return (
            <dl
              key={entryName}
              className="mt-1 ml-1 grid grid-cols-[minmax(90px,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1 border-l border-subtle pl-3"
              data-testid="also-read-entry"
            >
              {children.map(([childName, child]) =>
                isCompoundField(child) ? (
                  <div className="contents" key={childName}>
                    <FieldName name={childName} />
                    <dd className="leading-5 text-muted-foreground">
                      {entriesLabel(t, fieldEntries(child).length)}
                    </dd>
                  </div>
                ) : (
                  <ScalarRow key={childName} t={t} name={childName} field={child} />
                ),
              )}
            </dl>
          );
        })}
      </dd>
    </div>
  );
}

export function AlsoReadSection({ fields, modelUsed }: AlsoReadSectionProps) {
  const t = useT();
  const rows = alsoReadFields(fields && modelUsed ? { fields, modelUsed } : null);
  if (rows.length === 0) return null;

  return (
    <DetailsSection
      title={t("documents.review.alsoRead", { count: rows.length })}
      defaultOpen={false}
    >
      <dl
        className="grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]"
        data-testid="also-read"
      >
        {rows.map(([name, field]) =>
          isCompoundField(field) ? (
            <CompoundRow key={name} t={t} name={name} field={field} />
          ) : (
            <ScalarRow key={name} t={t} name={name} field={field} />
          ),
        )}
      </dl>
    </DetailsSection>
  );
}
