"use client";

import { useAction } from "next-safe-action/hooks";
import { useCallback, useMemo, useState } from "react";
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
import { useT } from "@/kernel/i18n/use-t";
import { formatNumber } from "@/kernel/money/format-number";
import type { SupportedLocale } from "@/kernel/nav/constants";
import { SUPPORTED_LOCALES } from "@/kernel/nav/constants";
import { applyTheme, parseTheme, type Theme } from "@/kernel/ui/theme";
import {
  updateUserLocaleAction,
  updateUserThemeAction,
} from "@/modules/settings/user-preferences.actions";

type Props = {
  initialLocale: string | null;
  /** light / dark; null = follow the system (D43) */
  initialTheme: Theme | null;
};

const LOCALE_DISPLAY_NAMES: Record<string, string> = {
  "sv-SE": "Svenska (sv-SE)",
  "en-US": "English US (en-US)",
  "en-GB": "English UK (en-GB)",
  "fr-FR": "Fran\u00e7ais (fr-FR)",
  "de-CH": "Deutsch CH (de-CH)",
};

const BROWSER_DEFAULT_VALUE = "__browser__";
const SYSTEM_THEME_VALUE = "__system__";

export function MyPreferencesTab({ initialLocale, initialTheme }: Props) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const { executeAsync: execUpdate } = useAction(updateUserLocaleAction);
  const { executeAsync: execTheme } = useAction(updateUserThemeAction);
  const [theme, setTheme] = useState<Theme | null>(initialTheme);

  // the theme shows at once (and in the cookie the root layout reads); a refused save puts the old one back
  const handleTheme = useCallback(
    async (value: string | null) => {
      if (value == null) return;
      const next = value === SYSTEM_THEME_VALUE ? null : parseTheme(value);
      const previous = theme;
      setTheme(next);
      applyTheme(next);
      const result = await execTheme({ theme: next });
      const failed = !result || result.serverError || result.validationErrors || result.data?.error;
      if (failed) {
        setTheme(previous);
        applyTheme(previous);
        toast.error(t("settings.preferences.themeSaveFailed"));
        return;
      }
      toast.success(t("settings.preferences.saved"));
    },
    [execTheme, theme, t],
  );

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
          toast.error(se.message || t("settings.preferences.saveFailed"));
          setLocale(currentLocale);
          return;
        }
        if (result.data?.error) {
          toast.error(result.data.error.message || t("settings.preferences.saveFailed"));
          setLocale(currentLocale);
        }
        toast.success(t("settings.preferences.saved"));
      }
    },
    [execUpdate, setLocale, currentLocale, t],
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
          {t("settings.preferences.locale")}
        </label>
        <p className="text-xs text-muted-foreground">{t("settings.preferences.localeHint")}</p>
        <Select value={selectValue} onValueChange={handleChange}>
          <SelectTrigger id="locale-select" className="w-64">
            <SelectValue placeholder={t("settings.preferences.selectLocale")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BROWSER_DEFAULT_VALUE}>
              {t("settings.preferences.browserDefault")}
            </SelectItem>
            {SUPPORTED_LOCALES.map((loc) => (
              <SelectItem key={loc} value={loc}>
                {LOCALE_DISPLAY_NAMES[loc] ?? loc}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* F166, the board *Settings*: *How the app looks* — three cards, each a small picture of the app in that
          scheme (the ground, the rail, a card); the chosen one ringed */}
      <div className="space-y-2">
        <span id="theme-label" className="text-sm font-medium">
          {t("settings.preferences.theme")}
        </span>
        <p className="text-xs text-muted-foreground">{t("settings.preferences.themeHint")}</p>
        <fieldset
          aria-labelledby="theme-label"
          className="grid gap-3 sm:grid-cols-3"
          data-testid="theme-select"
        >
          {(
            [
              {
                value: SYSTEM_THEME_VALUE,
                label: "settings.preferences.themeSystem",
                sub: "settings.preferences.themeSystemSub",
                left: "#1f2733",
                right: "#0d1117",
                ground: "#eef1f5",
              },
              {
                value: "light",
                label: "settings.preferences.themeLight",
                sub: "settings.preferences.themeLightSub",
                left: "#1f2733",
                right: "#ffffff",
                ground: "#eef1f5",
              },
              {
                value: "dark",
                label: "settings.preferences.themeDark",
                sub: "settings.preferences.themeDarkSub",
                left: "#11161d",
                right: "#161b22",
                ground: "#0d1117",
              },
            ] as const
          ).map((o) => {
            const on = (theme ?? SYSTEM_THEME_VALUE) === o.value;
            return (
              <label
                key={o.value}
                data-testid={`theme-option-${o.value === SYSTEM_THEME_VALUE ? "system" : o.value}`}
                className={
                  on
                    ? "flex cursor-pointer flex-col gap-2 rounded-2xl border-2 border-primary bg-selection p-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                    : "flex cursor-pointer flex-col gap-2 rounded-2xl border border-subtle bg-surface p-3 hover:bg-hover has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                }
              >
                <input
                  type="radio"
                  name="theme"
                  value={o.value}
                  checked={on}
                  onChange={() => void handleTheme(o.value)}
                  className="sr-only"
                />
                {/* a picture of the scheme, not a colour of the UI: fixed swatches, like a screenshot */}
                <span
                  className="flex h-14 overflow-hidden rounded-lg"
                  style={{ background: o.ground }}
                  aria-hidden
                >
                  <span className="w-1/4" style={{ background: o.left }} />
                  <span className="m-2 flex-1 rounded-md" style={{ background: o.right }} />
                  {o.value === SYSTEM_THEME_VALUE && (
                    <span
                      className="m-2 ml-0 flex-1 rounded-md"
                      style={{ background: "#ffffff" }}
                    />
                  )}
                </span>
                <span className="text-[13px] font-semibold">{t(o.label)}</span>
                <span className="-mt-1.5 text-xs text-muted-foreground">{t(o.sub)}</span>
              </label>
            );
          })}
        </fieldset>
      </div>

      {/* Live preview */}
      <div className="space-y-2 rounded-2xl bg-surface-2 p-4">
        <h3 className="text-sm font-medium">
          {t("settings.preferences.preview", { locale: previewLocale })}
        </h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-xs text-muted-foreground uppercase">
              {t("settings.preferences.date")}
            </span>
            <p className="font-mono">{previewDate}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground uppercase">
              {t("settings.preferences.number")}
            </span>
            <p className="font-mono">{previewNumber}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
