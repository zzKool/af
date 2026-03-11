import { describe, expect, test } from "vitest";
import { formatDateShort, formatDateTime } from "./format-date";

describe("formatDateTime", () => {
  const testDate = new Date("2026-03-11T14:30:00Z");

  test("formats with en locale", () => {
    const result = formatDateTime(testDate, "en");
    expect(result).toBeTruthy();
    expect(result).toContain("2026");
  });

  test("formats with en-US locale", () => {
    const result = formatDateTime(testDate, "en-US");
    expect(result).toBeTruthy();
    expect(result).toContain("2026");
  });

  test("formats with de-DE locale", () => {
    const result = formatDateTime(testDate, "de-DE");
    expect(result).toBeTruthy();
    expect(result).toContain("2026");
  });

  test("accepts string date input", () => {
    const result = formatDateTime("2026-03-11T14:30:00Z", "en");
    expect(result).toBeTruthy();
    expect(result).toContain("2026");
  });
});

describe("formatDateShort", () => {
  const testDate = new Date("2026-03-11T14:30:00Z");

  test("formats with en locale", () => {
    const result = formatDateShort(testDate, "en");
    expect(result).toBeTruthy();
  });

  test("formats with de-DE locale", () => {
    const result = formatDateShort(testDate, "de-DE");
    expect(result).toBeTruthy();
  });

  test("accepts string date input", () => {
    const result = formatDateShort("2026-03-11T14:30:00Z", "en");
    expect(result).toBeTruthy();
  });
});
