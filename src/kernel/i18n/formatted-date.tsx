"use client";

import { useLocale } from "@/kernel/i18n/locale-provider";

type FormattedDateProps = {
  date: Date | string;
};

export function FormattedDate({ date }: FormattedDateProps) {
  const { locale } = useLocale();
  const d = typeof date === "string" ? new Date(date) : date;
  return <time dateTime={d.toISOString()}>{d.toLocaleDateString(locale ?? undefined)}</time>;
}
