import { describe, expect, it } from "vitest";
import { RateSource as RateSourceEnum } from "@/generated/prisma/enums";
import { SUPPLIER_INVOICE_RATE_SOURCES } from "./types";

describe("supplier-invoice rate sources", () => {
  it("are the Postgres rate_source enum's but `bank` (F67, lessons audit 30; F114: a CHECK refuses it — the bank's base sits on the link)", () => {
    expect([...SUPPLIER_INVOICE_RATE_SOURCES].sort()).toEqual(
      Object.values(RateSourceEnum)
        .filter((v) => v !== "bank")
        .sort(),
    );
  });
});
