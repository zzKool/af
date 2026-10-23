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
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import type { Filter, TextOp } from "@/kernel/list-query/types";

export const TEXT_OP_KEYS: Record<TextOp, MessageKey> = {
  contains: "table.filter.op.contains",
  startsWith: "table.filter.op.startsWith",
  equals: "table.filter.op.equals",
  empty: "table.filter.op.empty",
  notEmpty: "table.filter.op.notEmpty",
};

export interface TextFilterProps {
  current: Filter | null;
  onApply: (filter: Filter | null) => void;
  onClose: () => void;
}

export function TextFilter({ current, onApply, onClose }: TextFilterProps) {
  const t = useT();
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
      <Select
        value={op}
        onValueChange={(v) => setOp(v as TextOp)}
        items={Object.fromEntries(
          (Object.keys(TEXT_OP_KEYS) as TextOp[]).map((k) => [k, t(TEXT_OP_KEYS[k])]),
        )}
      >
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(TEXT_OP_KEYS) as TextOp[]).map((k) => (
            <SelectItem key={k} value={k}>
              {t(TEXT_OP_KEYS[k])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {needsValue && (
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t("table.filter.text")}
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
          {t("table.filter.clear")}
        </Button>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" size="sm">
            {t("table.filter.ok")}
          </Button>
        </div>
      </div>
    </form>
  );
}
