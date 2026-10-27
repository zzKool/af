import { describe, expect, it } from "vitest";
import { signupClosed } from "./signup";

describe("signupClosed (D61 / F105)", () => {
  it("is open unless AUTH_SIGNUP says closed", () => {
    expect(signupClosed({})).toBe(false);
    expect(signupClosed({ AUTH_SIGNUP: undefined })).toBe(false);
    expect(signupClosed({ AUTH_SIGNUP: "open" })).toBe(false);
    expect(signupClosed({ AUTH_SIGNUP: "" })).toBe(false);
  });

  it("closed, whatever the case or the spaces around it", () => {
    expect(signupClosed({ AUTH_SIGNUP: "closed" })).toBe(true);
    expect(signupClosed({ AUTH_SIGNUP: " Closed " })).toBe(true);
  });
});
