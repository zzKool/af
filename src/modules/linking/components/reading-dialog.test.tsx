// The reading dialog (F131, review 2026-10-31 §6.3): the typed fields with their confidence glyphs, the partner card
// first and *Confirm & link* waiting for a partner (F129), the checks from `checkProof` — a warning line shown and
// handed to the action as confirmed — the group proposed from a covering trip else the month (§5.2), *Becomes*
// derived with its switch, Cancel writing nothing. Invented values (D51).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), message: vi.fn() }),
}));
vi.mock("@/modules/linking/linking.actions", () => ({
  counterpartyMemoryAction: "memory",
  justifyRowAction: "justify",
  proofFactsAction: "facts",
}));
vi.mock("@/modules/banking/ui", () => ({ createRuleFromTransactionAction: "rule" }));
vi.mock("@/modules/documents/ui", async () => ({
  ...(await import("@/modules/documents/components/field-confidence")),
  ...(await import("@/modules/documents/components/also-read-section")),
  ...(await import("@/modules/documents/components/read-fields")),
  ...(await import("@/modules/documents/components/accept-chain-view")),
  ...(await import("@/modules/documents/components/board-tag")),
  DocumentViewer: ({ active }: { active?: string | null }) => (
    <div data-testid="viewer" data-active={active ?? ""} />
  ),
}));
// the match card as a stub: it reports the matches the test set, offers *Use match* and the host's *New*
const matchState = vi.hoisted(() => ({
  matches: [] as { partnerId: string; name: string; percent: number }[],
}));
// the create form is the partners module's own (T023), its action a name the `useAction` stub records
vi.mock("@/modules/partners/partners.actions", () => ({ createPartnerAction: "createPartner" }));
vi.mock("@/modules/partners/ui", async () => ({
  MATCH_BEST_FROM: 60,
  PartnerCreateForm: (await import("@/modules/partners/components/partner-create-form"))
    .PartnerCreateForm,
  PartnerMatchCard: ({
    onUseMatch,
    onMatches,
    onNew,
    newLabel,
  }: {
    onUseMatch: (id: string) => void;
    onMatches?: (m: { partnerId: string; name: string; percent: number; score: number }[]) => void;
    onNew?: () => void;
    newLabel?: string;
  }) => {
    // biome-ignore lint/correctness/useHookAtTopLevel: a stub
    const React = require("react") as typeof import("react");
    const latest = React.useRef(onMatches);
    latest.current = onMatches;
    // like the real card: once, when the matches arrive
    // biome-ignore lint/correctness/useExhaustiveDependencies: once per mount, as the card's fetch
    React.useEffect(() => {
      latest.current?.(matchState.matches.map((m) => ({ ...m, score: m.percent })));
    }, []);
    return (
      <div data-testid="partner-match">
        <button
          type="button"
          data-testid="partner-match-use"
          onClick={() => onUseMatch(matchState.matches[0]?.partnerId ?? "p1")}
        >
          Use match
        </button>
        <button type="button" data-testid="partner-match-new" onClick={onNew}>
          {newLabel}
        </button>
      </div>
    );
  },
}));
const groupState = vi.hoisted(() => ({
  created: [] as { description: string; month: string | null }[],
}));
// the group picker as a native select (the dialog's proposal is under test, not Base UI's listbox)
vi.mock("@/modules/expenses/ui", async () => ({
  ...(await import("@/modules/expenses/group-proposal")),
  NEW_GROUP: "__new__",
  useCreateGroupIfNew: () => ({
    resolveGroupId: async (id: string, description: string, month?: string | null) => {
      if (id !== "__new__") return id;
      groupState.created.push({ description, month: month ?? null });
      return "created-group";
    },
    isPending: false,
  }),
  GroupPicker: ({
    groups,
    value,
    onChange,
    newDescription,
    onNewDescription,
  }: {
    groups: { id: string; description: string }[];
    value: string;
    onChange: (id: string) => void;
    newDescription: string;
    onNewDescription: (d: string) => void;
  }) => (
    <>
      <select
        data-testid="group-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Group"
      >
        <option value="">—</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.description}
          </option>
        ))}
        <option value="__new__">+ New group…</option>
      </select>
      {value === "__new__" && (
        <input
          data-testid="new-group-description"
          value={newDescription}
          onChange={(e) => onNewDescription(e.target.value)}
        />
      )}
    </>
  ),
}));

