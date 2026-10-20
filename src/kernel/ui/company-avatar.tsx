"use client";

import { cn } from "@/lib/utils";

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function CompanyAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent",
        className,
      )}
      aria-hidden="true"
    >
      {getInitials(name) || "?"}
    </div>
  );
}
