"use client";

// A translated string for server components: `<Msg k="settings.title" />` renders `t(k)` in the user's language
// (the LocaleProvider carries it), so a page need not fetch the preferences just for a heading.
import type { MessageKey, MessageParams } from "./translate";
import { useT } from "./use-t";

export function Msg({ k, params }: { k: MessageKey; params?: MessageParams }) {
  const t = useT();
  return <>{t(k, params)}</>;
}
