// Reconcile's page (F139): the queue in its groups with *Accept N*, the stage of the row in focus — the lines, the
// partner and category sure / proposed / asked, the FX block, *when you accept* — Accept sending only the fields
// the owner confirmed, Accept disabled until a partner is known, J moving, Ctrl Z undoing today's last link.
// Invented rows (D51).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: { children: React.ReactNode; href: string } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/linking/linking.actions", () => ({
  acceptMatchAction: "accept",
  bulkApplyHighAction: "bulk",
  removeLinkAction: "remove",
}));
vi.mock("@/modules/banking/ui", () => ({
  TransactionDetailView: ({ transactionId }: { transactionId: string }) => (
    <div data-testid="detail-view" data-id={transactionId} />
  ),
}));
vi.mock("@/modules/settings/ui", () => ({
  BasPicker: ({ value, "data-testid": testId }: { value: string; "data-testid"?: string }) => (
    <div data-testid={testId} data-value={value} />
  ),
}));
const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn(async () => ({
      data: { data: { applied: [], skipped: [], failed: [] } },
    }));
    return { executeAsync: calls[action], isPending: false };
  },
}));

import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import type { ReconcileData, ReconcileRow } from "../reconcile-pure";
import type { Suggestion } from "../types";
import { ReconcilePage } from "./reconcile-page";

afterEach(() => {
  cleanup();
  for (const k of Object.keys(calls)) calls[k]?.mockClear();
});

const suggestion = (
  over: Partial<Suggestion["candidate"]>,
  confidence: Suggestion["confidence"] = "HIGH",
): Suggestion => ({
  score: 100,
  confidence,
  reasons: ["Partner name match", "Very close amount match"],
  reference: false,
  crossCurrency: true,
  allocation: null,
  candidate: {
    type: "document",
    id: "doc-1",
    label: "Receipt 2604-1187",
    amount: "10.00",
    currency: "USD",
    amountBase: null,
    date: "2026-07-14",
    reference: null,
    partnerName: null,
    texts: [],
    partnerId: null,
    basCode: null,
    ...over,
  } as Suggestion["candidate"],
});

function row(
  id: string,
  group: ReconcileRow["group"],
  over: {
    top?: Suggestion | null;
    list?: Record<string, unknown>;
    remembered?: string | null;
    fx?: ReconcileRow["fx"];
  } = {},
): ReconcileRow {
  const top = over.top === undefined ? suggestion({}) : over.top;
  const list = {
    bookingDate: "2026-07-15",
    description: "Kortköp 260714 INVENTED TOOLS",
    counterpartyKey: "INVENTED TOOLS",
    partnerId: null,
    partnerName: null,
    partnerFrom: null,
    basCode: null,
    basLabel: null,
    basFrom: null,
    proposedBasCode: null,
    proposedSource: null,
    proposedConfidence: null,
    ...over.list,
  };
  return {
    id,
    group,
    inbox: {
      row: { id, amount: "99.31", currency: "SEK", direction: "outgoing" },
      accountLabel: "Main SEK",
      state: "open",
      basCode: null,
      basLabel: null,
      top,
      suggestions: top ? [top] : [],
      list,
      rememberedPartnerId: over.remembered ?? null,
    } as unknown as ReconcileRow["inbox"],
    partner: { state: "ask", value: null, label: null, from: null, confidence: null },
    category: { state: "ask", value: null, label: null, from: null, confidence: null },
    twins: [],
    fx: over.fx ?? null,
  };
}

const partners = [
  { id: "p-tools", name: "Invented Tools", defaultBasCode: null },
  { id: "p-client", name: "Invented Client", defaultBasCode: null },
];
const categories = [{ code: "654", label: "654 · IT services" }];

function view(rows: ReconcileRow[], done: ReconcileData["done"] = []) {
  const data: ReconcileData = {
    month: "2026-07",
    previous: "2026-06",
    next: null,
    progress: { justified: 35, toJustify: rows.length },
    rows,
    done,
  };
  render(
    <LocaleProvider initialLocale="en">
      <ReconcilePage
        data={data}
        partners={partners}
        categories={categories}
        justifyOptions={null}
        canWrite
        initialRowId={null}
      />
    </LocaleProvider>,
  );
}

