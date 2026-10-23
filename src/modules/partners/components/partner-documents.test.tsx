import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { type PartnerDocument, PartnerDocuments } from "./partner-documents";

afterEach(cleanup);

const doc = (id: string, documentState: PartnerDocument["documentState"]): PartnerDocument => ({
  id,
  businessKey: `D-${id}`,
  fileName: `${id}.pdf`,
  documentType: "financial",
  status: "processed",
  documentState,
});

describe("PartnerDocuments (partners T011)", () => {
  it("shows each document's derived state, as the documents module gives it", () => {
    render(<PartnerDocuments documents={[doc("a", "ready"), doc("b", "filed")]} />);
    const a = screen.getByTestId("partner-document-state-a");
    const b = screen.getByTestId("partner-document-state-b");
    expect(a).toHaveAttribute("data-document-state", "ready");
    expect(a).toHaveTextContent("Ready");
    expect(b).toHaveAttribute("data-document-state", "filed");
    expect(b).toHaveTextContent("Filed");
  });
});
