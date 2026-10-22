// Page archetypes (D19, D40 — ui-conventions *Page anatomy*): full width, dense, three shapes and nothing else.
//   <ListPage title actions>     DataTable pages — content stretches, no max-w
//   <EntityPage title meta tabs> title row + underline tabs (overview, documents, links, audit)
//   <WorkPage left right>        split panes — list left, detail right
// The breadcrumb sits above, in the shell (breadcrumb.tsx). Canvas padding 20 px sideways, 14 px on top.
// Server-component friendly (no hooks here; the icon tile and the back link are small client leaves).
import type { ReactNode } from "react";
import { BackLink, SectionIcon } from "@/kernel/ui/shell/page-client";
import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Omit when the content carries its own header (an entity's tabs component, say). */
  title?: ReactNode;
  /** One line under the title: counts, status, period. */
  meta?: ReactNode;
  /** Metadata tags next to the title (bank, currency, type) — grey `<Tag>`s, never a state. */
  tags?: ReactNode;
  /** Secondary buttons then **one** primary (a `<SplitButton>` when it has variants), right-aligned. */
  actions?: ReactNode;
  /**
   * A parent link. Shown only where the breadcrumb has nothing (e.g. the link graph's "back to …");
   * under a named parent the breadcrumb already says it.
   */
  back?: ReactNode;
  /** Underline tabs under the title row (`<Tabs>` from the kit). */
  tabs?: ReactNode;
  /** One `<InfoBanner>`: what to do next on this page — not errors. */
  banner?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  meta,
  tags,
  actions,
  back,
  tabs,
  banner,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-3", className)}>
      {back && <BackLink>{back}</BackLink>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SectionIcon />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold leading-7">{title}</h1>
            {tags && <div className="flex flex-wrap items-center gap-1">{tags}</div>}
          </div>
          {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs}
      {banner}
    </header>
  );
}

const PAGE = "flex min-h-full flex-col gap-4 px-5 pt-3.5 pb-5";

export function ListPage({
  children,
  className,
  ...header
}: PageHeaderProps & { children: ReactNode }) {
  return (
    <div className={cn(PAGE, className)}>
      <PageHeader {...header} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function EntityPage({
  children,
  className,
  ...header
}: PageHeaderProps & { children: ReactNode }) {
  return (
    <div className={cn(PAGE, className)}>
      {header.title !== undefined && <PageHeader {...header} />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export interface WorkPageProps extends PageHeaderProps {
  left: ReactNode;
  right: ReactNode;
  /** CSS width of the left pane (default 24rem). */
  leftWidth?: string;
}

export function WorkPage({
  left,
  right,
  leftWidth = "24rem",
  className,
  ...header
}: WorkPageProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col gap-4 px-5 pt-3.5 pb-5", className)}>
      <PageHeader {...header} />
      <div
        className="grid min-h-0 flex-1 gap-4"
        style={{ gridTemplateColumns: `${leftWidth} minmax(0, 1fr)` }}
      >
        <section className="min-h-0 overflow-auto rounded-lg border" aria-label="List">
          {left}
        </section>
        <section className="min-h-0 overflow-auto" aria-label="Detail">
          {right}
        </section>
      </div>
    </div>
  );
}
