import { describe, expect, it } from "vitest";
import { RateSource as RateSourceEnum } from "@/generated/prisma/enums";
import { EXPENSE_RATE_SOURCES } from "./types";

describe("expense rate sources", () => {
  it("are exactly the Postgres rate_source enum's (F67, lessons audit 30)", () => {
    expect([...EXPENSE_RATE_SOURCES].sort()).toEqual(Object.values(RateSourceEnum).sort());
  });
});
