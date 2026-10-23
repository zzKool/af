"use client";

// The expense's partner (F87, FR-008): active vendors and *none*, used by the new-expense dialog and the panel.
// The vendors are loaded by `useVendors` — the dialog opens from four pages (expenses, the documents library, the
// inbox, the review page), so they are not threaded through every page's options. A partner the list does not
// hold (deactivated, or created a moment ago from the match card) is shown from `current`.
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useT } from "@/kernel/i18n/use-t";
import { expenseVendorsAction } from "@/modules/expenses/expenses.actions";
import type { VendorOption } from "@/modules/expenses/types";
import { NONE } from "./expense-panel-shared";

/** Loads the vendors once `enabled` turns true; `add` puts a vendor created on the spot at the top. */
export function useVendors(enabled: boolean): {
  vendors: VendorOption[];
  add: (v: VendorOption) => void;
} {
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { executeAsync } = useAction(expenseVendorsAction);
  useEffect(() => {
    if (!enabled || loaded) return;
    let live = true;
    void executeAsync({}).then((r) => {
      if (!live) return;
      const data = r?.data && "data" in r.data ? r.data.data : undefined;
      if (data) {
        setVendors(data);
        setLoaded(true);
      }
    });
    return () => {
      live = false;
    };
  }, [enabled, loaded, executeAsync]);
  const add = useCallback(
    (v: VendorOption) => setVendors((prev) => [v, ...prev.filter((p) => p.id !== v.id)]),
    [],
  );
  return { vendors, add };
}

export function PartnerPicker({
  id,
  value,
  onChange,
  vendors,
  current,
  disabled,
  testId = "expense-partner",
}: {
  id: string;
  value: string | null;
  onChange: (partnerId: string | null) => void;
  vendors: VendorOption[];
  /** the partner on the row when it is not among the active vendors (deactivated): kept, greyed */
  current?: { id: string; name: string; isActive: boolean } | null;
  disabled?: boolean;
  testId?: string;
}) {
  const t = useT();
  const extra = current && !vendors.some((v) => v.id === current.id) ? current : null;
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onChange(!v || v === NONE ? null : v)}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full" data-testid={testId}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{t("expenses.partnerNone")}</SelectItem>
        {extra && (
          <SelectItem value={extra.id}>
            <span className={extra.isActive ? undefined : "text-muted-foreground"}>
              {extra.isActive ? extra.name : t("expenses.partnerInactive", { name: extra.name })}
            </span>
          </SelectItem>
        )}
        {vendors.map((v) => (
          <SelectItem key={v.id} value={v.id}>
            {v.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
