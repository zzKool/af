import { cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const executeAsync = vi.fn();
vi.mock("next-safe-action/hooks", () => ({
  useAction: () => ({ executeAsync, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/modules/expenses/expenses.actions", () => ({ createExpenseGroupAction: vi.fn() }));

import { toast } from "sonner";
import { GroupPicker, initialGroupId, NEW_GROUP, useCreateGroupIfNew } from "./group-picker";

const groups = [{ id: "g1", number: 7, description: "Receipts", kind: "batch" as const }];

describe("GroupPicker — an existing group or a new one typed inline", () => {
  afterEach(cleanup);
  beforeEach(() => vi.clearAllMocks());

  it("opens on the given group, else the first, else a new one", () => {
    expect(initialGroupId(groups, "g9")).toBe("g9");
    expect(initialGroupId(groups)).toBe("g1");
    expect(initialGroupId([])).toBe(NEW_GROUP);
  });

  it("asks for the description only when a new group is picked", () => {
    const props = {
      idPrefix: "x",
      label: "Group",
      groups,
      onChange: () => {},
      newDescription: "",
      onNewDescription: vi.fn(),
    };
    const { rerender } = render(<GroupPicker {...props} value="g1" />);
    expect(screen.queryByTestId("new-group-description")).toBeNull();
    rerender(<GroupPicker {...props} value={NEW_GROUP} />);
    fireEvent.change(screen.getByTestId("new-group-description"), {
      target: { value: "Admin 2026" },
    });
    expect(props.onNewDescription).toHaveBeenCalledWith("Admin 2026");
  });

  it("on submit: an existing group as is, a new one created from the trimmed description", async () => {
    const { result } = renderHook(() => useCreateGroupIfNew());
    expect(await result.current.resolveGroupId("g1", "ignored")).toBe("g1");
    expect(executeAsync).not.toHaveBeenCalled();

    executeAsync.mockResolvedValueOnce({ data: { data: { id: "g2" } } });
    expect(await result.current.resolveGroupId(NEW_GROUP, "  Admin 2026 ")).toBe("g2");
    expect(executeAsync).toHaveBeenCalledWith({ description: "Admin 2026" });
  });

  it("a failed creation stops the submit with the error shown", async () => {
    executeAsync.mockResolvedValueOnce({ data: { error: { message: "Description required" } } });
    const { result } = renderHook(() => useCreateGroupIfNew());
    expect(await result.current.resolveGroupId(NEW_GROUP, "")).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Description required");
  });
});
