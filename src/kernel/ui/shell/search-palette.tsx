"use client";

// The global search palette (F93, D56): Ctrl K / ⌘ K (and Ctrl P / ⌘ P, the old page search) opens it from
// anywhere. Pages are one group, filtered here; entities come from the `search` action the app layout passes in
// (the composition root — the kernel knows no module). ARIA combobox + grouped listbox, ↑ ↓ Enter Esc.
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { CallerIdentity } from "@/kernel/auth/caller-identity";
import type { MessageKey } from "@/kernel/i18n/translate";
import { useT } from "@/kernel/i18n/use-t";
import { formatMoney } from "@/kernel/money/format-money";
import { hasExactKey, parseSearchQuery } from "@/kernel/search/query";
import type { RunSearch, SearchGroup, SearchHit } from "@/kernel/search/types";
import { GROUP_SIZE } from "@/kernel/search/types";
import { SHELL_ICONS } from "@/kernel/ui/shell/icons";
import { type Destination, destinationsFor, matches } from "@/kernel/ui/shell/routes";
import { CodeChip } from "@/kernel/ui/tags";
import { cn } from "@/lib/utils";

/** Wait this long after the last keystroke before asking the server. */
export const SEARCH_DEBOUNCE_MS = 150;
/** Top-level pages shown on an empty query. */
const EMPTY_QUERY_PAGES = 8;

type Item =
  | { type: "page"; href: string; page: Destination }
  | { type: "hit"; href: string; hit: SearchHit }
  | { type: "more"; href: string; kind: SearchGroup["kind"] };

type Section = { id: string; title: MessageKey; items: Item[] };

/** True for the palette's shortcuts: Ctrl / ⌘ + K or P, no Alt. */
export function isPaletteShortcut(
  e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "key">,
) {
  const key = e.key.toLowerCase();
  return (e.ctrlKey || e.metaKey) && !e.altKey && (key === "k" || key === "p");
}

/** Pages first unless an entity group holds an exact key (`VA23-INV-001` typed in full). */
export function sectionsFor(pages: Destination[], groups: SearchGroup[]): Section[] {
  const pageSection: Section = {
    id: "pages",
    title: "shell.search.group.pages",
    items: pages.map((page) => ({ type: "page", href: page.href, page })),
  };
  const entity = (g: SearchGroup): Section => ({
    id: g.kind,
    title: `shell.search.group.${g.kind}` as MessageKey,
    items: [
      ...g.hits.map((hit): Item => ({ type: "hit", href: hit.href, hit })),
      ...(g.more ? [{ type: "more" as const, href: g.seeAllHref, kind: g.kind }] : []),
    ],
  });
  const exact = groups.filter(hasExactKey).map(entity);
  const rest = groups.filter((g) => !hasExactKey(g)).map(entity);
  return [...exact, pageSection, ...rest].filter((s) => s.items.length > 0);
}