// the trip's fields with a native country select; the creation records its input (T020)
const tripState = vi.hoisted(() => ({ created: [] as { description: string; trip: unknown }[] }));
vi.mock("@/modules/traktamente/ui", async () => {
  const real = await import("@/modules/traktamente/components/new-trip-fields");
  return {
    newTripFor: real.newTripFor,
    newTripMissing: real.newTripMissing,
    useCreateTripGroup: () => ({
      createTrip: async (description: string, trip: unknown) => {
        tripState.created.push({ description, trip });
        return "created-trip";
      },
      isPending: false,
    }),
    NewTripFields: ({
      value,
      onChange,
    }: {
      value: { departureAt: string; returnAt: string; countryCode: string };
      onChange: (v: typeof value) => void;
    }) => (
      <>
        <input
          data-testid="new-trip-departure"
          value={value.departureAt}
          onChange={(e) => onChange({ ...value, departureAt: e.target.value })}
        />
        <input
          data-testid="new-trip-return"
          value={value.returnAt}
          onChange={(e) => onChange({ ...value, returnAt: e.target.value })}
        />
        <select
          data-testid="new-trip-country"
          aria-label="Country"
          value={value.countryCode}
          onChange={(e) => onChange({ ...value, countryCode: e.target.value })}
        >
          <option value="">—</option>
          <option value="CH">Switzerland</option>
        </select>
      </>
    ),
  };
});

const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn(async () => ({ data: { data: [] } }));
    return { executeAsync: calls[action], isPending: false };
  },
}));

import type { ProofFacts } from "../types";
import type { JustifyOptions } from "./justify-panel";
import { type ReadDocument, ReadingDialog } from "./reading-dialog";

const ROW = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const row = {
  id: ROW,
  bookingDate: "2026-07-08",
  amount: "-1297.20",
  currency: "SEK",
  amountBase: "-1297.20",
  description: "SKATTEPUNKTEN OFFICE",
  counterpartyKey: "SKATTEPUNKTEN OFFICE",
  bankAccountId: "acc",
  accountLabel: "Plusgirokonto SEK",
};
const options: JustifyOptions = {
  groups: [
    { id: "g1", label: "1 — Licences", number: 1, description: "Licences", kind: "batch" },
    {
      id: "trip",
      label: "213 — Switzerland, March 2026",
      number: 213,
      description: "Switzerland, March 2026",
      kind: "trip",
      departure: "2026-03-02",
      return: "2026-03-21",
    },
    {
      id: "july",
      label: "7 — 2026-07",
      number: 7,
      description: "2026-07",
      kind: "batch",
      month: "2026-07",
    },
  ],
  categories: [
    { code: "6540", label: "6540 · IT services (It)" },
    { code: "5010", label: "5010 · Rent (Lokal)" },
  ],
  partners: [
    {
      id: "p1",
      name: "Skattepunkten Office Services AB",
      defaultBasCode: "6540",
      types: ["vendor"],
      systemRole: null,
      vatNumber: "SE556677889901",
    },
    {
      id: "p2",
      name: "Northwind Cloud AB",
      defaultBasCode: "5010",
      types: ["vendor"],
      systemRole: null,
      vatNumber: "SE556000000001",
    },
  ],
};
const str = (value: string, confidence: number) => ({
  type: "string",
  value,
  confidence,
  content: value,
});
const document: ReadDocument = {
  fileUrl: "/api/documents/x/file",
  mimeType: "application/pdf",
  prefixType: "invoice",
  modelUsed: "prebuilt-invoice",
  fields: {
    VendorName: str("Skattepunkten Office Services AB", 0.98),
    VendorTaxId: str("SE556677889901", 0.65),
    InvoiceId: str("2026-071", 0.81),
    InvoiceDate: { type: "date", value: "2026-07-06", confidence: 0.95, content: "2026-07-06" },
    InvoiceTotal: {
      type: "currency",
      value: { amount: 1297.2, currencyCode: "SEK" },
      confidence: 0.99,
      content: "1 297,20 SEK",
    },
    PurchaseOrder: str("PO-7731", 0.64),
  },
};
const reading = {
  vendorName: "Skattepunkten Office Services AB",
  vendorTaxId: "SE556677889901",
  invoiceNumber: "2026-071",
  invoiceDate: "2026-07-06",
  invoiceTotal: 1297.2,
  totalTax: 259.44,
  currency: "SEK",
  customerName: "Dev AB",
};
const allGreen: ProofFacts = {
  fxRate: null,
  fxRateDate: null,
  billedToFits: true,
  companyName: "Dev AB",
  rulePartnerIds: [],
  memory: [],
  documentJustifiesOther: null,
  supplierNumberTaken: false,
};

