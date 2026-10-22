import type { MessageKey } from "@/kernel/i18n/translate";

/** Better Auth's sign-up error → the key of the message shown under the form (the raw message is English). */
export function registerErrorKey(error: { code?: string; message?: string }): MessageKey {
  const code = error.code ?? "";
  if (code.startsWith("USER_ALREADY_EXISTS") || error.message?.includes("already")) {
    return "auth.register.error.emailTaken";
  }
  if (code === "PASSWORD_TOO_SHORT") return "auth.register.error.passwordTooShort";
  if (code === "INVALID_EMAIL") return "auth.register.error.invalidEmail";
  return "auth.register.error.failed";
}
