"use client";

import { createContext, useCallback, useContext, useState } from "react";

type LocaleContextValue = {
  locale: string | null;
  setLocale: (locale: string | null) => void;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: null,
  setLocale: () => {},
});

/**
 * Provides user locale preference to the component tree.
 * Server component fetches locale → passes as prop → client components use useLocale().
 * Locale changes update context immediately (no page reload).
 */
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: string | null;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<string | null>(initialLocale);

  const setLocale = useCallback((newLocale: string | null) => {
    setLocaleState(newLocale);
  }, []);

  return <LocaleContext.Provider value={{ locale, setLocale }}>{children}</LocaleContext.Provider>;
}

/**
 * Hook to access the user's locale preference.
 * Returns null when user prefers browser locale.
 */
export function useLocale() {
  return useContext(LocaleContext);
}
