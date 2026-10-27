// Sign-up is open until the box is told otherwise (D61, F105 — audit 2026-10-27 D1): `AUTH_SIGNUP=closed` turns off
// registration, organisation creation and the /register page in one place. Nothing else reads the variable.
// Dev, CI and the e2e keep the default (open); the production `.env.prod` sets it once the owner exists.

export const AUTH_SIGNUP_CLOSED = "closed";

export function signupClosed(env: Record<string, string | undefined> = process.env): boolean {
  return env.AUTH_SIGNUP?.trim().toLowerCase() === AUTH_SIGNUP_CLOSED;
}
