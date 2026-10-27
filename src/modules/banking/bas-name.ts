// A BAS label arrives as `657 · Bankkostnader` (settings' `basLabels`, the category options). On screen the code is
// its own <Tag> (F71), so the words beside it drop the code — never `657 657 · Bankkostnader`. Client-safe.
export function basName(code: string, label: string | null | undefined): string | null {
  if (!label || label === code) return null;
  const prefix = `${code} · `;
  return label.startsWith(prefix) ? label.slice(prefix.length) || null : label;
}
