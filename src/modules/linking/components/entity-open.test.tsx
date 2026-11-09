import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { EntityOpen } from "./entity-open";

vi.mock("@/modules/documents/ui", () => ({
  DocumentViewer: ({ mimeType }: { mimeType: string }) => (
    <div data-testid="viewer">{mimeType}</div>
  ),
}));

// The owner, 2026-11-09: a linked or suggested document opens from the row — a preview of the file itself, its
// page and its download one click away; anything else opens its own page in a new tab. Invented ids and labels.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ID = "00000000-0000-4000-8000-000000000001";

describe("EntityOpen", () => {
  it("a document: View opens the file in a preview, with its page and the download", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "application/pdf" }),
      blob: async () => ({ type: "application/pdf" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => {};
    render(<EntityOpen type="document" id={ID} label="Receipt Café Exemple" />);
    expect(screen.queryByTestId("document-preview")).toBeNull();
    fireEvent.click(screen.getByTestId("document-preview-open"));
    expect(await screen.findByTestId("viewer")).toHaveTextContent("application/pdf");
    expect(fetchMock).toHaveBeenCalledWith(`/api/documents/${ID}/file`);
    expect(screen.getByRole("link", { name: "Open the document's page" })).toHaveAttribute(
      "href",
      `/documents/${ID}`,
    );
    expect(screen.getByRole("link", { name: "Download" })).toHaveAttribute(
      "href",
      `/api/documents/${ID}/file?download=1`,
    );
  });

  it("an invoice: its page in a new tab", () => {
    render(<EntityOpen type="invoice" id={ID} label="EX26-INV-001" />);
    const link = screen.getByTestId("entity-open");
    expect(link).toHaveAttribute("href", `/invoices/${ID}`);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAccessibleName("Open EX26-INV-001 in a new tab");
  });
});
