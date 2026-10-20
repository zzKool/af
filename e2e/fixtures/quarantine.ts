import { test } from "@playwright/test";

/**
 * Quarantine a flaky test (constitution §4.3): skipped with the issue that tracks it, never retried
 * into green. Usage: `quarantine("#42 — document upload races the OCR mock");` as the first line of
 * the test.
 */
export function quarantine(issue: string): void {
  test.skip(true, `quarantined: ${issue}`);
}
