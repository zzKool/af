// The partner's default category in the new-expense dialog (F87, FR-003) — proposed, never overwriting. Pure and
// client-safe: the dialog runs it, the service does not apply defaults (what the dialog sends is what is saved).
//
//   source null     the dialog's pre-selection, nothing chosen yet   → a partner's default replaces it
//   source partner  set by a previous partner's default (a proposal) → the next partner's default replaces it
//   source ai       the AI's proposal for the receipt (F126)         → a partner's default replaces it
//   source owner    the owner picked it                              → never replaced
//
// A partner without a default, an unknown default (not in the tenant's categories) or clearing the partner leaves
// the category as it is.

export type CategorySource = "owner" | "partner" | "ai" | null;

export type CategoryState = { code: string; source: CategorySource };

/** A partner was picked (or cleared: `partnerDefault` null). */
export function proposeCategory(
  state: CategoryState,
  partnerDefault: string | null | undefined,
  available: readonly string[],
): CategoryState {
  if (state.source === "owner") return state;
  if (!partnerDefault || !available.includes(partnerDefault)) return state;
  return { code: partnerDefault, source: "partner" };
}

/**
 * F126: the AI's proposal for the receipt fills an empty, untouched field — never over the owner's pick or a
 * partner's default; a partner picked afterwards replaces it with its default.
 */
export function proposeFromAi(
  state: CategoryState,
  code: string | null | undefined,
  available: readonly string[],
): CategoryState {
  if (state.source !== null || state.code !== "") return state;
  if (!code || !available.includes(code)) return state;
  return { code, source: "ai" };
}

/** The owner picked a category by hand: his from now on. */
export function chooseCategory(code: string): CategoryState {
  return { code, source: "owner" };
}
