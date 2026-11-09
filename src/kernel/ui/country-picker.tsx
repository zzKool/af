"use client";

// The country by name (the owner, 2026-11-09): a searchable list in the UI language — "Switzerland · CH" —
// that stores the ISO code. Search by name or code. The kit's Combobox, as the BAS picker.
import { useMemo } from "react";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearch,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { countryOptions } from "@/kernel/i18n/display-names";
import { useT, useUiLanguage } from "@/kernel/i18n/use-t";

type Country = { code: string; name: string };

export function CountryPicker({
  id,
  value,
  onChange,
  className,
  "data-testid": testId,
}: {
  id?: string;
  /** the ISO code, `""` for none */
  value: string;
  onChange: (code: string) => void;
  className?: string;
  "data-testid"?: string;
}) {
  const t = useT();
  const lang = useUiLanguage();
  const options = useMemo(() => countryOptions(lang), [lang]);
  const selected = options.find((o) => o.code === value.toUpperCase()) ?? null;
  return (
    <Combobox<Country>
      items={options}
      value={selected}
      onValueChange={(v) => onChange(v?.code ?? "")}
      itemToStringLabel={(o) => `${o.name} ${o.code}`}
      itemToStringValue={(o) => o.code}
      isItemEqualToValue={(a, b) => a.code === b.code}
      autoHighlight
    >
      <ComboboxTrigger id={id} className={className} data-testid={testId}>
        <ComboboxValue>
          {(v: Country | null) =>
            v ? (
              <span>
                {v.name} <span className="text-muted-foreground">· {v.code}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">{t("kit.country.none")}</span>
            )
          }
        </ComboboxValue>
      </ComboboxTrigger>
      <ComboboxPopup>
        <ComboboxSearch placeholder={t("kit.country.search")} />
        <ComboboxEmpty>{t("kit.country.empty")}</ComboboxEmpty>
        <ComboboxList>
          {(c: Country) => (
            <ComboboxItem key={c.code} value={c} data-testid={`country-${c.code}`}>
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.code}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
