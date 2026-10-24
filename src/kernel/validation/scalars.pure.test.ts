import { describe, expect, it } from "vitest";
import { basCode, isoDate, money, positiveMoney, positiveRate, uuid } from "./scalars";

const ok = (s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;
const message = (
  s: { safeParse: (v: unknown) => { success: boolean; error?: { issues: { message: string }[] } } },
  v: unknown,
) => s.safeParse(v).error?.issues[0]?.message;

describe("kernel/validation scalars", () => {
  it("uuid accepts a UUID, refuses anything else", () => {
    expect(ok(uuid, "0f8fad5b-d9cb-469f-a165-70867728950e")).toBe(true);
    expect(ok(uuid, "not-a-uuid")).toBe(false);
    expect(ok(uuid, "")).toBe(false);
  });

  it("isoDate accepts YYYY-MM-DD calendar dates only", () => {
    expect(ok(isoDate, "2026-10-22")).toBe(true);
    expect(ok(isoDate, "2026-02-30")).toBe(false);
    expect(ok(isoDate, "22.10.2026")).toBe(false);
    expect(ok(isoDate, "2026-10-22T10:00:00Z")).toBe(false);
  });

  it("money: digits with up to 2 decimals, zero allowed, no sign", () => {
    for (const v of ["0", "12", "12.5", "12.50", "1000000.99"]) expect(ok(money, v)).toBe(true);
    for (const v of ["-1", "1.234", "1,50", " 1", "", "1."]) expect(ok(money, v)).toBe(false);
    expect(message(money, "1.234")).toBe("Use digits with up to 2 decimals");
  });

  it("positiveMoney: money strictly above zero", () => {
    expect(ok(positiveMoney, "0.01")).toBe(true);
    expect(ok(positiveMoney, "0")).toBe(false);
    expect(ok(positiveMoney, "0.00")).toBe(false);
    expect(message(positiveMoney, "0")).toBe("The amount must be positive");
    expect(message(positiveMoney, "1.234")).toBe("Use digits with up to 2 decimals");
  });

  it("positiveRate: digits with up to 6 decimals, strictly above zero (F50-j)", () => {
    for (const v of ["1", "11.1", "0.000001", "11.899657"]) expect(ok(positiveRate, v)).toBe(true);
    for (const v of ["0", "0.000000", "-1", "1.1234567", "1,5", "", "1."])
      expect(ok(positiveRate, v)).toBe(false);
    expect(message(positiveRate, "1.1234567")).toBe("Use digits with up to 6 decimals");
    expect(message(positiveRate, "0")).toBe("The rate must be positive");
  });

  it("basCode: 3 or 4 digits", () => {
    expect(ok(basCode, "193")).toBe(true);
    expect(ok(basCode, "1930")).toBe(true);
    expect(ok(basCode, "19")).toBe(false);
    expect(ok(basCode, "19300")).toBe(false);
    expect(message(basCode, "abc")).toBe("A BAS code is 3 or 4 digits");
  });
});
