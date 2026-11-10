// The boxes over a page (F141; F185 the board's boxes): one box per field on that page, placed in percent of the
// page from its polygon, the active one marked, a corrected field sure; nothing for another page or without the
// page's size. Invented marks (D51).
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
  it("the page's fields as boxes in percent of the page; sure in the reading colour, to check amber, the active one ringed", () => {
    const { container } = render(<MarksOverlay marks={marks} page={1} active="invoiceNumber" />);
    const boxes = [...container.querySelectorAll<HTMLElement>("[data-mark]")];
    expect(boxes.map((b) => b.getAttribute("data-mark"))).toEqual(["vendorName", "invoiceNumber"]);
    // x 1 in on 8.5 in, less a little air (0.6 % of the width) → ≈ 11.2 %
    expect(Number.parseFloat(boxes[0]?.style.left ?? "")).toBeCloseTo(
      ((1 - 8.5 * 0.006) / 8.5) * 100,
      3,
    );
    expect(boxes[0]?.getAttribute("data-sure")).toBe("true");
    expect(boxes[0]?.className).toContain("bg-read/6");
    expect(boxes[1]?.getAttribute("data-sure")).toBeNull();
    expect(boxes[1]?.getAttribute("data-active")).toBe("true");
    expect(boxes[1]?.className).toContain("bg-state-attention/16");
  });

  it("a field the owner corrected is sure, whatever DI said", () => {
    const { container } = render(
      <MarksOverlay marks={marks} page={1} corrected={["invoiceNumber"]} />,
    );
    expect(container.querySelector('[data-mark="invoiceNumber"]')?.getAttribute("data-sure")).toBe(
      "true",
    );
  });

  it("nothing on a page without boxes or without its size", () => {
    expect(render(<MarksOverlay marks={marks} page={3} />).container.innerHTML).toBe("");
  });
});
