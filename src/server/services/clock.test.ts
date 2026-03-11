import { describe, expect, it } from "vitest";
import { createClock, createTestClock } from "./clock";

describe("RealClock", () => {
  const clock = createClock();

  it("now() returns Date within 100ms of Date.now()", () => {
    const before = Date.now();
    const result = clock.now();
    const after = Date.now();

    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("TestClock", () => {
  const fixed = new Date("2026-03-11T12:00:00Z");

  it("now() returns deterministic values", () => {
    const clock = createTestClock(fixed);
    const a = clock.now();
    const b = clock.now();

    expect(a.getTime()).toBe(fixed.getTime());
    expect(b.getTime()).toBe(fixed.getTime());
  });

  it("now() returns defensive copies", () => {
    const clock = createTestClock(fixed);
    const a = clock.now();
    a.setFullYear(2000); // mutate the returned Date
    const b = clock.now();

    expect(b.getTime()).toBe(fixed.getTime()); // unaffected
  });

  it("today() timezone boundary: UTC 23:00 March 10 = Stockholm March 11 (CET+1)", () => {
    // UTC 23:30 on March 10 → Stockholm is 00:30 on March 11 (CET = UTC+1)
    const clock = createTestClock(new Date("2026-03-10T23:30:00Z"));
    expect(clock.today()).toBe("2026-03-11");
  });

  it("today() DST transition day: CET→CEST last Sunday of March", () => {
    // 2026-03-29 is the last Sunday of March (DST transition day)
    // UTC 00:30 → Stockholm 01:30 CET (still CET before 02:00 local)
    const clock = createTestClock(new Date("2026-03-29T00:30:00Z"));
    expect(clock.today()).toBe("2026-03-29");
  });

  it("today() at exact DST transition moment: UTC 2026-03-29T01:00:00Z", () => {
    // At UTC 01:00, Stockholm jumps from 02:00 → 03:00 (CEST begins)
    // So Stockholm time is 03:00 on 2026-03-29
    const clock = createTestClock(new Date("2026-03-29T01:00:00Z"));
    expect(clock.today()).toBe("2026-03-29");
  });

  it("currentPeriod() returns YYYY-MM matching today() month", () => {
    const clock = createTestClock(new Date("2026-03-15T10:00:00Z"));
    expect(clock.currentPeriod()).toBe("2026-03");
    expect(clock.today().startsWith(clock.currentPeriod())).toBe(true);
  });

  it("currentPeriod() across timezone boundary", () => {
    // UTC Dec 31 23:30 → Stockholm Jan 1 00:30
    const clock = createTestClock(new Date("2026-12-31T23:30:00Z"));
    expect(clock.currentPeriod()).toBe("2027-01");
  });

  it("advance() moves time forward correctly", () => {
    const clock = createTestClock(new Date("2026-03-11T12:00:00Z"));
    clock.advance(60_000); // advance 1 minute

    expect(clock.now().toISOString()).toBe("2026-03-11T12:01:00.000Z");
  });

  it("advance() accumulates multiple calls", () => {
    const clock = createTestClock(new Date("2026-03-11T12:00:00Z"));
    clock.advance(30_000);
    clock.advance(30_000);

    expect(clock.now().toISOString()).toBe("2026-03-11T12:01:00.000Z");
  });

  it("setTime() replaces fixed time", () => {
    const clock = createTestClock(new Date("2026-03-11T12:00:00Z"));
    clock.setTime(new Date("2026-06-15T08:00:00Z"));

    expect(clock.now().toISOString()).toBe("2026-06-15T08:00:00.000Z");
    expect(clock.today()).toBe("2026-06-15");
  });

  it("createTestClock() throws on Invalid Date input", () => {
    expect(() => createTestClock(new Date("invalid"))).toThrow("TestClock: Invalid Date provided");
  });

  it("setTime() throws on Invalid Date input", () => {
    const clock = createTestClock(fixed);
    expect(() => clock.setTime(new Date("invalid"))).toThrow(
      "TestClock.setTime: Invalid Date provided",
    );
  });
});
