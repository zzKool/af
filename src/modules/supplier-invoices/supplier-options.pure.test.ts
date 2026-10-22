import { describe, expect, it } from "vitest";
import { withCreatedSuppliers } from "./supplier-options";
import type { SupplierOption } from "./types";

const option = (
  id: string,
  name: string,
  paymentTermsDays: number | null = null,
): SupplierOption => ({
  id,
  name,
  defaultCurrency: null,
  defaultBasCategoryCode: null,
  paymentTermsDays,
});

describe("withCreatedSuppliers — each supplier once in the dialog's list", () => {
  it("a supplier created from the match card shows first, before the page knows it", () => {
    const list = withCreatedSuppliers([option("new", "Telia")], [option("p1", "Skattepunkten")]);
    expect(list.map((s) => s.id)).toEqual(["new", "p1"]);
  });

  it("once the refreshed page lists it too, it appears once — with the page's row (its defaults)", () => {
    const list = withCreatedSuppliers(
      [option("new", "Telia")],
      [option("p1", "Skattepunkten"), option("new", "Telia AB", 30)],
    );
    expect(list.map((s) => s.id)).toEqual(["p1", "new"]);
    expect(list.find((s) => s.id === "new")).toMatchObject({
      name: "Telia AB",
      paymentTermsDays: 30,
    });
  });

  it("the same supplier created twice is listed once", () => {
    const list = withCreatedSuppliers([option("new", "Telia"), option("new", "Telia")], []);
    expect(list.map((s) => s.id)).toEqual(["new"]);
  });
});
