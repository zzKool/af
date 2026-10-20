"use client";

import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate, resolveLocale } from "@/kernel/i18n/format-date";
import { useLocale } from "@/kernel/i18n/locale-provider";
import { formatNumber } from "@/kernel/money/format-number";
import type { SupportedLocale } from "@/kernel/nav/constants";
import { SUPPORTED_LOCALES } from "@/kernel/nav/constants";
import { updateUserLocaleAction } from "@/modules/settings/user-preferences.actions";

type Props = {
  initialLocale: string | null;
};

const LOCALE_DISPLAY_NAMES: Record<string, string> = {
  "sv-SE": "Svenska (sv-SE)",
  "en-US": "English US (en-US)",
  "en-GB": "English UK (en-GB)",
  "fr-FR": "Fran\u00e7ais (fr-FR)",
  "de-CH": "Deutsch CH (de-CH)",
};

const BROWSER_DEFAULT_VALUE = "__browser__";

export function MyPreferencesTab({ initialLocale }: Props) {
  const { locale, setLocale } = useLocale();
  const { executeAsync: execUpdate } = useAction(updateUserLocaleAction);

  const currentLocale = locale ?? initialLocale;
  const selectValue = currentLocale ?? BROWSER_DEFAULT_VALUE;

  const handleChange = useCallback(
    async (value: string | null) => {
      if (value == null) return;
      const newLocale = value === BROWSER_DEFAULT_VALUE ? null : value;

      // Update context immediately (no page reload)
      setLocale(newLocale);

      const localeValue =
        newLocale !== null && SUPPORTED_LOCALES.includes(newLocale as SupportedLocale)
          ? (newLocale as SupportedLocale)
          : null;
      const result = await execUpdate({ locale: localeValue });
      if (result) {
        if (result.serverError) {
          const se = result.serverError as { message?: string };
          toast.error(se.message || "Server error");
          setLocale(currentLocale);
          return;
        }
        if (result.data?.error) {
          toast.error(result.data.error.message || "Failed to update locale");
          setLocale(currentLocale);
        }
        // Success is silent
      }
    },
    [execUpdate, setLocale, currentLocale],
  );

  // Live preview data
  const previewLocale = resolveLocale(currentLocale);
  const previewDate = useMemo(() => formatDate(new Date(), previewLocale), [previewLocale]);
  const previewNumber = useMemo(
    () => formatNumber(12500, previewLocale, { minimumFractionDigits: 2 }),
    [previewLocale],
  );

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <label htmlFor="locale-select" className="text-sm font-medium">
          Display Locale
        </label>
        <p className="text-xs text-muted-foreground">
          Controls how dates and numbers are formatted across the application.
        </p>
        <Select value={selectValue} onValueChange={handleChange}>
          <SelectTrigger id="locale-select" className="w-64">
            <SelectValue placeholder="Select locale" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BROWSER_DEFAULT_VALUE}>Browser Default</SelectItem>
            {SUPPORTED_LOCALES.map((loc) => (
              <SelectItem key={loc} value={loc}>
                {LOCALE_DISPLAY_NAMES[loc] ?? loc}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Live preview */}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
        <h3 className="text-sm font-medium">Preview ({previewLocale})</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground uppercase">Date</span>
            <p className="font-mono">{previewDate}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase">Number</span>
            <p className="font-mono">{previewNumber}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
