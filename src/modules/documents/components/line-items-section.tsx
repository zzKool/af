"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/kernel/i18n/use-t";
import type { OcrLineItem } from "@/modules/documents/documents.actions";

type LineItemsSectionProps = {
  items: OcrLineItem[];
  invoiceTotal?: number;
  readOnly: boolean;
  onItemsChange: (items: OcrLineItem[]) => void;
};

export function LineItemsSection({
  items: initialItems,
  invoiceTotal,
  readOnly,
  onItemsChange,
}: LineItemsSectionProps) {
  const t = useT();
  const [items, setItems] = useState<OcrLineItem[]>(initialItems);
  const [, setDeletedItem] = useState<{ item: OcrLineItem; index: number } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const sectionRef = useRef<HTMLFieldSetElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const lineItemsTotal = items.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const headerTotal = invoiceTotal ?? 0;
  const mismatch = Math.abs(lineItemsTotal - headerTotal) > 0.01 && headerTotal > 0;

  const updateItem = useCallback((index: number, field: keyof OcrLineItem, value: string) => {
    setItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };

      if (field === "description") {
        item.description = value;
      } else {
        const num = value === "" ? undefined : Number(value);
        (item as Record<string, unknown>)[field] = num;

        // Auto-calculate amount if quantity and unitPrice are set
        if (
          (field === "quantity" || field === "unitPrice") &&
          item.quantity != null &&
          item.unitPrice != null
        ) {
          item.amount = item.quantity * item.unitPrice;
        }
      }

      updated[index] = item;
      return updated;
    });
  }, []);

  const addItem = useCallback(() => {
    setItems((prev) => [...prev, { description: "", quantity: 1, unitPrice: 0, amount: 0 }]);
  }, []);

  const deleteItem = useCallback(
    (index: number) => {
      const removed = items[index];
      setItems((prev) => prev.filter((_, i) => i !== index));
      setDeletedItem({ item: removed, index });

      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      undoTimerRef.current = setTimeout(() => setDeletedItem(null), 3000);

      toast(t("documents.lines.deleted"), {
        action: {
          label: t("documents.lines.undo"),
          onClick: () => {
            setItems((prev) => {
              const restored = [...prev];
              restored.splice(index, 0, removed);
              return restored;
            });
            setDeletedItem(null);
          },
        },
        duration: 3000,
      });
    },
    [items, t],
  );

  // Save full array when user leaves the section
  // Uses ref + setTimeout to avoid stale closure: input onBlur fires setItems
  // in the same tick as fieldset onBlur, so we defer to let React flush first
  const handleSectionBlur = useCallback(
    (e: React.FocusEvent) => {
      if (sectionRef.current?.contains(e.relatedTarget as Node)) return;
      setTimeout(() => {
        onItemsChange(itemsRef.current);
      }, 0);
    },
    [onItemsChange],
  );

  return (
    <fieldset ref={sectionRef} className="space-y-3 border-0 p-0 m-0" onBlur={handleSectionBlur}>
      <legend className="sr-only">{t("documents.lines.legend")}</legend>
      <h2 className="text-sm font-medium">{t("documents.lines.title")}</h2>

      {mismatch && (
        <div
          className="rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800 dark:border-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300"
          role="alert"
        >
          {t("documents.lines.mismatch", {
            header: headerTotal.toFixed(2),
            lines: lineItemsTotal.toFixed(2),
          })}
        </div>
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-1 text-left font-medium">
                  {t("documents.lines.description")}
                </th>
                <th className="px-2 py-1 text-right font-medium w-20">
                  {t("documents.lines.qty")}
                </th>
                <th className="px-2 py-1 text-right font-medium w-24">
                  {t("documents.lines.unitPrice")}
                </th>
                <th className="px-2 py-1 text-right font-medium w-24">
                  {t("documents.lines.amount")}
                </th>
                <th className="px-2 py-1 text-right font-medium w-20">
                  {t("documents.lines.tax")}
                </th>
                {!readOnly && (
                  <th className="w-10">
                    <span className="sr-only">{t("documents.lines.remove")}</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr
                  // biome-ignore lint/suspicious/noArrayIndexKey: line items have no stable ID
                  key={index}
                  className="border-b last:border-b-0"
                >
                  <td className="px-2 py-1">
                    <Input
                      id={`line-item-${index}-description`}
                      aria-label={t("documents.lines.aria.description", { n: index + 1 })}
                      className="h-8 text-sm"
                      defaultValue={item.description ?? ""}
                      disabled={readOnly}
                      onBlur={(e) => updateItem(index, "description", e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      id={`line-item-${index}-quantity`}
                      aria-label={t("documents.lines.aria.quantity", { n: index + 1 })}
                      className="h-8 text-sm text-right"
                      type="number"
                      step="1"
                      defaultValue={item.quantity != null ? String(item.quantity) : ""}
                      disabled={readOnly}
                      onBlur={(e) => updateItem(index, "quantity", e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      id={`line-item-${index}-unitPrice`}
                      aria-label={t("documents.lines.aria.unitPrice", { n: index + 1 })}
                      className="h-8 text-sm text-right"
                      type="number"
                      step="0.01"
                      defaultValue={item.unitPrice != null ? String(item.unitPrice) : ""}
                      disabled={readOnly}
                      onBlur={(e) => updateItem(index, "unitPrice", e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      id={`line-item-${index}-amount`}
                      aria-label={t("documents.lines.aria.amount", { n: index + 1 })}
                      className="h-8 text-sm text-right"
                      type="number"
                      step="0.01"
                      value={item.amount != null ? String(item.amount) : ""}
                      disabled={readOnly}
                      onChange={(e) => updateItem(index, "amount", e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1">
                    <Input
                      id={`line-item-${index}-tax`}
                      aria-label={t("documents.lines.aria.tax", { n: index + 1 })}
                      className="h-8 text-sm text-right"
                      type="number"
                      step="0.01"
                      defaultValue={item.tax != null ? String(item.tax) : ""}
                      disabled={readOnly}
                      onBlur={(e) => updateItem(index, "tax", e.target.value)}
                    />
                  </td>
                  {!readOnly && (
                    <td className="px-2 py-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive"
                        onClick={() => deleteItem(index)}
                        aria-label={t("documents.lines.aria.remove", { n: index + 1 })}
                      >
                        &times;
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!readOnly && (
        <Button variant="outline" size="sm" onClick={addItem}>
          {t("documents.lines.add")}
        </Button>
      )}
    </fieldset>
  );
}
