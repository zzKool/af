import { describe, expect, it } from "vitest";
import { observationsToFetch } from "./ecb-sync";

describe("ECB sync — observations to fetch", () => {
  it("first run: a month of observations", () => {
    expect(observationsToFetch(null, new Date("2026-10-20"))).toBe(30);
  });

  it("daily run: a small window with slack for the publication lag", () => {
    // Monday after a rate stored on Friday: 0 weekdays between → minimum
    expect(observationsToFetch(new Date("2026-10-16"), new Date("2026-10-19"))).toBe(5);
  });

  it("catch-up after weeks down: the gap in weekdays plus slack", () => {
    // 2026-09-01 (Tue) → 2026-10-20 (Tue): 34 weekdays strictly between
    expect(observationsToFetch(new Date("2026-09-01"), new Date("2026-10-20"))).toBe(36);
  });

  it("is capped so one run can never ask for years of history", () => {
    expect(observationsToFetch(new Date("2020-01-01"), new Date("2026-10-20"))).toBe(400);
  });
});
