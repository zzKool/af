import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit, resetRateLimit } from "./rate-limit";

beforeEach(() => {
  resetRateLimit();
});

describe("rate-limit", () => {
  it("allows requests within limit", () => {
    const result = checkRateLimit("user-1", 5, 60_000);
    expect(result.allowed).toBe(true);
  });

  it("rejects requests exceeding limit", () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit("user-1", 5, 60_000);
    }
    const result = checkRateLimit("user-1", 5, 60_000);
    expect(result.allowed).toBe(false);
  });

  it("resets counter after window expires", () => {
    const shortWindowMs = 50;
    for (let i = 0; i < 3; i++) {
      checkRateLimit("user-1", 3, shortWindowMs);
    }
    expect(checkRateLimit("user-1", 3, shortWindowMs).allowed).toBe(false);

    // Wait for window to expire
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const result = checkRateLimit("user-1", 3, shortWindowMs);
        expect(result.allowed).toBe(true);
        resolve();
      }, shortWindowMs + 10);
    });
  });

  it("isolates rate limits per user", () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit("user-1", 3, 60_000);
    }
    expect(checkRateLimit("user-1", 3, 60_000).allowed).toBe(false);
    expect(checkRateLimit("user-2", 3, 60_000).allowed).toBe(true);
  });

  it("resetRateLimit clears all state", () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit("user-1", 3, 60_000);
    }
    expect(checkRateLimit("user-1", 3, 60_000).allowed).toBe(false);

    resetRateLimit();
    expect(checkRateLimit("user-1", 3, 60_000).allowed).toBe(true);
  });
});