function mount(
  over: Partial<Parameters<typeof ReadingDialog>[0]> = {},
  facts: ProofFacts = allGreen,
) {
  calls.facts = vi.fn(async () => ({ data: { data: facts } }));
  calls.memory ??= vi.fn(async () => ({ data: { data: [] } }));
  calls.justify = vi.fn(async () => ({
    data: {
      data: {
        entity: { type: "supplier_invoice", id: "si", key: "SI1-It-01" },
        row: { partnerId: "p1", basCode: "6540" },
        proposeRule: null,
      },
    },
  }));
  const onCancel = vi.fn();
  const onDone = vi.fn();
  render(
    <ReadingDialog
      row={row}
      documentId={DOC}
      document={document}
      reading={reading}
      note={null}
      paper="invoice"
      onPaper={vi.fn()}
      options={options}
      proposals={[]}
      onCancel={onCancel}
      onDone={onDone}
      {...over}
    />,
  );
  return { onCancel, onDone };
}

/** F186: a row of *What it read* — its confidence in its band's colour */
const bandOf = (fieldTestId: string) => {
  const cls =
    screen
      .getByTestId(fieldTestId)
      .closest("[data-testid=read-field]")
      ?.querySelector("[data-testid=read-field-confidence]")?.className ?? "";
  return cls.includes("text-read")
    ? "high"
    : cls.includes("text-state-attention")
      ? "medium"
      : cls.includes("text-destructive")
        ? "low"
        : null;
};

