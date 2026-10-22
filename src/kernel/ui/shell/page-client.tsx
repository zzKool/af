"use client";

// The client leaves of PageHeader: the section's icon tile and the "back" link (both read the path).
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SHELL_ICONS } from "@/kernel/ui/shell/icons";
import { crumbsFor, navItemFor } from "@/kernel/ui/shell/routes";

/** 28 px tile with the icon of the nav section the page belongs to (D40 title row). */
export function SectionIcon() {
  const item = navItemFor(usePathname());
  const Icon = item ? SHELL_ICONS[item.icon] : undefined;
  if (!Icon) return null;
  return (
    <span
      aria-hidden
      className="flex size-7 shrink-0 items-center justify-center rounded-md bg-tag text-muted-foreground"
    >
      <Icon className="size-4" />
    </span>
  );
}

/** A page's own back link, kept only where the breadcrumb has nothing to say (no named ancestor). */
export function BackLink({ children }: { children: ReactNode }) {
  if (crumbsFor(usePathname()).length > 0) return null;
  return (
    <div className="text-[13px] text-primary [&_a:hover]:text-primary-hover [&_a:hover]:underline">
      {children}
    </div>
  );
}
