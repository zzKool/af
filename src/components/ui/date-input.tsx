"use client";

// The one date field (the af-design rule: dates read `yyyy-mm-dd`, in every UI language). A native
// `<input type="date">` shows the browser's locale — `11/09/2026` in an English Chrome — so the field is a text input
// that holds `yyyy-mm-dd`, with the browser's own calendar one click away (a hidden native picker writes back).
// Drop-in for `<Input type="date">`: the same `value` / `defaultValue` / `onChange(e)` / `onBlur` — `onChange` fires
// only with a complete valid date or with the field emptied (as the native field), the text in between stays
// local; a blur on an incomplete text puts the last date back.
import { CalendarDays } from "lucide-react";
import type * as React from "react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `2026-02-30` is not a date; `2026-02-28` is. */
export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

const FIELD =
  "h-8 w-full min-w-0 rounded-md border border-input bg-surface px-2.5 py-1 pr-8 text-[13px] tabular-nums transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-app disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20";

export function DateInput({
  value,
  defaultValue,
  onChange,
  onBlur,
  className,
  plain = false,
  min,
  max,
  disabled,
  readOnly,
  ...props
}: Omit<React.ComponentProps<"input">, "type"> & {
  /** no kit styling — the caller's `className` alone (the invoice sheet's inline fields) */
  plain?: boolean;
}) {
  const field = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const controlled = value !== undefined;
  const [text, setText] = useState(String((controlled ? value : defaultValue) ?? ""));
  // the last date handed out (or given in): a blur on half a date puts it back; an outside change shows
  const [settled, setSettled] = useState(String((controlled ? value : defaultValue) ?? ""));
  if (controlled && String(value ?? "") !== settled) {
    setSettled(String(value ?? ""));
    setText(String(value ?? ""));
  }

  const handle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setText(v);
    if (v === "" || isIsoDate(v)) {
      setSettled(v);
      onChange?.(e);
    }
  };

  /** the native picker's choice, written into the field as if typed — React's onChange runs as for a key */
  const fromPicker = (v: string) => {
    const el = field.current;
    if (!el || !isIsoDate(v)) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    set?.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
  };

  return (
    <span className={cn("relative flex min-w-0 items-center", plain && "inline-flex")}>
      <input
        {...props}
        ref={field}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={props.placeholder ?? "yyyy-mm-dd"}
        maxLength={10}
        value={text}
        disabled={disabled}
        readOnly={readOnly}
        onChange={handle}
        onBlur={(e) => {
          if (text !== "" && !isIsoDate(text)) setText(settled);
          onBlur?.(e);
        }}
        aria-invalid={props["aria-invalid"] ?? (text !== "" && !isIsoDate(text) ? true : undefined)}
        className={plain ? className : cn(FIELD, className)}
      />
      {!disabled && !readOnly && (
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onClick={() => {
            const p = picker.current;
            if (!p) return;
            p.value = isIsoDate(text) ? text : "";
            try {
              p.showPicker();
            } catch {
              p.focus();
            }
          }}
          className={cn(
            "absolute right-1.5 flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground print:hidden",
            plain && "-right-5",
          )}
        >
          <CalendarDays className="size-3.5" />
        </button>
      )}
      <input
        ref={picker}
        type="date"
        tabIndex={-1}
        aria-hidden
        min={min}
        max={max}
        className="pointer-events-none absolute right-0 bottom-0 size-px opacity-0"
        onChange={(e) => fromPicker(e.target.value)}
      />
    </span>
  );
}
