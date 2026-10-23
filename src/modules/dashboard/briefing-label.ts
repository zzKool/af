// One briefing line in the reader's language: `{count} {entity} {action}`. The audit trail's entity types and
// actions are snake_case business names; each has a `dashboard.briefing.*` key, and a type the dictionary does not
// know yet reads as its spaced name rather than as a raw key.
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";
import type { BriefingLine } from "./types";

type T = (key: MessageKey, params?: MessageParams) => string;

function lookup(t: T, key: string, fallback: string): string {
  const s = t(key as MessageKey);
  return s === key ? fallback : s;
}

export function briefingEntity(t: T, entityType: string): string {
  return lookup(t, `dashboard.briefing.entity.${entityType}`, entityType.replace(/_/g, " "));
}

export function briefingAction(t: T, action: string): string {
  return lookup(t, `dashboard.briefing.action.${action}`, action);
}

export function briefingText(t: T, line: Pick<BriefingLine, "entityType" | "action">): string {
  return `${briefingEntity(t, line.entityType)} ${briefingAction(t, line.action)}`;
}
