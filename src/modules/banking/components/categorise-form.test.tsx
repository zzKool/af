// Journal T002 (US2), on the row (F113): picking a partner on a row with no category proposes the partner's
// default category — saved with the partner in the categorise form — never overwriting a category already set.
// Base UI's Select is stubbed by a native <select> so the test drives the rule, not the widget.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/banking/banking.actions", () => ({
  categoriseTransactionAction: "categorise",
}));

const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn(async () => ({ data: { data: null } }));
    return { executeAsync: calls[action], isPending: false };
  },
}));

// the BAS picker (F125) as a native select too: the test drives the rule, not the widget
vi.mock("@/modules/settings/ui", () => ({
  BasPicker: ({
    id,
    value,
    onChange,
    options,
  }: {
    id?: string;
    value: string;
    onChange: (code: string) => void;
    options: { code: string; label: string }[];
  }) => (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

// a native select: SelectTrigger's id names it, SelectItem's are its options
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Ctx = React.createContext<{ id?: string; setId: (id: string) => void }>({
    setId: () => {},
  });
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string | null) => void;
    children: ReactNode;
  }) {
    const [id, setId] = React.useState<string | undefined>();
    const items: { value: string; label: ReactNode }[] = [];
    const walk = (node: ReactNode) =>
      React.Children.forEach(node, (c) => {
        if (!React.isValidElement(c)) return;
        const props = c.props as { value?: string; children?: ReactNode };
        if ((c.type as { displayName?: string }).displayName === "SelectItem")
          items.push({ value: props.value as string, label: props.children });
        else walk(props.children);
      });
    walk(children);
    return (
      <Ctx.Provider value={{ id, setId }}>
        {children}
        <select id={id} value={value} onChange={(e) => onValueChange(e.target.value)}>
          {items.map((i) => (
            <option key={i.value} value={i.value}>
              {i.label}
            </option>
          ))}
        </select>
      </Ctx.Provider>
    );
  }
  function SelectTrigger({ id }: { id?: string }) {
    const ctx = React.useContext(Ctx);
    React.useEffect(() => {
      if (id) ctx.setId(id);
    }, [id, ctx]);
    return null;
  }
  const SelectItem = () => null;
  SelectItem.displayName = "SelectItem";
  const Pass = ({ children }: { children?: ReactNode }) => <>{children}</>;
  return { Select, SelectTrigger, SelectItem, SelectContent: Pass, SelectValue: () => null };
});

import { CategoriseForm, type PartnerOption, proposedCategory } from "./categorise-form";

const OPENAI = "55555555-5555-4555-8555-555555555555";
const NORDEA = "66666666-6666-4666-8666-666666666666";
const partners: PartnerOption[] = [
  { id: OPENAI, name: "OpenAI", defaultBasCode: "654" },
  { id: NORDEA, name: "Nordea", defaultBasCode: null },
];
const categories = [
  { code: "654", label: "654 · Programvaror" },
  { code: "657", label: "657 · Bankkostnader" },
];
const entry = (basCode: string | null) => ({
  id: "77777777-7777-4777-8777-777777777777",
  basCode,
  partnerId: null,
  note: null,
  noDocumentNeeded: false,
  categorisedBy: null,
});

describe("the partner's default category (T002)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("proposedCategory: only when the row has none and the partner has one", () => {
    expect(proposedCategory(null, OPENAI, partners)).toBe("654");
    expect(proposedCategory("657", OPENAI, partners)).toBeNull();
    expect(proposedCategory(null, NORDEA, partners)).toBeNull();
    expect(proposedCategory(null, null, partners)).toBeNull();
  });

  it("categorise form: an uncategorised row saves the partner with its default category", async () => {
    render(
      <CategoriseForm entry={entry(null)} categories={categories} partners={partners} canWrite />,
    );
    fireEvent.change(screen.getByLabelText("Partner"), { target: { value: OPENAI } });
    await waitFor(() =>
      expect(calls.categorise).toHaveBeenCalledWith({
        id: entry(null).id,
        partnerId: OPENAI,
        basCode: "654",
      }),
    );
    expect(screen.getByLabelText("Category")).toHaveValue("654");
  });

  it("categorise form: a category already set is never overwritten — only the partner is saved", async () => {
    render(
      <CategoriseForm entry={entry("657")} categories={categories} partners={partners} canWrite />,
    );
    fireEvent.change(screen.getByLabelText("Partner"), { target: { value: OPENAI } });
    await waitFor(() =>
      expect(calls.categorise).toHaveBeenCalledWith({ id: entry(null).id, partnerId: OPENAI }),
    );
    expect(screen.getByLabelText("Category")).toHaveValue("657");
  });
});

describe("F98 — a HIGH proposal pre-filled (the owner's answer 2)", () => {
  afterEach(cleanup);
  beforeEach(() => {
    for (const k of Object.keys(calls)) delete calls[k];
  });

  it("the picker shows the proposal and says it is not saved — nothing is written by showing it", () => {
    render(
      <CategoriseForm
        entry={entry(null)}
        categories={categories}
        partners={partners}
        canWrite
        prefill={{ basCode: "654", partnerId: OPENAI }}
      />,
    );
    expect(screen.getByLabelText("Category")).toHaveValue("654");
    expect(screen.getByLabelText("Partner")).toHaveValue(OPENAI);
    expect(screen.getByTestId("prefill-hint")).toBeInTheDocument();
    expect(calls.categorise).not.toHaveBeenCalled();
  });

  it("a category already on the row wins over the proposal", () => {
    render(
      <CategoriseForm
        entry={entry("657")}
        categories={categories}
        partners={partners}
        canWrite
        prefill={{ basCode: "654" }}
      />,
    );
    expect(screen.getByLabelText("Category")).toHaveValue("657");
    expect(screen.queryByTestId("prefill-hint")).toBeNull();
  });

  it("picking another category saves that one, by hand", async () => {
    render(
      <CategoriseForm
        entry={entry(null)}
        categories={categories}
        partners={partners}
        canWrite
        prefill={{ basCode: "654" }}
      />,
    );
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "657" } });
    await waitFor(() =>
      expect(calls.categorise).toHaveBeenCalledWith({ id: entry(null).id, basCode: "657" }),
    );
  });
});
