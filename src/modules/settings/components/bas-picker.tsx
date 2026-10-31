"use client";

// The BAS picker (F125, audit C3, F95): one searchable field for every BAS account in the app. The trigger shows the
// account in the UI language; the popup has a search on number, English, Swedish and short code, then the suggested
// accounts (each saying where the suggestion comes from), the owner's favourites, and the chart by class — the cost
// classes first where a cost is picked. English only on screen (D72) — the Swedish name stays searchable and is the
// item's tooltip; the owner's *Use for* note (F126) is the second line. An account without a short code cannot key an expense or a supplier invoice (`requireAlias`):
// shown, disabled, with the reason.
import { useMemo, useState } from "react";
import {
  Combobox,
  ComboboxCollection,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearch,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { useT } from "@/kernel/i18n/use-t";
import { cn } from "@/lib/utils";
import type { BasOption, BasSuggestion } from "../types";
import {
  aliasOf,
  type BasDirection,
  type BasGroup,
  type BasPickItem,
  groupBasOptions,
  nameOf,
} from "./bas-picker-model";

export { mergeBasUsage, partnerBasSuggestions } from "../bas-history";
export {
  aliasOf,
  type BasDirection,
  type BasGroup,
  classGroupOf,
  foldText,
  groupBasOptions,
  matchesBas,
  nameOf,
} from "./bas-picker-model";

const NONE_CODE = "";

type ListGroup = { value: string; label: string; items: BasPickItem[] };

export function BasPicker({
  id,
  options,
  value,
  onChange,
  suggestions,
  direction = "any",
  requireAlias = false,
  allowNone = false,
  noneLabel,
  fallbackLabel,
  placeholder,
  disabled,
  className,
  proposed = false,
  "data-testid": testId,
}: {
  id?: string;
  options: readonly BasOption[];
  /** the selected code; "" = none */
  value: string;
  onChange: (code: string) => void;
  /** accounts to put on top, each with its source */
  suggestions?: readonly BasSuggestion[];
  direction?: BasDirection;
  /** the field keys an entity: an account without a short code is shown disabled */
  requireAlias?: boolean;
  /** a "none" choice on top (clears the field) */
  allowNone?: boolean;
  noneLabel?: string;
  /** the label of a selected code no longer in the active set */
  fallbackLabel?: string | null;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** the value is a proposal, not saved yet — drawn dashed */
  proposed?: boolean;
  "data-testid"?: string;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const groupLabel = (g: BasGroup) =>
    g.kind === "class" ? t(`settings.basPicker.class.${g.key}`) : t(`settings.basPicker.${g.kind}`);

  const selected: BasOption | null = useMemo(() => {
    if (!value) return null;
    return (
      options.find((o) => o.code === value) ?? {
        code: value,
        label: fallbackLabel ?? value,
        name: fallbackLabel?.replace(/^\d+\s·\s/, "") ?? value,
      }
    );
  }, [value, options, fallbackLabel]);

  // a hundred accounts at most: recomputed per render, no memo to keep in sync
  const groups: ListGroup[] = (() => {
    const list: ListGroup[] = groupBasOptions(options, { query, suggestions, direction }).map(
      (g) => ({
        value: g.key as string,
        label: groupLabel(g),
        items: g.items,
      }),
    );
    if (allowNone && !query.trim()) {
      const none: BasPickItem = {
        code: NONE_CODE,
        label: noneLabel ?? "—",
        name: noneLabel ?? "—",
      };
      list.unshift({ value: "none", label: "", items: [none] });
    }
    return list;
  })();

  const sourceText = (s: BasSuggestion) => s.reason ?? t(`settings.basPicker.source.${s.source}`);

  return (
    <Combobox<BasOption>
      items={groups}
      filter={null}
      value={selected}
      onValueChange={(v) => {
        onChange(v?.code ?? NONE_CODE);
        setQuery("");
      }}
      inputValue={query}
      onInputValueChange={(q) => setQuery(q)}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      itemToStringLabel={(o) => o.label}
      itemToStringValue={(o) => o.code}
      isItemEqualToValue={(a, b) => a.code === b.code}
      autoHighlight
      disabled={disabled}
    >
      <ComboboxTrigger
        id={id}
        className={cn(proposed && "border-dashed border-primary", className)}
        data-testid={testId}
        data-prefilled={proposed ? "true" : undefined}
      >
        <ComboboxValue>
          {(v: BasOption | null) =>
            v?.code ? (
              <span className="flex min-w-0 items-baseline gap-1.5">
                <span className="tabular-nums">{v.code}</span>
                <span className="truncate">{nameOf(v)}</span>
                {aliasOf(v) && <span className="text-xs text-muted-foreground">{aliasOf(v)}</span>}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder ?? noneLabel ?? "—"}</span>
            )
          }
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxPopup>
        <ComboboxSearch placeholder={t("settings.basPicker.search")} />
        <ComboboxEmpty>{t("settings.basPicker.empty")}</ComboboxEmpty>
        <ComboboxList>
          {(group: ListGroup) => (
            <ComboboxGroup key={group.value} items={group.items}>
              {group.label && (
                <ComboboxGroupLabel
                  className={group.value === "suggested" ? "text-primary" : undefined}
                >
                  {group.label}
                </ComboboxGroupLabel>
              )}
              <ComboboxCollection>
                {(item: BasPickItem) => {
                  const alias = aliasOf(item);
                  const blocked = requireAlias && !!item.code && !alias;
                  return (
                    <ComboboxItem
                      key={item.code || "none"}
                      value={item}
                      disabled={blocked}
                      aria-label={item.label}
                      title={item.nameSv ?? undefined}
                      data-testid={`bas-option-${item.code || "none"}`}
                    >
                      {item.code ? (
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="flex min-w-0 items-baseline gap-2">
                            <span className="w-9 shrink-0 tabular-nums text-muted-foreground">
                              {item.code}
                            </span>
                            <span className="min-w-0 flex-1 truncate">
                              {item.name ?? item.label}
                            </span>
                            {alias && (
                              <span className="shrink-0 rounded bg-muted px-1 text-[11px] text-muted-foreground">
                                {alias}
                              </span>
                            )}
                          </span>
                          {(item.suggestion || blocked || item.useFor) && (
                            <span className="ml-11 flex min-w-0 flex-wrap gap-x-2 text-[11px] text-muted-foreground">
                              {item.suggestion && (
                                <span className="text-primary">{sourceText(item.suggestion)}</span>
                              )}
                              {item.useFor && !item.suggestion && (
                                <span className="truncate">{item.useFor}</span>
                              )}
                              {blocked && <span>{t("settings.basPicker.needsAlias")}</span>}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{item.label}</span>
                      )}
                    </ComboboxItem>
                  );
                }}
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
