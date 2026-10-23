// The checklist's derived states (F71): one map, each state reached by its rule, the build's status on its own.
import { describe, expect, it } from "vitest";
import { PackageBuildStatus as PackageBuildStatusEnum } from "@/generated/prisma/enums";
import { STATE_FAMILIES } from "@/kernel/ui/state-label";
import {
  BUILD_STATUS_FAMILY,
  isRunning,
  PERIOD_STATE_FAMILY,
  PERIOD_STATES,
  periodState,
} from "./state-family";
import { PACKAGE_BUILD_STATUSES, type PackageBuildStatus, type PackageCounts } from "./types";

const NONE: PackageCounts = {
  bankRows: 0,
  invoices: 0,
  supplierInvoices: 0,
  expenses: 0,
  settlements: 0,
  documents: 0,
};
const ROWS: PackageCounts = { ...NONE, bankRows: 7, documents: 4 };
const b = (...statuses: PackageBuildStatus[]) => statuses.map((status) => ({ status }));

describe("the period's checklist state", () => {
  it.each([
    ["nothing in the month", NONE, 0, b(), "empty"],
    [
      "only a document (a forced upload of last month's receipt)",
      { ...NONE, documents: 1 },
      0,
      b(),
      "ready",
    ],
    ["rows, nothing flagged, never built", ROWS, 0, b(), "ready"],
    ["rows with flags", ROWS, 2, b(), "flagged"],
    ["built and clean", ROWS, 0, b("built"), "built"],
    ["built, then something got flagged — the flag wins", ROWS, 1, b("built"), "flagged"],
    ["a build queued", ROWS, 2, b("queued", "built"), "building"],
    ["a build running", ROWS, 0, b("building"), "building"],
    ["the latest build failed, an older one built", ROWS, 0, b("failed", "built"), "failed"],
    ["an older failure under a newer success", ROWS, 0, b("built", "failed"), "built"],
    ["an empty month built anyway", NONE, 0, b("built"), "built"],
  ] as const)("%s → %s", (_, counts, flags, builds, expected) => {
    expect(periodState({ counts, flags, builds })).toBe(expected);
  });

  it("every state and every build status has exactly one family", () => {
    expect(Object.keys(PERIOD_STATE_FAMILY).sort()).toEqual([...PERIOD_STATES].sort());
    expect(Object.keys(BUILD_STATUS_FAMILY).sort()).toEqual([...PACKAGE_BUILD_STATUSES].sort());
    for (const f of [...Object.values(PERIOD_STATE_FAMILY), ...Object.values(BUILD_STATUS_FAMILY)])
      expect(STATE_FAMILIES).toContain(f);
  });

  it("asks for the owner (attention) exactly when something is flagged or a build failed", () => {
    const attention = PERIOD_STATES.filter((s) => PERIOD_STATE_FAMILY[s] === "attention");
    expect(attention.sort()).toEqual(["failed", "flagged"]);
    expect(PERIOD_STATE_FAMILY.built).toBe("done");
    expect(PERIOD_STATE_FAMILY.empty).toBe("neutral");
  });

  it("the DTO's build statuses are exactly the Postgres enum's (lessons audit 30)", () => {
    expect([...PACKAGE_BUILD_STATUSES].sort()).toEqual(
      Object.values(PackageBuildStatusEnum).sort(),
    );
  });

  it("a build runs while queued or building", () => {
    expect(PACKAGE_BUILD_STATUSES.filter((status) => isRunning({ status }))).toEqual([
      "queued",
      "building",
    ]);
  });
});
