"use client";

// The stored theme (D43) wins over the cookie: on a new browser, or after the choice changed elsewhere, the page
// rendered with the cookie's (or no) theme — this puts the stored one on <html> and in the cookie, once.
import { useEffect } from "react";
import { applyTheme, type Theme } from "@/kernel/ui/theme";

export function ThemeSync({ theme }: { theme: Theme | null }) {
  useEffect(() => {
    if ((document.documentElement.dataset.theme ?? null) !== theme) applyTheme(theme);
  }, [theme]);
  return null;
}