describe("ReconcilePage", () => {
  it("the queue in its groups, Ready first with Accept N; Accept N sends the ready rows", async () => {
    view([
      row("who", "who", { top: null }),
      row("ready", "ready", {
        top: suggestion({ type: "invoice", partnerId: "p-client", partnerName: "Invented Client" }),
      }),
    ]);
    const groups = screen
      .getAllByTestId("reconcile-group")
      .map((g) => g.getAttribute("data-group"));
    expect(groups).toEqual(["ready", "who"]);
    fireEvent.click(screen.getByTestId("reconcile-accept-all"));
    await waitFor(() => expect(calls.bulk).toHaveBeenCalledWith({ bankTransactionIds: ["ready"] }));
  });

  it("the stage: the partner proposed by memory, the category asked, the FX block, the preview; Accept sends what the owner confirmed", async () => {
    view([
      row("r1", "check", {
        remembered: "p-tools",
        fx: {
          original: "10.00",
          originalCurrency: "USD",
          rowCurrency: "SEK",
          ecbRate: "9.410000",
          rateDate: "2026-07-14",
          ecbAmount: "94.10",
          charged: "99.31",
          bankRate: "9.931000",
          cost: "5.21",
          costPercent: "5.5",
        },
      }),
    ]);
    const stage = screen.getByTestId("reconcile-match");
    expect(within(stage).getByTestId("reconcile-lines").textContent).toContain("amount");
    expect(within(stage).getByTestId("reconcile-partner").textContent).toContain("Invented Tools");
    expect(within(stage).getByTestId("reconcile-partner").textContent).toContain(
      "remembered — check it",
    );
    expect(within(stage).getByTestId("reconcile-category").textContent).toContain(
      "Pick the category",
    );
    expect(within(stage).getByTestId("reconcile-fx").textContent).toContain("5.5 %");
    const preview = within(stage).getByTestId("reconcile-preview").textContent;
    expect(preview).toContain("The row is linked to Receipt 2604-1187");
    expect(preview).toContain("Partner: Invented Tools");
    expect(preview).toContain("36 of 36 done in July 2026");

    fireEvent.click(screen.getByTestId("reconcile-accept"));
    await waitFor(() =>
      expect(calls.accept).toHaveBeenCalledWith({
        bankTransactionId: "r1",
        to: { type: "document", id: "doc-1" },
        partnerId: "p-tools",
      }),
    );
  });

  it("a partner the candidate carries is a fact, not sent; nothing known: Accept waits for a partner", () => {
    view([
      row("sure", "ready", {
        top: suggestion({ type: "invoice", partnerId: "p-client", partnerName: "Invented Client" }),
      }),
      row("unknown", "check"),
    ]);
    expect(screen.getByTestId("reconcile-partner-value")).toHaveAttribute("data-state", "sure");
    fireEvent.keyDown(window, { key: "j" });
    expect(screen.getByTestId("reconcile-match")).toHaveAttribute("data-row-id", "unknown");
    expect(screen.getByTestId("reconcile-accept")).toBeDisabled();
    expect(screen.getByTestId("reconcile-preview").textContent).toContain("Pick the partner first");
  });

  it("no candidate: the row's own panel; twins say so; Ctrl Z undoes today's last link", async () => {
    const a = row("a", "who", { top: null });
    const b = row("b", "who", { top: null });
    a.twins = ["b"];
    b.twins = ["a"];
    view(
      [a, b],
      [
        {
          linkId: "l-last",
          bankTransactionId: "x",
          rowLabel: "INVENTED CAFE",
          targetLabel: "Receipt 9",
          amount: null,
          currency: null,
          at: "2026-07-20T10:00:00Z",
        },
      ],
    );
    expect(screen.getByTestId("detail-view")).toHaveAttribute("data-id", "a");
    expect(screen.getByTestId("reconcile-twin")).toBeVisible();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(calls.remove).toHaveBeenCalledWith({ id: "l-last" }));
  });
});
