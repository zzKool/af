"use client";

// The sun / moon in the top bar (D76): one click flips light ↔ dark and remembers it as the user's choice
// (D43, the same preference as My Preferences — where "follow the system" can be picked again). The icon is
// chosen by the `dark:` variant, so the first HTML is right before React runs. `save` is the settings
// module's action, handed in by the app layout (the kernel knows no module); a refused save puts the old
// theme back.
import { Moon, Sun } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/kernel/i18n/use-t";
import { applyTheme, parseTheme, type Theme } from "@/kernel/ui/theme";

export type SaveTheme = (input: {
  theme: Theme | null;
}) => Promise<
  { serverError?: unknown; validationErrors?: unknown; data?: { error?: unknown } } | undefined
>;

/** what the screen shows now: the forced theme, else the OS */
export function effectiveTheme(): Theme {
  const forced = parseTheme(document.documentElement.dataset.theme);
  if (forced) return forced;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle({ save }: { save?: SaveTheme }) {
  const t = useT();
  const flip = async () => {
    const previous = parseTheme(document.documentElement.dataset.theme);
    const next: Theme = effectiveTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
    if (!save) return;
    const result = await save({ theme: next });
    if (!result || result.serverError || result.validationErrors || result.data?.error) {
      applyTheme(previous);
      toast.error(t("settings.preferences.themeSaveFailed"));
    }
  };
  return (
    <button
      type="button"
      onClick={flip}
      className="flex size-9 items-center justify-center rounded-xl border border-subtle bg-surface text-foreground shadow-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t("shell.theme.toggle")}
      title={t("shell.theme.toggle")}
    >
      <Moon className="size-4 dark:hidden" aria-hidden />
      <Sun className="hidden size-4 dark:block" aria-hidden />
    </button>
  );
}