describe("ReadingDialog — the fields, the partner first, Confirm waits for a partner", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
    matchState.matches = [];
  });

  it("the typed fields pre-filled from the reading, a confidence glyph each from DI's own figure (F127)", async () => {
    mount();
    expect(screen.getByTestId("reading-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("reading-title")).toHaveTextContent(
      "Proof for 2026-07-08 · −1 297.20 SEK · SKATTEPUNKTEN OFFICE",
    );
    expect(screen.getByTestId("justify-vendor")).toHaveValue("Skattepunkten Office Services AB");
    expect(screen.getByTestId("justify-invoice-number")).toHaveValue("2026-071");
    expect(screen.getByTestId("justify-amount")).toHaveValue("1297.20");
    expect(screen.getByTestId("justify-vat")).toHaveValue("259.44");
    expect(screen.getByTestId("reading-net")).toHaveValue("1037.76");
    expect(screen.getByTestId("reading-billed-to")).toHaveTextContent("Billed to Dev AB");
    expect(bandOf("justify-vendor")).toBe("high");
    expect(bandOf("justify-invoice-number")).toBe("medium");
    expect(bandOf("justify-vat-number")).toBe("low");
    // Also read: the scalar DI returned and the mapper does not type
    expect(screen.getByText("Also read (1)")).toBeInTheDocument();
    // Becomes: an invoice number read → a supplier invoice; the switch flips it
    expect(screen.getByTestId("reading-becomes")).toHaveTextContent("supplier invoice");
    fireEvent.click(screen.getByTestId("reading-switch"));
    expect(screen.getByTestId("reading-becomes")).toHaveTextContent("expense");
    expect(screen.queryByTestId("justify-invoice-number")).not.toBeInTheDocument();
    expect(screen.getByTestId("reading-payer")).toHaveTextContent("Paid from Plusgirokonto SEK");
  });

  it("the chain: creates · links (the checks, its evidence) · files (the partner, open while it lacks); Accept waits for a partner (F129, F186)", async () => {
    mount();
    const partnerBlock = screen.getByTestId("reading-partner");
    const checks = screen.getByTestId("reading-checks");
    expect(within(screen.getByTestId("chain-links")).getByTestId("reading-checks")).toBe(checks);
    expect(within(screen.getByTestId("chain-files")).getByTestId("reading-partner")).toBe(
      partnerBlock,
    );
    expect(screen.getByTestId("chain-files")).toHaveAttribute("data-lacking", "true");
    expect(screen.getByTestId("chain-links")).toHaveTextContent("Bank row 2026-07-08 · −1 297.20 SEK");
    expect(screen.getByTestId("justify-create")).toHaveTextContent("Accept all three");
    expect(within(partnerBlock).getByTestId("partner-match")).toBeInTheDocument();
    expect(screen.getByTestId("justify-create")).toBeDisabled();
    expect(screen.getByTestId("justify-missing")).toHaveTextContent("Still needed: Partner");
    fireEvent.click(screen.getByTestId("partner-match-use"));
    await waitFor(() => expect(screen.getByTestId("justify-create")).toBeEnabled());
    expect(screen.queryByTestId("justify-missing")).not.toBeInTheDocument();
    // the partner's default category filled the empty one, named as such
    expect(screen.getByTestId("justify-category")).toHaveTextContent("6540");
    expect(screen.getByTestId("reading-category-hint")).toHaveTextContent(
      "proposed (partner default)",
    );
  });

  it("a match ≥ the threshold is pre-picked and named with its score; without one the memory's partner is *remembered*", async () => {
    matchState.matches = [
      { partnerId: "p1", name: "Skattepunkten Office Services AB", percent: 100 },
    ];
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("justify-partner-hint")).toHaveTextContent(
        "Skattepunkten Office Services AB — matched (100 %)",
      ),
    );
    expect(screen.getByTestId("justify-create")).toBeEnabled();
    cleanup();
    matchState.matches = [];
    calls.memory = vi.fn(async () => ({
      data: { data: [{ partnerId: "p2", name: "Northwind Cloud AB", count: 3 }] },
    }));
    mount();
    await waitFor(() =>
      expect(screen.getByTestId("justify-partner-hint")).toHaveTextContent(
        "Northwind Cloud AB — remembered (3 time(s))",
      ),
    );
  });

  it("*+ New partner from this invoice* opens the full form inline, pre-filled; the created partner is picked", async () => {
    calls.createPartner = vi.fn(async () => ({ data: { data: { id: "p9", name: "x" } } }));
    mount({
      reading: {
        ...reading,
        currency: "EUR",
        vendorAddress: {
          street: "Storgatan 1",
          city: "Stockholm",
          postalCode: "111 22",
          country: "SE",
        },
      },
    });
    fireEvent.click(screen.getByTestId("partner-match-new"));
    const form = screen.getByTestId("reading-new-partner");
    expect(form).toHaveTextContent("New partner from this invoice");
    expect(screen.getByTestId("reading-new-partner-name")).toHaveValue(
      "Skattepunkten Office Services AB",
    );
    expect(screen.getByTestId("reading-new-partner-vat")).toHaveValue("SE556677889901");
    expect(screen.getByTestId("reading-new-partner-short")).toHaveValue("");
    expect(form).toHaveTextContent("Type: vendor");
    fireEvent.click(screen.getByTestId("reading-new-partner-create"));
    await waitFor(() =>
      expect(calls.createPartner).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Skattepunkten Office Services AB",
          types: ["vendor"],
          vatNumber: "SE556677889901",
          defaultCurrency: "EUR",
          shortCode: "",
        }),
      ),
    );
    // the created partner is the pick: Partner is no longer missing (its category still is — no default)
    await waitFor(() =>
      expect(screen.queryByTestId("reading-new-partner")).not.toBeInTheDocument(),
    );
    expect(screen.getByTestId("justify-missing")).not.toHaveTextContent("Partner");
    expect(screen.getByTestId("justify-missing")).toHaveTextContent("Category");
    expect(screen.getByTestId("justify-partner")).toHaveTextContent(
      "Skattepunkten Office Services AB",
    );
  });
});

