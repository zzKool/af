import { describe, expect, it } from "vitest";
import { catchUpObservations, observationsToFetch } from "./ecb-sync";

describe("ECB sync — observations to fetch", () => {
  it("first run: a month of observations", () => {
    expect(observationsToFetch(null, "2026-10-20")).toBe(30);
  });

  it("daily run: a small window with slack for the publication lag", () => {
    // Monday after a rate stored on Friday: 0 weekdays between → minimum
    expect(observationsToFetch("2026-10-16", "2026-10-19")).toBe(5);
  });

  it("catch-up after weeks down: the gap in weekdays plus slack", () => {
    // 2026-09-01 (Tue) → 2026-10-20 (Tue): 34 weekdays strictly between
    expect(observationsToFetch("2026-09-01", "2026-10-20")).toBe(36);
  });

  it("is capped so one run can never ask for years of history", () => {
    expect(observationsToFetch("2020-01-01", "2026-10-20")).toBe(400);
  });
});

describe("ECB sync — the window is sized from the pair furthest behind (T001)", () => {
  const today = "2026-10-21"; // Wed

  it("all pairs current: the floor", () => {
    expect(catchUpObservations(["2026-10-20", "2026-10-20", "2026-10-20"], today)).toBe(5);
  });

  it("one pair two weeks behind while the others are current: its gap, not theirs", () => {
    // EUR/CHF last stored Tue 10-06: 10 weekdays missing (10-07 … 10-20) + 2
    expect(catchUpObservations(["2026-10-20", "2026-10-06", "2026-10-20"], today)).toBe(12);
  });

  it("a pair never stored (added later) counts as a first run; nothing at all too", () => {
    expect(catchUpObservations(["2026-10-20", null], today)).toBe(30);
    expect(catchUpObservations([], today)).toBe(30);
  });
});
