// US7 (F183): the match where the row or the receipt already is — the banking panel's line and the documents'
// *From subscription …* button read the matches, and a click opens the period's confirm with the row / the document
// picked (never a write of its own). Invented values.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import type { SubscriptionMatch } from "../types";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
const matches = vi.fn();
vi.mock("../subscriptions.actions", () => ({ subscriptionMatchesAction: "matches" }));
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ executeAsync: matches, isPending: false }),
}));
// the confirm is its own component: here, what it is opened with
vi.mock("./confirm-period-dialog", () => ({
  ConfirmPeriodDialog: ({ target }: { target: unknown }) =>
    target ? <div data-testid="confirm-target">{JSON.stringify(target)}</div> : null,
}));

import {
  FromSubscriptionButtons,
  SubscriptionRowMatch,
  useSubscriptionMatches,
} from "./subscription-match";

const ROW = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const match = (o: Partial<SubscriptionMatch> = {}): SubscriptionMatch => ({
  subscriptionId: "s1",
  name: "Byteform",
  becomes: "expense",
  cadence: "monthly",
  periodDate: "2026-10-15",
  period: "2026-10",
  state: "due",
  entityKey: null,
  sure: true,
  ambiguous: false,
  diffPct: "0.00",
  ...o,
});

function Probe({ enabled }: { enabled: boolean }) {
  const m = useSubscriptionMatches({ documentId: DOC }, { enabled });
  return <span data-testid="count">{m.length}</span>;
}

afterEach(() => {
  cleanup();
  matches.mockReset();
});

describe("SubscriptionRowMatch (banking panel, linking inbox)", () => {
  it("reads the row's matches and shows Subscription X · period — Create & link opens the confirm with the row", async () => {
    matches.mockResolvedValue({ data: { data: [match()] } });
    render(<SubscriptionRowMatch bankTransactionId={ROW} canWrite />);
    expect(await screen.findByTestId("subscription-match-label")).toHaveTextContent(
      "Subscription Byteform · 2026-10",
    );
    expect(matches).toHaveBeenCalledWith({ bankTransactionId: ROW });
    expect(screen.getByText(/exact/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open subscription" })).toHaveAttribute(
      "href",
      "/subscriptions?open=s1",
    );
    fireEvent.click(screen.getByTestId("subscription-match-confirm"));
    expect(screen.getByTestId("subscription-match-confirm")).toHaveTextContent("Create & link");
    expect(JSON.parse(screen.getByTestId("confirm-target").textContent ?? "")).toEqual({
      subscriptionId: "s1",
      periodDate: "2026-10-15",
      bankTransactionId: ROW,
    });
  });

  it("a period with its entity says Complete {key}; off-price and ambiguous are said", async () => {
    matches.mockResolvedValue({
      data: {
        data: [match({ entityKey: "Ex217-IT-01", sure: false, diffPct: "3.02", ambiguous: true })],
      },
    });
    render(<SubscriptionRowMatch bankTransactionId={ROW} canWrite />);
    expect(await screen.findByTestId("subscription-match-confirm")).toHaveTextContent(
      "Complete Ex217-IT-01",
    );
    expect(screen.getByText(/3\.02 % off · also offered elsewhere/)).toBeInTheDocument();
  });

  it("nothing when no period matches; no button for a reader", async () => {
    matches.mockResolvedValue({ data: { data: [] } });
    const { container } = render(<SubscriptionRowMatch bankTransactionId={ROW} canWrite />);
    await vi.waitFor(() => expect(matches).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
    cleanup();
    matches.mockResolvedValue({ data: { data: [match()] } });
    render(<SubscriptionRowMatch bankTransactionId={ROW} canWrite={false} />);
    expect(await screen.findByTestId("subscription-match-label")).toBeInTheDocument();
    expect(screen.queryByTestId("subscription-match-confirm")).not.toBeInTheDocument();
  });
});

describe("FromSubscriptionButtons (review page, documents inbox)", () => {
  it("one button per period — the first takes the host's variant — opening the confirm with the document", () => {
    render(
      <FromSubscriptionButtons
        documentId={DOC}
        matches={[match(), match({ subscriptionId: "s2", name: "Tabula", period: "2026" })]}
      />,
    );
    const [first, second] = screen.getAllByTestId("make-it-from-subscription");
    expect(first).toHaveTextContent("From subscription Byteform (2026-10)");
    expect(first).toHaveClass("bg-action");
    expect(second).toHaveTextContent("From subscription Tabula (2026)");
    expect(second).not.toHaveClass("bg-action");
    fireEvent.click(second as HTMLElement);
    expect(JSON.parse(screen.getByTestId("confirm-target").textContent ?? "")).toEqual({
      subscriptionId: "s2",
      periodDate: "2026-10-15",
      documentId: DOC,
    });
  });

  it("the hook asks for the document, and not at all when disabled", async () => {
    matches.mockResolvedValue({ data: { data: [match()] } });
    render(<Probe enabled={false} />);
    expect(screen.getByTestId("count")).toHaveTextContent("0");
    expect(matches).not.toHaveBeenCalled();
    cleanup();
    render(<Probe enabled />);
    await vi.waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(matches).toHaveBeenCalledWith({ documentId: DOC });
  });
});