describe("ReadingDialog — the board's column pair (F186)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
    matchState.matches = [];
  });

  it("a field focused on the right is the box lit on the page; an ambiguous due date asks which, one click sets it", async () => {
    mount({
      reading: { ...reading, dueDate: "2026-08-07" },
      document: {
        ...document,
        fields: {
          ...document.fields,
          DueDate: { type: "date", value: "2026-08-07", confidence: 0.72, content: "07-08" },
        },
      },
    });
    fireEvent.focus(screen.getByTestId("justify-amount"));
    expect(screen.getByTestId("viewer")).toHaveAttribute("data-active", "invoiceTotal");
    const due = screen.getByTestId("justify-due").closest("[data-testid=read-field]") as HTMLElement;
    expect(within(due).getByTestId("read-field-ask")).toHaveTextContent("“07-08” — Aug 7 or Jul 8?");
    fireEvent.click(within(due).getByRole("button", { name: "2026-07-08" }));
    expect(screen.getByTestId("justify-due")).toHaveValue("2026-07-08");
    // a value the reading is not sure of but cannot doubt is just edited, no question in a form
    const number = screen
      .getByTestId("justify-invoice-number")
      .closest("[data-testid=read-field]") as HTMLElement;
    expect(within(number).queryByTestId("read-field-ask")).not.toBeInTheDocument();
  });
});

