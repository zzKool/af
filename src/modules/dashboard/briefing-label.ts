// One briefing line in the reader's language: `{count} {entity} {action}`. The audit trail's entity types and
// actions are snake_case business names; each has a `dashboard.briefing.*` key, and a type the dictionary does not
// know yet reads as its spaced name rather than as a raw key.
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";
import type { BriefingLine } from "./types";

type T = (key: MessageKey, params?: MessageParams) => string;

// `count` is the line's count: the words agree with it (`1 partner reactivated`, `2 partners reactivated`)
function lookup(t: T, key: string, fallback: string, count?: number): string {
  const s = t(key as MessageKey, count === undefined ? undefined : { count });
  return s === key ? fallback : s;
}

export function briefingEntity(t: T, entityType: string, count?: number): string {
  return lookup(t, `dashboard.briefing.entity.${entityType}`, entityType.replace(/_/g, " "), count);
}

export function briefingAction(t: T, action: string, count?: number): string {
  return lookup(t, `dashboard.briefing.action.${action}`, action, count);
}

export function briefingText(
  t: T,
  line: Pick<BriefingLine, "entityType" | "action"> & { count?: number },
): string {
  return `${briefingEntity(t, line.entityType, line.count)} ${briefingAction(t, line.action, line.count)}`;
}
