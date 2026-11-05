"use client";

// DI's confidence of one typed field, beside its label (F127, review 2026-10-31 §3): a small muted glyph —
// `·` ≥ 0.90 · `?` 0.70–0.90 · `!` < 0.70 — the figure in the title, the band in words as the accessible name. No
// colour: it is metadata about the reading, not a state (D40). Nothing when the document has no confidence for
// the field (read before F127, or the mapper fell back on nothing).
import { useT } from "@/kernel/i18n/use-t";
import { CONFIDENCE_GLYPH, confidenceLabel } from "@/kernel/ocr/confidence";

export function FieldConfidence({ confidence }: { confidence: number | null | undefined }) {
  const t = useT();
  const band = confidenceLabel(confidence);
  if (!band || typeof confidence !== "number") return null;
  return (
    <span
      role="img"
      aria-label={t(`documents.review.confidence.${band}`)}
      title={t("documents.review.confidenceValue", { value: confidence.toFixed(2) })}
      data-testid="field-confidence"
      data-confidence-band={band}
      className="inline-flex size-4 shrink-0 items-center justify-center rounded-md bg-tag font-mono text-[11px] leading-none text-muted-foreground"
    >
      {CONFIDENCE_GLYPH[band]}
    </span>
  );
}