describe("ReadingDialog — the checks (F130) and the group (§5.2)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
    matchState.matches = [];
  });

  it("all green: ✓ amount equal · ✓ 2 days · ✓ vendor = counterparty; no warning handed to the action", async () => {
    mount();
    fireEvent.click(screen.getByTestId("partner-match-use"));
    await waitFor(() => expect(screen.getAllByTestId("reading-check-ok")).toHaveLength(3));
    const ok = screen.getAllByTestId("reading-check-ok").map((li) => li.textContent);
    expect(ok[0]).toContain("amount equal");
    expect(ok[1]).toContain("2 day(s)");
    expect(ok[2]).toContain("vendor = counterparty");
    expect(screen.queryByTestId("reading-check-warning")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("justify-create"));
    await waitFor(() => expect(calls.justify).toHaveBeenCalled());
    const sent = calls.justify.mock.calls[0][0];
    expect(sent.confirmedWarnings).toBeUndefined();
    expect(sent.kind).toBe("supplier_invoice");
    expect(sent.documentId).toBe(DOC);
    expect(sent.supplier).toEqual(
      expect.objectContaining({
        partnerId: "p1",
        invoiceNumber: "2026-071",
        invoiceDate: "2026-07-06",
        amountTotal: "1297.20",
        vatAmount: "259.44",
        amountNet: "1037.76",
        currency: "SEK",
        basCode: "6540",
        groupId: "july",
      }),
    );
  });

  it("a warning from checkProof is one line with its numbers, and the codes left standing go with Confirm & link", async () => {
    // the paper says Northwind, the bank SKATTEPUNKTEN; the amount is off by 7.20 — two warnings, the date green
    matchState.matches = [{ partnerId: "p2", name: "Northwind Cloud AB", percent: 100 }];
    mount({
      reading: {
        ...reading,
        vendorName: "Northwind Cloud AB",
        vendorTaxId: "SE559999999999",
        invoiceTotal: 1290,
      },
    });
    fireEvent.click(screen.getByTestId("partner-match-use")); // p2 — no VAT, memory, rule or name ties it to the bank's text
    await waitFor(() => expect(screen.getAllByTestId("reading-check-warning")).toHaveLength(2));
    const warnings = screen.getAllByTestId("reading-check-warning");
    expect(warnings[0]).toHaveAttribute("data-code", "vendor_counterparty");
    expect(warnings[0]).toHaveTextContent(
      "The paper names Northwind Cloud AB, the bank says SKATTEPUNKTEN OFFICE",
    );
    expect(warnings[1]).toHaveAttribute("data-code", "amount_same");
    expect(warnings[1]).toHaveTextContent(
      "Off by +7.20 SEK — the paper shows 1 290.00 SEK, the bank took 1 297.20 SEK",
    );
    expect(screen.getAllByTestId("reading-check-ok").map((li) => li.textContent?.trim())).toEqual([
      "✓2 day(s)",
    ]);
    expect(screen.getByTestId("justify-create")).toBeEnabled(); // warn, never block
    fireEvent.click(screen.getByTestId("justify-create"));
    await waitFor(() => expect(calls.justify).toHaveBeenCalled());
    expect(calls.justify.mock.calls[0][0].confirmedWarnings).toEqual([
      "vendor_counterparty",
      "amount_same",
    ]);
  });

  it("the server's facts feed the checks: billed to someone else, the number taken, an ECB rate across currencies", async () => {
    mount(
      {
        reading: {
          ...reading,
          currency: "EUR",
          invoiceTotal: 100,
          customerName: "Someone Else AB",
        },
      },
      {
        ...allGreen,
        billedToFits: false,
        supplierNumberTaken: true,
        fxRate: "11.42",
        fxRateDate: "2026-07-08",
      },
    );
    fireEvent.click(screen.getByTestId("partner-match-use"));
    await waitFor(() =>
      expect(screen.getAllByTestId("reading-check-warning").length).toBeGreaterThanOrEqual(3),
    );
    const codes = screen
      .getAllByTestId("reading-check-warning")
      .map((li) => li.getAttribute("data-code"));
    expect(codes).toEqual(["amount_fx", "billed_to", "already_proof"]);
    expect(screen.getByText(/100\.00 EUR at 11\.42 = 1 142\.00 SEK/)).toBeInTheDocument();
    expect(screen.getByText("Billed to Someone Else AB, not to Dev AB")).toBeInTheDocument();
    expect(screen.getByText(/Invoice number 2026-071 exists already/)).toBeInTheDocument();
  });

  it("the group: a trip whose days cover the paper's date, else the month's group, else empty with + New group on the month", async () => {
    // the reading is dated 2026-07-06 → no trip, the month group *2026-07*
    mount();
    expect(screen.getByTestId("group-select")).toHaveValue("july");
    expect(screen.getByTestId("reading-group-hint")).toHaveTextContent("proposed (the month)");
    // the date edited into the trip → the trip, as long as the owner did not pick a group himself
    fireEvent.change(screen.getByTestId("justify-date"), { target: { value: "2026-03-10" } });
    await waitFor(() => expect(screen.getByTestId("group-select")).toHaveValue("trip"));
    expect(screen.getByTestId("reading-group-hint")).toHaveTextContent("proposed (the trip)");
    // a date nothing covers: empty, the hint says so, Confirm waits; + New group starts from the month
    fireEvent.change(screen.getByTestId("justify-date"), { target: { value: "2026-09-02" } });
    await waitFor(() => expect(screen.getByTestId("group-select")).toHaveValue(""));
    expect(screen.getByTestId("reading-group-hint")).toHaveTextContent(
      "No trip covers 2026-09-02 and no group names 2026-09",
    );
    expect(screen.getByTestId("justify-missing")).toHaveTextContent("Group");
    fireEvent.change(screen.getByTestId("group-select"), { target: { value: "__new__" } });
    expect(screen.getByTestId("new-group-description")).toHaveValue("2026-09");
    fireEvent.click(screen.getByTestId("partner-match-use"));
    await waitFor(() => expect(screen.getByTestId("justify-create")).toBeEnabled());
    groupState.created = [];
    fireEvent.click(screen.getByTestId("justify-create"));
    await waitFor(() => expect(calls.justify).toHaveBeenCalled());
    expect(calls.justify.mock.calls[0][0].supplier.groupId).toBe("created-group");
    // the month's group carries the paper's month as a fact (T025) — the next paper of September finds it
    expect(groupState.created).toEqual([{ description: "2026-09", month: "2026-09" }]);
  });

  it("+ New group as a trip (T020): departure, return, country in place — the trip is created, the entity goes into it", async () => {
    tripState.created = [];
    mount();
    fireEvent.change(screen.getByTestId("group-select"), { target: { value: "__new__" } });
    // a month's group by default; the trip asks for its three facts
    expect(screen.getByTestId("reading-new-group-batch")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("new-trip-departure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("reading-new-group-trip"));
    // the paper's day at both ends, no country yet → Confirm names what the trip still needs
    expect(screen.getByTestId("new-trip-departure")).toHaveValue("2026-07-06T08:00");
    expect(screen.getByTestId("new-trip-return")).toHaveValue("2026-07-06T18:00");
    fireEvent.change(screen.getByTestId("new-group-description"), {
      target: { value: "Zurich, July 2026" },
    });
    fireEvent.click(screen.getByTestId("partner-match-use"));
    await waitFor(() =>
      expect(screen.getByTestId("justify-missing")).toHaveTextContent("the trip's country"),
    );
    expect(screen.getByTestId("justify-create")).toBeDisabled();
    fireEvent.change(screen.getByTestId("new-trip-country"), { target: { value: "CH" } });
    fireEvent.change(screen.getByTestId("new-trip-return"), {
      target: { value: "2026-07-09T19:30" },
    });
    await waitFor(() => expect(screen.getByTestId("justify-create")).toBeEnabled());
    fireEvent.click(screen.getByTestId("justify-create"));
    await waitFor(() => expect(calls.justify).toHaveBeenCalled());
    expect(tripState.created).toEqual([
      {
        description: "Zurich, July 2026",
        trip: {
          departureAt: "2026-07-06T08:00",
          returnAt: "2026-07-09T19:30",
          countryCode: "CH",
        },
      },
    ]);
    expect(calls.justify.mock.calls[0][0].supplier.groupId).toBe("created-trip");
  });

  it("+ New group as a trip (T020): departure, return, country in place — the trip is created, the entity goes into it", async () => {
    tripState.created = [];
    mount();
    fireEvent.change(screen.getByTestId("group-select"), { target: { value: "__new__" } });
    // a month's group by default; the trip asks for its three facts
    expect(screen.getByTestId("reading-new-group-batch")).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("new-trip-departure")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("reading-new-group-trip"));
    // the paper's day at both ends, no country yet → Confirm names what the trip still needs
    expect(screen.getByTestId("new-trip-departure")).toHaveValue("2026-07-06T08:00");
    expect(screen.getByTestId("new-trip-return")).toHaveValue("2026-07-06T18:00");
    fireEvent.change(screen.getByTestId("new-group-description"), {
      target: { value: "Zurich, July 2026" },
    });
    fireEvent.click(screen.getByTestId("partner-match-use"));
    await waitFor(() =>
      expect(screen.getByTestId("justify-missing")).toHaveTextContent("the trip's country"),
    );
    expect(screen.getByTestId("justify-create")).toBeDisabled();
    fireEvent.change(screen.getByTestId("new-trip-country"), { target: { value: "CH" } });
    fireEvent.change(screen.getByTestId("new-trip-return"), {
      target: { value: "2026-07-09T19:30" },
    });
    await waitFor(() => expect(screen.getByTestId("justify-create")).toBeEnabled());
    fireEvent.click(screen.getByTestId("justify-create"));
    await waitFor(() => expect(calls.justify).toHaveBeenCalled());
    expect(tripState.created).toEqual([
      {
        description: "Zurich, July 2026",
        trip: {
          departureAt: "2026-07-06T08:00",
          returnAt: "2026-07-09T19:30",
          countryCode: "CH",
        },
      },
    ]);
    expect(calls.justify.mock.calls[0][0].supplier.groupId).toBe("created-trip");
  });

  it("Cancel closes without writing; a receipt lost opens without a preview, the facts typed", async () => {
    const { onCancel } = mount();
    fireEvent.click(screen.getByTestId("justify-cancel"));
    expect(onCancel).toHaveBeenCalled();
    expect(calls.justify).not.toHaveBeenCalled();
    cleanup();
    mount({ documentId: null, document: null, reading: {} });
    expect(screen.getByTestId("reading-title")).toHaveTextContent("Receipt lost");
    expect(screen.getByTestId("reading-no-document")).toBeInTheDocument();
    expect(screen.queryByTestId("viewer")).not.toBeInTheDocument();
    expect(screen.getByTestId("reading-paper-invoice")).toBeDisabled();
    expect(screen.getByTestId("justify-amount")).toHaveValue("1297.20"); // the row's
  });
});
