// The boxes over a page (F141): one polygon per field on that page in the page's own unit, the active one marked,
// nothing for another page or without the page's size. Invented marks (D51).
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-pdf", () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: {} },
}));

import type { ReadingMarks } from "../reading-marks";
import { MarksOverlay } from "./document-preview";

afterEach(cleanup);

const marks: ReadingMarks = {
  pages: [{ page: 1, width: 8.5, height: 11, unit: "inch" }],
  marks: [
    {
      key: "vendorName",
      confidence: 0.97,
      box: { page: 1, polygon: [1, 1, 3, 1, 3, 1.3, 1, 1.3] },
    },
    {
      key: "invoiceNumber",
      confidence: 0.81,
      box: { page: 1, polygon: [5, 1, 7, 1, 7, 1.3, 5, 1.3] },
    },
    {
      key: "invoiceTotal",
      confidence: 0.98,
      box: { page: 2, polygon: [5, 8, 7, 8, 7, 8.3, 5, 8.3] },
    },
  ],
};

describe("MarksOverlay", () => {
  it("the page's fields as polygons in its unit; sure green, to check amber, the active one in the action colour", () => {
    const { container } = render(<MarksOverlay marks={marks} page={1} active="invoiceNumber" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("viewBox")).toBe("0 0 8.5 11");
    const polys = [...container.querySelectorAll("polygon")];
    expect(polys.map((p) => p.getAttribute("data-mark"))).toEqual(["vendorName", "invoiceNumber"]);
    expect(polys[0]?.getAttribute("class")).toContain("stroke-state-done");
    expect(polys[1]?.getAttribute("data-active")).toBe("true");
    expect(polys[1]?.getAttribute("class")).toContain("stroke-action");
  });

  it("nothing on a page without boxes or without its size", () => {
    expect(render(<MarksOverlay marks={marks} page={3} />).container.innerHTML).toBe("");
  });
});
