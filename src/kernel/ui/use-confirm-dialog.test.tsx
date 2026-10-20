import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { useConfirmDialog } from "@/kernel/ui/use-confirm-dialog";

// Mock sonner toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

describe("useConfirmDialog", () => {
  test("starts closed with no loading", () => {
    const { result } = renderHook(() => useConfirmDialog());
    expect(result.current.dialogProps.open).toBe(false);
    expect(result.current.dialogProps.isLoading).toBe(false);
  });

  test("opens dialog when confirm is called", () => {
    const { result } = renderHook(() => useConfirmDialog());

    act(() => {
      result.current.confirm(async () => {}, {
        description: "Delete item?",
      });
    });

    expect(result.current.dialogProps.open).toBe(true);
    expect(result.current.dialogProps.description).toBe("Delete item?");
  });

  test("closes dialog on cancel (onOpenChange false)", () => {
    const { result } = renderHook(() => useConfirmDialog());

    act(() => {
      result.current.confirm(async () => {}, {
        description: "Delete item?",
      });
    });
    expect(result.current.dialogProps.open).toBe(true);

    act(() => {
      result.current.dialogProps.onOpenChange(false);
    });
    expect(result.current.dialogProps.open).toBe(false);
  });

  test("executes async action on confirm with loading state", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useConfirmDialog());

    act(() => {
      result.current.confirm(action, { description: "Delete?" });
    });

    await act(async () => {
      await (result.current.dialogProps.onConfirm() as unknown as Promise<void>);
    });

    expect(action).toHaveBeenCalledOnce();
    // After successful action, dialog should close
    expect(result.current.dialogProps.open).toBe(false);
    expect(result.current.dialogProps.isLoading).toBe(false);
  });

  test("shows error toast on action failure and keeps dialog open", async () => {
    const { toast } = await import("sonner");
    const action = vi.fn().mockRejectedValue(new Error("Delete failed"));
    const { result } = renderHook(() => useConfirmDialog());

    act(() => {
      result.current.confirm(action, { description: "Delete?" });
    });

    await act(async () => {
      await result.current.dialogProps.onConfirm();
    });

    expect(toast.error).toHaveBeenCalledWith("Delete failed");
    // Dialog stays open on error
    expect(result.current.dialogProps.open).toBe(true);
    expect(result.current.dialogProps.isLoading).toBe(false);
  });

  test("handles multiple sequential confirms", async () => {
    const action1 = vi.fn().mockResolvedValue(undefined);
    const action2 = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useConfirmDialog());

    // First confirm
    act(() => {
      result.current.confirm(action1, { description: "Delete first?" });
    });
    await act(async () => {
      await result.current.dialogProps.onConfirm();
    });
    expect(action1).toHaveBeenCalledOnce();
    expect(result.current.dialogProps.open).toBe(false);

    // Second confirm
    act(() => {
      result.current.confirm(action2, { description: "Delete second?" });
    });
    expect(result.current.dialogProps.description).toBe("Delete second?");
    await act(async () => {
      await result.current.dialogProps.onConfirm();
    });
    expect(action2).toHaveBeenCalledOnce();
    expect(result.current.dialogProps.open).toBe(false);
  });

  test("prevents closing while loading", async () => {
    let resolve: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const { result } = renderHook(() => useConfirmDialog());

    act(() => {
      result.current.confirm(action, { description: "Delete?" });
    });

    // Start the confirm (don't await yet)
    let confirmPromise: Promise<void> | undefined;
    act(() => {
      confirmPromise = result.current.dialogProps.onConfirm() as unknown as Promise<void>;
    });

    // While loading, try to close
    act(() => {
      result.current.dialogProps.onOpenChange(false);
    });
    // Should still be open because loading
    expect(result.current.dialogProps.open).toBe(true);

    // Resolve the action
    await act(async () => {
      resolve!();
      await confirmPromise!;
    });
    expect(result.current.dialogProps.open).toBe(false);
  });

  test("uses default description from options", () => {
    const { result } = renderHook(() => useConfirmDialog({ description: "Default desc" }));

    act(() => {
      result.current.confirm(async () => {});
    });

    expect(result.current.dialogProps.description).toBe("Default desc");
  });

  test("overrides description per-call", () => {
    const { result } = renderHook(() => useConfirmDialog({ description: "Default desc" }));

    act(() => {
      result.current.confirm(async () => {}, {
        description: "Custom desc",
      });
    });

    expect(result.current.dialogProps.description).toBe("Custom desc");
  });
});
