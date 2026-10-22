import { describe, expect, it } from "vitest";
import { translate } from "@/kernel/i18n/translate";
import { registerErrorKey } from "./register-error";

describe("registerErrorKey", () => {
  it("maps Better Auth's codes to a translated message", () => {
    expect(registerErrorKey({ code: "USER_ALREADY_EXISTS" })).toBe(
      "auth.register.error.emailTaken",
    );
    expect(registerErrorKey({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL" })).toBe(
      "auth.register.error.emailTaken",
    );
    expect(registerErrorKey({ message: "User already exists" })).toBe(
      "auth.register.error.emailTaken",
    );
    expect(registerErrorKey({ code: "PASSWORD_TOO_SHORT" })).toBe(
      "auth.register.error.passwordTooShort",
    );
    expect(registerErrorKey({ code: "INVALID_EMAIL" })).toBe("auth.register.error.invalidEmail");
  });

  it("anything else is the generic failure — never the raw English message", () => {
    const key = registerErrorKey({ code: "SOMETHING_NEW", message: "Internal detail" });
    expect(key).toBe("auth.register.error.failed");
    expect(translate("sv", key)).toBe("Registreringen misslyckades. Försök igen.");
  });
});
