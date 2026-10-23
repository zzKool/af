"use client";

import { useCallback } from "react";
import { useLocale } from "./locale-provider";
import { type MessageKey, type MessageParams, translate, uiLanguage } from "./translate";

/**
 * `const t = useT(); t("contracts.rates.title")` — strings in the user's UI language.
 * The locale comes from LocaleProvider: the user's preference, else the browser's (Accept-Language).
 */
export function useT() {
  const lang = useUiLanguage();
  return useCallback(
    (key: MessageKey, params?: MessageParams) => translate(lang, key, params),
    [lang],
  );
}

/** The UI language the strings render in (`en` · `fr` · `sv`) — for `Intl` formats that must agree with them. */
export function useUiLanguage(): string {
  const { effectiveLocale } = useLocale();
  const resolved =
    effectiveLocale ?? (typeof navigator !== "undefined" ? navigator.language : null) ?? null;
  return uiLanguage(resolved);
}
