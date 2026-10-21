import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { DuplicateMatch } from "@/modules/expenses/types";
import {
  DUPLICATE_CHECK_DEBOUNCE_MS,
  DuplicatePanel,
  duplicateHref,
  hasHighMatch,
  useDuplicateCheck,
} from "./duplicate-panel";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const high: DuplicateMatch = {
  kind: "exact",
  confidence: "high",
  entityType: "supplier_invoice",
  entityId: "si-1",
  entityKey: "SI213-Acc-01",
  partnerName: "Skattepunkten",
  reason: {
    key: "documents.duplicate.reason.exact",
    params: { n: "9160", partner: "Skattepunkten" },
  },
};
const medium: DuplicateMatch = {
  kind: "fuzzy",
  confidence: "medium",
  entityType: "expense",
  entityId: "e-1",
  entityKey: "Ex213-Tr-01",
  partnerName: null,
  reason: {
    key: "documents.duplicate.reason.fuzzyExpense",
    params: { key: "Ex213-Tr-01", amount: "600.00", currency: "CHF", date: "2026-03-10" },
  },
};

describe("DuplicatePanel (specs/documents US3)", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("a high match blocks: alert, the reason in words, the link, the required note", () => {
    const onAckNote = vi.fn();
    render(<DuplicatePanel matches={[high, medium]} ackNote="" onAckNote={onAckNote} />);
    const panel = screen.getByTestId("duplicate-panel");
    expect(panel).toHaveAttribute("data-confidence", "high");
    expect(panel).toHaveAttribute("role", "alert");
    expect(panel).toHaveTextContent("Invoice #9160 from Skattepunkten already exists");
    expect(panel).toHaveTextContent(
      "Similar expense exists: Ex213-Tr-01 for 600.00 CHF on 2026-03-10",
    );
    expect(screen.getByRole("link", { name: "Open SI213-Acc-01" })).toHaveAttribute(
      "href",
      "/supplier-invoices?open=si-1",
    );
    fireEvent.change(screen.getByTestId("duplicate-ack-note"), { target: { value: "reissue" } });
    expect(onAckNote).toHaveBeenCalledWith("reissue");
    expect(hasHighMatch([high, medium])).toBe(true);
  });

  it("a medium match only warns — no note field", () => {
    render(<DuplicatePanel matches={[medium]} ackNote="" onAckNote={() => {}} />);
    const panel = screen.getByTestId("duplicate-panel");
    expect(panel).toHaveAttribute("data-confidence", "medium");
    expect(panel).toHaveAttribute("role", "status");
    expect(screen.queryByTestId("duplicate-ack-note")).not.toBeInTheDocument();
    expect(hasHighMatch([medium])).toBe(false);
    expect(duplicateHref(medium)).toBe("/expenses?open=e-1");
  });

  it("nothing to show, nothing rendered", () => {
    const { container } = render(<DuplicatePanel matches={[]} ackNote="" onAckNote={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("the check runs once the key settles and clears when disabled", async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue([high]);
    const { result, rerender } = renderHook(
      ({ enabled, key }: { enabled: boolean; key: string }) =>
        useDuplicateCheck(enabled, key, check),
      { initialProps: { enabled: true, key: "a" } },
    );
    rerender({ enabled: true, key: "ab" }); // typing: the first timer is cancelled
    await act(async () => {
      vi.advanceTimersByTime(DUPLICATE_CHECK_DEBOUNCE_MS + 10);
    });
    expect(check).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual([high]);
    rerender({ enabled: false, key: "ab" });
    expect(result.current).toEqual([]);
  });
});