export function SearchPalette({
  role,
  search,
}: {
  role: CallerIdentity["role"];
  /** the app's `globalSearchAction`; absent = pages only */
  search?: RunSearch;
}) {
  const t = useT();
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const sequence = useRef(0);

  // the shortcuts, from anywhere (and never the browser's print dialog)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!isPaletteShortcut(e)) return;
      e.preventDefault();
      setOpen(true);
      input.current?.select();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // entities: debounced, and an older answer never overwrites a newer one
  useEffect(() => {
    const id = ++sequence.current;
    const q = parseSearchQuery(query);
    if (!q || !search) {
      setGroups([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      const result = await search({ q: q.text }).catch(() => undefined);
      if (id !== sequence.current) return;
      setGroups(result?.data?.data ?? []);
      setLoading(false);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, search]);

  const all = useMemo(() => destinationsFor(role), [role]);
  const pages = useMemo(
    () =>
      query.trim()
        ? all
            .filter((d) => matches(query, t(d.key), d.parent ? t(d.parent) : ""))
            .slice(0, GROUP_SIZE)
        : all.filter((d) => !d.parent).slice(0, EMPTY_QUERY_PAGES),
    [all, query, t],
  );
  const sections = useMemo(() => sectionsFor(pages, groups), [pages, groups]);
  const items = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setGroups([]);
    setActive(0);
  }, []);

  const go = useCallback(
    (href: string) => {
      close();
      router.push(href);
    },
    [close, router],
  );

  const optionId = (i: number) => `${listId}-${i}`;
  let index = -1; // running index of the flat list while rendering the sections

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        className="relative flex h-8 w-full max-w-[520px] items-center gap-2 rounded-md border bg-surface pr-14 pl-2.5 text-left text-[13px] text-muted-foreground outline-none hover:border-primary/60 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <Search className="size-4 shrink-0" aria-hidden />
        <span className="truncate">{t("shell.search.placeholder")}</span>
        <kbd
          aria-hidden
          className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 rounded border bg-app px-1 font-sans text-[11px]"
        >
          Ctrl K
        </kbd>
      </button>

      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
        <DialogContent
          size="lg"
          showCloseButton={false}
          initialFocus={input}
          className="top-[12vh] translate-y-0 gap-0 overflow-hidden p-0 data-open:zoom-in-100 data-closed:zoom-out-100"
        >
          <DialogTitle className="sr-only">{t("shell.search.label")}</DialogTitle>
          <div className="flex items-center gap-2 border-b px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <input
              ref={input}
              type="text"
              role="combobox"
              aria-label={t("shell.search.label")}
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={items.length > 0 ? optionId(current) : undefined}
              placeholder={t("shell.search.placeholder")}
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive(Math.min(current + 1, items.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive(Math.max(current - 1, 0));
                } else if (e.key === "Enter" && items[current]) {
                  e.preventDefault();
                  go(items[current].href);
                }
                // Esc: the dialog closes itself (onOpenChange)
              }}
              className="h-11 w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
            />
            {loading && (
              <span className="shrink-0 text-xs text-muted-foreground" role="status">
                {t("shell.search.loading")}
              </span>
            )}
          </div>

          <div
            id={listId}
            role="listbox"
            aria-label={t("shell.search.label")}
            className="max-h-[60vh] overflow-y-auto py-1"
          >
            {items.length === 0 && !loading && (
              <div className="px-3 py-3 text-[13px] text-muted-foreground">
                {t("shell.search.empty")}
              </div>
            )}
            {sections.map((section) => {
              const headingId = `${listId}-${section.id}`;
              return (
                // biome-ignore lint/a11y/useSemanticElements: an ARIA listbox group, not a form fieldset
                <div key={section.id} role="group" aria-labelledby={headingId} className="py-1">
                  <div
                    id={headingId}
                    className="px-3 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase"
                  >
                    {t(section.title)}
                  </div>
                  {section.items.map((item) => {
                    index += 1;
                    const i = index;
                    return (
                      <div
                        key={`${item.type}:${item.href}`}
                        id={optionId(i)}
                        role="option"
                        tabIndex={-1}
                        aria-selected={i === current}
                        onMouseMove={() => i !== current && setActive(i)}
                        // mousedown: act before the input loses focus
                        onMouseDown={(e) => {
                          e.preventDefault();
                          go(item.href);
                        }}
                        className={cn(
                          "flex h-8 cursor-pointer items-center gap-2 px-3 text-[13px]",
                          i === current && "bg-selection",
                        )}
                      >
                        <ItemRow item={item} />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          <div className="border-t px-3 py-1.5 text-[11px] text-muted-foreground" aria-hidden>
            {t("shell.search.hint")}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ItemRow({ item }: { item: Item }) {
  const t = useT();
  if (item.type === "page") {
    const Icon = SHELL_ICONS[item.page.icon];
    return (
      <>
        {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden />}
        {item.page.parent && <span className="text-muted-foreground">{t(item.page.parent)} ›</span>}
        <span>{t(item.page.key)}</span>
      </>
    );
  }
  if (item.type === "more") {
    return <span className="text-primary">{t("shell.search.seeAll")} →</span>;
  }
  const { hit } = item;
  return (
    <>
      {hit.key && <CodeChip>{hit.key}</CodeChip>}
      <span className="min-w-0 flex-1 truncate">{hit.label}</span>
      {hit.date && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{hit.date}</span>
      )}
      {hit.amount && (
        <span className="w-32 shrink-0 text-right tabular-nums">
          {formatMoney(hit.amount, hit.currency, { signed: hit.kind === "bank_transaction" })}
        </span>
      )}
    </>
  );
}
