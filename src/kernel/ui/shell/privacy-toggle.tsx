"use client";

// The eye beside the sun / moon (F150): veil the figures for a screenshot, or show them. The icon follows the
// attribute on <html> (set by the root layout from the cookie), so the first HTML is right before React runs.
import { Eye, EyeOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { applyPrivacy } from "@/kernel/ui/theme";

export function PrivacyToggle() {
  const t = useT();
  const [on, setOn] = useState(false);
  useEffect(() => setOn(document.documentElement.dataset.privacy === "on"), []);
  const label = on ? t("shell.privacy.show") : t("shell.privacy.hide");
  return (
    <button
      type="button"
      onClick={() => {
        // the attribute is the truth (a click can come before the effect has read it)
        const next = document.documentElement.dataset.privacy !== "on";
        applyPrivacy(next);
        setOn(next);
      }}
      className="flex size-9 items-center justify-center rounded-xl border border-subtle bg-surface text-foreground shadow-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-selection"
      aria-label={label}
      aria-pressed={on}
      title={label}
      data-testid="privacy-toggle"
    >
      {on ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
    </button>
  );
}
