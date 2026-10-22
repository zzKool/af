"use client";

// The shell's one piece of state: the sidebar collapsed (56 px, icons) or open (190 px) — toggled from the
// top bar, remembered in this browser.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "sidebar-collapsed";

type ShellState = { collapsed: boolean; toggle: () => void };
const ShellContext = createContext<ShellState>({ collapsed: false, toggle: () => {} });

export function ShellProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === "true") setCollapsed(true);
    } catch {
      // storage blocked: start open
    }
  }, []);
  const toggle = useCallback(() => {
    setCollapsed((c) => {
      try {
        localStorage.setItem(STORAGE_KEY, String(!c));
      } catch {
        // storage blocked: the state still toggles
      }
      return !c;
    });
  }, []);
  return <ShellContext.Provider value={{ collapsed, toggle }}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  return useContext(ShellContext);
}
