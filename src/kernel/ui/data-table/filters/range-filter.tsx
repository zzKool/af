"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/kernel/i18n/use-t";
import type { Filter } from "@/kernel/list-query/types";

export interface RangeFilterProps {
  current: Filter | null;
  onApply: (filter: Filter | null) => void;
  onClose: () => void;
}

const DECIMAL = /^-?\d+([.,]\d+)?$/;
const norm = (s: string) => s.trim().replace(",", ".").replace(/\s/g, "");

export function RangeFilter({ current, onApply, onClose }: RangeFilterProps) {
  const t = useT();
  const initial = current?.kind === "range" ? current : null;
  const [min, setMin] = useState(initial?.min ?? "");
  const [max, setMax] = useState(initial?.max ?? "");
  const invalid = (s: string) => s.trim() !== "" && !DECIMAL.test(norm(s));

  function apply() {
    const lo = norm(min);
    const hi = norm(max);
    if (!lo && !hi) onApply(null);
    else onApply({ kind: "range", ...(lo ? { min: lo } : {}), ...(hi ? { max: hi } : {}) });
    onClose();
  }

  const preset = (f: Filter | null) => {
    onApply(f);
    onClose();
  };

  return (
    <form
      className="flex w-64 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid(min) || invalid(max)) return;
        apply();
      }}
    >
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          inputMode="decimal"
          placeholder={t("table.filter.min")}
          aria-label={t("table.filter.min")}
          value={min}
          onChange={(e) => setMin(e.target.value)}
          aria-invalid={invalid(min)}
          className="h-8 text-right tabular-nums"
        />
        <span className="text-xs text-muted-foreground">{t("table.filter.to")}</span>
        <Input
          inputMode="decimal"
          placeholder={t("table.filter.max")}
          aria-label={t("table.filter.max")}
          value={max}
          onChange={(e) => setMax(e.target.value)}
          aria-invalid={invalid(max)}
          className="h-8 text-right tabular-nums"
        />
      </div>
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => preset({ kind: "range", min: "0.01" })}
        >
          &gt; 0
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => preset({ kind: "range", max: "-0.01" })}
        >
          &lt; 0
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => preset({ kind: "range", min: "0", max: "0" })}
        >
          = 0
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => preset({ kind: "range", empty: true })}
        >
          {t("table.filter.empty")}
        </Button>
      </div>
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => preset(null)}
          disabled={!current}
        >
          {t("table.filter.clear")}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm" disabled={invalid(min) || invalid(max)}>
            {t("table.filter.ok")}
          </Button>
        </div>
      </div>
    </form>
  );
}
