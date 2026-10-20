"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Filter } from "@/kernel/list-query/types";

export interface RangeFilterProps {
  current: Filter | null;
  onApply: (filter: Filter | null) => void;
  onClose: () => void;
}

const DECIMAL = /^-?\d+([.,]\d+)?$/;
const norm = (s: string) => s.trim().replace(",", ".").replace(/\s/g, "");

export function RangeFilter({ current, onApply, onClose }: RangeFilterProps) {
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
          placeholder="Min"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          aria-invalid={invalid(min)}
          className="h-8 text-right tabular-nums"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          inputMode="decimal"
          placeholder="Max"
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
          Empty
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
          Clear
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={invalid(min) || invalid(max)}>
            OK
          </Button>
        </div>
      </div>
    </form>
  );
}
