"use client";

// The breadcrumb (D40, page anatomy 1): at the top of the canvas, the current page's named ancestors as links,
// `›` between them; names never ids, the current page not repeated (its title says it). Nothing on a top page.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment } from "react";
import { useT } from "@/kernel/i18n/use-t";
import { crumbsFor } from "@/kernel/ui/shell/routes";

export function Breadcrumb() {
  const t = useT();
  const crumbs = crumbsFor(usePathname());
  if (crumbs.length === 0) return null;
  return (
    // the aria-label stays English, like "Main navigation" (landmark names the e2e relies on)
    <nav aria-label="Breadcrumb" className="px-5 pt-3 text-[13px]">
      <ol className="flex flex-wrap items-center gap-1">
        {crumbs.map((c) => (
          <Fragment key={c.href}>
            <li>
              <Link href={c.href} className="text-primary hover:text-primary-hover hover:underline">
                {t(c.key)}
              </Link>
            </li>
            <li aria-hidden className="text-muted-foreground">
              ›
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}
