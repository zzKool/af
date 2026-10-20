"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Filter, TextOp } from "@/kernel/list-query/types";

export const TEXT_OP_LABELS: Record<TextOp, string> = {
  contains: "Contains",
  startsWith: "Starts with",
  equals: "Equals",
  empty: "Is empty",
  notEmpty: "Is not empty",
};

export interface TextFilterProps {
  current: Filter | null;
  onApply: (filter: Filter | null) => void;
  onClose: () => void;
}

export function TextFilter({ current, onApply, onClose }: TextFilterProps) {
  const initial = current?.kind === "text" ? current : null;
  const [op, setOp] = useState<TextOp>(initial?.op ?? "contains");
  const [value, setValue] = useState(initial?.value ?? "");
  const needsValue = op !== "empty" && op !== "notEmpty";

  function apply() {
    if (needsValue && !value.trim()) onApply(null);
    else onApply(needsValue ? { kind: "text", op, value: value.trim() } : { kind: "text", op });
    onClose();
  }

  return (
    <form
      className="flex w-64 flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <Select value={op} onValueChange={(v) => setOp(v as TextOp)}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(TEXT_OP_LABELS) as TextOp[]).map((k) => (
            <SelectItem key={k} value={k}>
              {TEXT_OP_LABELS[k]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue && (
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Text…"
          className="h-8"
        />
      )}
      <div className="flex justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            onApply(null);
            onClose();
          }}
          disabled={!current}
        >
          Clear
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            OK
          </Button>
        </div>
      </div>
    </form>
  );
}
