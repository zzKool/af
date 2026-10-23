// T002 (US2): picking a partner on an entry with no category proposes the partner's default category — saved with
// the partner in the categorise form, filled (and still changeable) in the *New entry* dialog — never overwriting a
// category already set. Base UI's Select is stubbed by a native <select> so the test drives the rule, not the widget.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/journal/journal.actions", () => ({
  categoriseEntryAction: "categorise",
  createManualEntryAction: "create",
}));

const calls: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => {
    calls[action] ??= vi.fn(async () => ({ data: { data: null } }));
    return { executeAsync: calls[action], isPending: false };
  },
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
import { ManualEntryDialog } from "./manual-entry-dialog";

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

  it("proposedCategory: only when the entry has none and the partner has one", () => {
    expect(proposedCategory(null, OPENAI, partners)).toBe("654");
    expect(proposedCategory("657", OPENAI, partners)).toBeNull();
    expect(proposedCategory(null, NORDEA, partners)).toBeNull();
    expect(proposedCategory(null, null, partners)).toBeNull();
  });

  it("categorise form: an uncategorised entry saves the partner with its default category", async () => {
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

  it("New entry: the partner fills an empty category; the owner's change before saving is what is sent", async () => {
    render(
      <ManualEntryDialog
        open
        onOpenChange={() => {}}
        today="2026-03-02"
        categories={categories}
        partners={partners}
      />,
    );
    fireEvent.change(screen.getByLabelText("Partner"), { target: { value: OPENAI } });
    expect(screen.getByLabelText("Category")).toHaveValue("654");
    fireEvent.change(screen.getByLabelText("Category"), { target: { value: "657" } });
    // picking the partner again does not overwrite the owner's choice
    fireEvent.change(screen.getByLabelText("Partner"), { target: { value: NORDEA } });
    fireEvent.change(screen.getByLabelText("Partner"), { target: { value: OPENAI } });
    expect(screen.getByLabelText("Category")).toHaveValue("657");
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Licence" } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: "-120.00" } });
    fireEvent.click(screen.getByTestId("manual-entry-create"));
    await waitFor(() =>
      expect(calls.create).toHaveBeenCalledWith(
        expect.objectContaining({ partnerId: OPENAI, basCode: "657", amount: "-120.00" }),
      ),
    );
  });
});
