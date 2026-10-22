"use client";

import { createContext, useCallback, useContext, useState } from "react";

type LocaleContextValue = {
  /** The user's preference; null = "browser default" (what My Preferences shows and saves). */
  locale: string | null;
  /** What the UI renders in: the preference, else the browser's locale as the server saw it (Accept-Language). */
  effectiveLocale: string | null;
  setLocale: (locale: string | null) => void;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: null,
  effectiveLocale: null,
  setLocale: () => {},
});

/**
 * Provides user locale preference to the component tree.
 * Server component fetches locale → passes as prop → client components use useLocale().
 * `browserLocale` comes from the request (kernel/i18n/request-locale), so the server render and the
 * client render agree when there is no preference. Locale changes update context immediately (no reload).
 */
export function LocaleProvider({
  initialLocale,
  browserLocale = null,
  children,
}: {
  initialLocale: string | null;
  browserLocale?: string | null;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<string | null>(initialLocale);

  const setLocale = useCallback((newLocale: string | null) => {
    setLocaleState(newLocale);
  }, []);

  return (
    <LocaleContext.Provider value={{ locale, effectiveLocale: locale ?? browserLocale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

/**
 * The user's locale: `locale` is the preference (null = browser default), `effectiveLocale` what to render in.
 */
export function useLocale() {
  return useContext(LocaleContext);
}
