"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, Loader2, Search, Star } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/kernel/i18n/use-t";
import { createTenantStore } from "@/kernel/stores/create-tenant-store";
import {
  activateBasCategoriesAction,
  deactivateBasCategoryAction,
  updateBasPreferenceAction,
} from "@/modules/settings/bas-preferences.actions";

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
type BasCategory = {
  code: string;
  name: string;
  nameEn: string | null;
  nameFr: string | null;
  className: string;
  classNum: number;
  isCommon: boolean;
  suggestedAlias: string | null;
};

type BasPreference = {
  id: string;
  basCode: string;
  isFavorite: boolean;
  shortCode: string | null;
  translations: Record<string, unknown> | null;
  basCategory: BasCategory;
};

type Props = {
  initialCategories: BasCategory[];
  initialPreferences: BasPreference[];
};

// ─────────────────────────────────────────────────────────────
// Zustand ephemeral search state
// ─────────────────────────────────────────────────────────────
const useBasSearch = createTenantStore({ search: "" });

/** Extract error message from a server action result */
function actionError(result: {
  serverError?: unknown;
  data?: { error?: { message?: string } };
}): string | null {
  if (result.serverError) {
    const se = result.serverError as { message?: string };
    return se.message || "Server error";
  }
  if (result.data?.error) return result.data.error.message || "Action failed";
  return null;
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export function BasCategoriesTab({ initialCategories, initialPreferences }: Props) {
  const t = useT();
  const search = useBasSearch((s) => s.search);
  const setSearch = useCallback((v: string) => useBasSearch.store.setState({ search: v }), []);
  const [preferences, setPreferences] = useState<Map<string, BasPreference>>(
    () => new Map(initialPreferences.map((p) => [p.basCode, p])),
  );
  const [expandedClasses, setExpandedClasses] = useState<Set<number>>(new Set([1]));
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [quickStartCodes, setQuickStartCodes] = useState<Set<string>>(new Set());
  const [savingCodes, setSavingCodes] = useState<Set<string>>(new Set());

  const { executeAsync: execActivate } = useAction(activateBasCategoriesAction);
  const { executeAsync: execDeactivate } = useAction(deactivateBasCategoryAction);
  const { executeAsync: execUpdate } = useAction(updateBasPreferenceAction);

  // Filter categories by search
  const filteredCategories = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return initialCategories;
    return initialCategories.filter((c) => {
      const pref = preferences.get(c.code);
      return (
        c.code.includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.nameEn?.toLowerCase().includes(q) ||
        c.nameFr?.toLowerCase().includes(q) ||
        pref?.shortCode?.toLowerCase().includes(q)
      );
    });
  }, [initialCategories, search, preferences]);

  // Group by class
  const classBuckets = useMemo(() => {
    const buckets = new Map<number, BasCategory[]>();
    for (const cat of filteredCategories) {
      const arr = buckets.get(cat.classNum) || [];
      arr.push(cat);
      buckets.set(cat.classNum, arr);
    }
    return buckets;
  }, [filteredCategories]);

  const toggleClass = useCallback((classNum: number) => {
    setExpandedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(classNum)) next.delete(classNum);
      else next.add(classNum);
      return next;
    });
  }, []);

  const toggleRow = useCallback((code: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  const hasActivePrefs = preferences.size > 0;
  const hasFavorites = Array.from(preferences.values()).some((p) => p.isFavorite);

  // ─── Activate / Deactivate ───
  const markSaving = useCallback((code: string, on: boolean) => {
    setSavingCodes((prev) => {
      const next = new Set(prev);
      on ? next.add(code) : next.delete(code);
      return next;
    });
  }, []);

  const handleActivate = useCallback(
    async (code: string) => {
      markSaving(code, true);
      const result = await execActivate({ codes: [code] });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(t("settings.bas.activateFailed", { code, error: err }));
        } else {
          const cat = initialCategories.find((c) => c.code === code);
          if (cat) {
            setPreferences((prev) => {
              const next = new Map(prev);
              next.set(code, {
                id: crypto.randomUUID(),
                basCode: code,
                isFavorite: false,
                shortCode: null,
                translations: null,
                basCategory: cat,
              });
              return next;
            });
          }
        }
      }
      markSaving(code, false);
    },
    [execActivate, initialCategories, markSaving, t],
  );

  const handleDeactivate = useCallback(
    async (code: string) => {
      markSaving(code, true);
      const result = await execDeactivate({ basCode: code });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(t("settings.bas.deactivateFailed", { code, error: err }));
        } else {
          setPreferences((prev) => {
            const next = new Map(prev);
            next.delete(code);
            return next;
          });
          setExpandedRows((prev) => {
            const next = new Set(prev);
            next.delete(code);
            return next;
          });
        }
      }
      markSaving(code, false);
    },
    [execDeactivate, markSaving, t],
  );

  // ─── Favorite toggle (auto-save onChange) ───
  const handleFavoriteToggle = useCallback(
    async (code: string) => {
      setPreferences((prev) => {
        const next = new Map(prev);
        const existing = next.get(code);
        if (existing) next.set(code, { ...existing, isFavorite: !existing.isFavorite });
        return next;
      });
      const result = await execUpdate({
        basCode: code,
        isFavorite: !preferences.get(code)?.isFavorite,
      });
      if (result) {
        const err = actionError(result);
        if (err) {
          toast.error(t("settings.bas.favoriteFailed", { error: err }));
          // Revert optimistic update
          setPreferences((prev) => {
            const next = new Map(prev);
            const existing = next.get(code);
            if (existing) next.set(code, { ...existing, isFavorite: !existing.isFavorite });
            return next;
          });
        }
      }
    },
    [preferences, execUpdate, t],
  );

  // ─── Short code edit (auto-save onBlur) ───
  const handleShortCodeSave = useCallback(
    async (code: string, shortCode: string) => {
      const pref = preferences.get(code);
      if (!pref) return;
      const val = shortCode.trim() || null;
      if (val === pref.shortCode) return;
      setPreferences((prev) => {
        const next = new Map(prev);
        const existing = next.get(code);
        if (existing) next.set(code, { ...existing, shortCode: val });
        return next;
      });
      const result = await execUpdate({ basCode: code, shortCode: val });
      if (result) {
        const err = actionError(result);
        if (err) toast.error(t("settings.bas.aliasFailed", { error: err }));
      }
    },
    [preferences, execUpdate, t],
  );

  // ─── Translations edit (auto-save onBlur) ───
  const handleTranslationSave = useCallback(
    async (code: string, lang: "en" | "sv" | "fr", value: string) => {
      const pref = preferences.get(code);
      if (!pref) return;
      const current = (pref.translations || {}) as Record<string, string | undefined>;
      const newVal = value.trim() || undefined;
      if (current[lang] === newVal) return;
      const translations = { ...current, [lang]: newVal };
      setPreferences((prev) => {
        const next = new Map(prev);
        const existing = next.get(code);
        if (existing) next.set(code, { ...existing, translations });
        return next;
      });
      const result = await execUpdate({ basCode: code, translations });
      if (result) {
        const err = actionError(result);
        if (err) toast.error(t("settings.bas.translationFailed", { error: err }));
      }
    },
    [preferences, execUpdate, t],
  );

  // ─── Quick-start ───
  const commonCategories = useMemo(
    () => initialCategories.filter((c) => c.isCommon && !preferences.has(c.code)),
    [initialCategories, preferences],
  );

  const handleQuickStartInit = useCallback(() => {
    setQuickStartCodes(new Set(commonCategories.map((c) => c.code)));
    setShowQuickStart(true);
  }, [commonCategories]);

  const handleQuickStartConfirm = useCallback(async () => {
    const codes = Array.from(quickStartCodes);
    if (codes.length === 0) return;
    setSavingCodes(new Set(codes));
    const result = await execActivate({ codes });
    if (result) {
      const err = actionError(result);
      if (err) {
        toast.error(t("settings.bas.activateManyFailed", { error: err }));
        setSavingCodes(new Set());
        return; // Keep quick-start panel open on failure
      }
    }
    // Success — update local state (no suggestedAlias in optimistic state; it's not persisted by activate)
    setPreferences((prev) => {
      const next = new Map(prev);
      for (const code of codes) {
        const cat = initialCategories.find((c) => c.code === code);
        if (cat) {
          next.set(code, {
            id: crypto.randomUUID(),
            basCode: code,
            isFavorite: false,
            shortCode: null,
            translations: null,
            basCategory: cat,
          });
        }
      }
      return next;
    });
    setSavingCodes(new Set());
    setShowQuickStart(false);
    toast.success(t("settings.bas.activated", { count: codes.length }));
  }, [quickStartCodes, execActivate, initialCategories, t]);

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("settings.bas.search")}
          className="pl-10"
        />
      </div>

      {/* Empty states & Quick-start */}
      {!hasActivePrefs && !showQuickStart && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">{t("settings.bas.empty")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("settings.bas.emptyHint")}</p>
          <Button variant="default" className="mt-4" onClick={handleQuickStartInit}>
            {t("settings.bas.quickStart")}
          </Button>
        </div>
      )}

      {hasActivePrefs && !hasFavorites && (
        <p className="text-xs text-muted-foreground">{t("settings.bas.noFavorites")}</p>
      )}

      {/* Quick-start preview */}
      {showQuickStart && (
        <QuickStartPreview
          categories={commonCategories}
          selected={quickStartCodes}
          onToggle={(code) => {
            setQuickStartCodes((prev) => {
              const next = new Set(prev);
              next.has(code) ? next.delete(code) : next.add(code);
              return next;
            });
          }}
          onConfirm={handleQuickStartConfirm}
          onCancel={() => setShowQuickStart(false)}
          saving={savingCodes.size > 0}
        />
      )}

      {/* Accordion by class */}
      {Array.from(classBuckets.entries())
        .sort(([a], [b]) => a - b)
        .map(([classNum, categories]) => (
          <ClassAccordion
            key={classNum}
            classNum={classNum}
            className={categories[0]?.className || ""}
            categories={categories}
            preferences={preferences}
            expanded={expandedClasses.has(classNum)}
            expandedRows={expandedRows}
            onToggle={() => toggleClass(classNum)}
            onToggleRow={toggleRow}
            savingCodes={savingCodes}
            onActivate={handleActivate}
            onDeactivate={handleDeactivate}
            onFavoriteToggle={handleFavoriteToggle}
            onShortCodeSave={handleShortCodeSave}
            onTranslationSave={handleTranslationSave}
          />
        ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Quick-start Preview
// ─────────────────────────────────────────────────────────────
function QuickStartPreview({
  categories,
  selected,
  onToggle,
  onConfirm,
  onCancel,
  saving,
}: {
  categories: BasCategory[];
  selected: Set<string>;
  onToggle: (code: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">{t("settings.bas.quickStartTitle")}</h3>
        <span className="text-xs text-muted-foreground">
          {t("settings.bas.selectedOf", { selected: selected.size, total: categories.length })}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-1 max-h-60 overflow-auto">
        {categories.map((cat) => (
          <label
            key={cat.code}
            className="flex items-center gap-2 text-sm cursor-pointer p-1 hover:bg-muted rounded"
          >
            <input
              type="checkbox"
              checked={selected.has(cat.code)}
              onChange={() => onToggle(cat.code)}
              className="rounded"
            />
            <span className="font-mono text-xs text-muted-foreground w-8">{cat.code}</span>
            <span>{cat.nameEn || cat.name}</span>
            {cat.nameEn && (
              <span className="text-xs text-muted-foreground italic" title={cat.name}>
                {cat.name}
              </span>
            )}
          </label>
        ))}
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button size="sm" onClick={onConfirm} disabled={saving || selected.size === 0}>
          {saving ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("settings.bas.activating")}
            </>
          ) : (
            t("settings.bas.activateCount", { count: selected.size })
          )}
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Class Accordion with Virtual List
// ─────────────────────────────────────────────────────────────
function ClassAccordion({
  classNum,
  className,
  categories,
  preferences,
  expanded,
  expandedRows,
  onToggle,
  onToggleRow,
  savingCodes,
  onActivate,
  onDeactivate,
  onFavoriteToggle,
  onShortCodeSave,
  onTranslationSave,
}: {
  classNum: number;
  className: string;
  categories: BasCategory[];
  preferences: Map<string, BasPreference>;
  expanded: boolean;
  expandedRows: Set<string>;
  onToggle: () => void;
  onToggleRow: (code: string) => void;
  savingCodes: Set<string>;
  onActivate: (code: string) => void;
  onDeactivate: (code: string) => void;
  onFavoriteToggle: (code: string) => void;
  onShortCodeSave: (code: string, shortCode: string) => void;
  onTranslationSave: (code: string, lang: "en" | "sv" | "fr", value: string) => void;
}) {
  const t = useT();
  const parentRef = useRef<HTMLDivElement>(null);
  const activeCount = categories.filter((c) => preferences.has(c.code)).length;

  const virtualizer = useVirtualizer({
    count: categories.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => (expandedRows.has(categories[index].code) ? 110 : 44),
    overscan: 10,
  });

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between p-3 hover:bg-muted/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "" : "-rotate-90"}`} />
          <span className="font-medium text-sm">
            {classNum}. {t(`settings.bas.class.${classNum as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`)}
          </span>
          <span className="text-xs text-muted-foreground italic">{className}</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("settings.bas.activeOf", { active: activeCount, total: categories.length })}
        </span>
      </button>

      {expanded && (
        <div ref={parentRef} className="max-h-[400px] overflow-auto border-t">
          <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const cat = categories[virtualRow.index];
              const pref = preferences.get(cat.code);
              const isSaving = savingCodes.has(cat.code);
              const isRowExpanded = expandedRows.has(cat.code);

              return (
                <div
                  key={cat.code}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <CategoryRow
                    category={cat}
                    preference={pref}
                    saving={isSaving}
                    expanded={isRowExpanded}
                    onToggleExpand={() => onToggleRow(cat.code)}
                    onActivate={() => onActivate(cat.code)}
                    onDeactivate={() => onDeactivate(cat.code)}
                    onFavoriteToggle={() => onFavoriteToggle(cat.code)}
                    onShortCodeSave={(v) => onShortCodeSave(cat.code, v)}
                    onTranslationSave={(lang, v) => onTranslationSave(cat.code, lang, v)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Category Row
// ─────────────────────────────────────────────────────────────
function CategoryRow({
  category,
  preference,
  saving,
  expanded,
  onToggleExpand,
  onActivate,
  onDeactivate,
  onFavoriteToggle,
  onShortCodeSave,
  onTranslationSave,
}: {
  category: BasCategory;
  preference?: BasPreference;
  saving: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onActivate: () => void;
  onDeactivate: () => void;
  onFavoriteToggle: () => void;
  onShortCodeSave: (shortCode: string) => void;
  onTranslationSave: (lang: "en" | "sv" | "fr", value: string) => void;
}) {
  const t = useT();
  const isActive = !!preference;

  return (
    <div className={`border-b last:border-b-0 ${isActive ? "bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2 px-3 py-2 text-sm">
        {/* Activate/Deactivate toggle */}
        <input
          type="checkbox"
          checked={isActive}
          onChange={isActive ? onDeactivate : onActivate}
          disabled={saving}
          className="rounded"
          title={isActive ? t("settings.bas.deactivate") : t("settings.bas.activate")}
          aria-label={`${isActive ? t("settings.bas.deactivate") : t("settings.bas.activate")} ${category.code}`}
        />

        {/* Code */}
        <span className="font-mono text-xs text-muted-foreground w-8 shrink-0">
          {category.code}
        </span>

        {/* Name — English (the owner's own, else the chart's), the Swedish canonical name small (D72) */}
        <span className="truncate flex-1 min-w-0">
          {ownEnglish(preference) || category.nameEn || category.name}
        </span>
        {(ownEnglish(preference) || category.nameEn) && (
          <span className="hidden sm:inline text-xs text-muted-foreground italic truncate max-w-40">
            {category.name}
          </span>
        )}

        {/* Favorite star (only for active) */}
        {isActive && (
          <button
            type="button"
            onClick={onFavoriteToggle}
            className="shrink-0"
            title={
              preference?.isFavorite ? t("settings.bas.unfavorite") : t("settings.bas.favorite")
            }
            aria-label={`${preference?.isFavorite ? t("settings.bas.unfavorite") : t("settings.bas.favorite")} ${category.code}`}
          >
            <Star
              className={`h-4 w-4 ${
                preference?.isFavorite
                  ? "fill-amber-400 text-amber-400"
                  : "text-muted-foreground hover:text-amber-400"
              }`}
            />
          </button>
        )}

        {/* Short code display / Expand */}
        {isActive && (
          <button
            type="button"
            onClick={onToggleExpand}
            className="text-xs text-muted-foreground hover:text-foreground shrink-0"
            title={t("settings.bas.edit")}
            aria-label={`${t("settings.bas.edit")} ${category.code}`}
          >
            {preference?.shortCode || t("settings.bas.editShort")}
          </button>
        )}

        {/* Saving indicator */}
        {saving && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground shrink-0" />}
      </div>

      {/* Expanded edit area */}
      {isActive && expanded && (
        <div className="px-3 pb-2 pt-0 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <InlineField
            code={category.code}
            label={t("settings.bas.alias")}
            value={preference?.shortCode || ""}
            onSave={onShortCodeSave}
            placeholder={category.suggestedAlias || t("settings.bas.aliasPlaceholder")}
          />
          <InlineField
            code={category.code}
            label={t("settings.bas.customSv")}
            value={(preference?.translations as Record<string, string>)?.sv || ""}
            onSave={(v) => onTranslationSave("sv", v)}
            placeholder={category.name}
          />
          <InlineField
            code={category.code}
            label={t("settings.bas.customEn")}
            value={(preference?.translations as Record<string, string>)?.en || ""}
            onSave={(v) => onTranslationSave("en", v)}
            placeholder={category.nameEn || ""}
          />
          <InlineField
            code={category.code}
            label={t("settings.bas.customFr")}
            value={(preference?.translations as Record<string, string>)?.fr || ""}
            onSave={(v) => onTranslationSave("fr", v)}
            placeholder={category.nameFr || ""}
          />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Inline text field with auto-save onBlur
// ─────────────────────────────────────────────────────────────
function InlineField({
  code,
  label,
  value,
  onSave,
  placeholder,
}: {
  code: string;
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  const id = `bas-field-${code}-${label.toLowerCase().replace(/\s+/g, "-")}`;

  // Sync local state when value prop changes (e.g., server response updates)
  useEffect(() => {
    setLocal(value);
  }, [value]);

  return (
    <div>
      <label htmlFor={id} className="text-[10px] text-muted-foreground uppercase">
        {label}
      </label>
      <Input
        id={id}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => onSave(local)}
        placeholder={placeholder}
        className="h-7 text-xs"
      />
    </div>
  );
}

/** The owner's own English name for an account (Settings → BAS, `translations.en`), when he wrote one. */
function ownEnglish(
  pref: { translations?: Record<string, unknown> | null } | null | undefined,
): string | null {
  const en = pref?.translations?.en;
  return typeof en === "string" && en.trim() ? en.trim() : null;
}
