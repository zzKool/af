import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ConfirmDialog } from "./confirm-dialog";

describe("ConfirmDialog", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    description: "Delete this item? This cannot be undone.",
    onConfirm: vi.fn(),
  };

  test("renders title, description, and default button labels", () => {
    render(<ConfirmDialog {...defaultProps} />);

    expect(screen.getByText("Are you sure?")).toBeDefined();
    expect(screen.getByText("Delete this item? This cannot be undone.")).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Delete" })).toBeDefined();
  });

  test("renders custom title and button labels", () => {
    render(
      <ConfirmDialog
        {...defaultProps}
        title="Confirm removal"
        confirmLabel="Remove"
        cancelLabel="Keep"
      />,
    );

    expect(screen.getByText("Confirm removal")).toBeDefined();
    expect(screen.getByRole("button", { name: "Remove" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Keep" })).toBeDefined();
  });

  test("calls onConfirm when confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...defaultProps} onConfirm={onConfirm} />);

    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  test("disables both buttons when isLoading is true", () => {
    render(<ConfirmDialog {...defaultProps} isLoading={true} />);

    const cancelBtn = screen.getByRole("button", { name: /Cancel/ });
    const confirmBtn = screen.getByRole("button", { name: /Delete/ });
    expect(
      cancelBtn.hasAttribute("disabled") || cancelBtn.getAttribute("aria-disabled") === "true",
    ).toBe(true);
    expect(
      confirmBtn.hasAttribute("disabled") || confirmBtn.getAttribute("aria-disabled") === "true",
    ).toBe(true);
  });

  test("confirm button text changes when isLoading vs not", () => {
    const { rerender } = render(<ConfirmDialog {...defaultProps} isLoading={false} />);
    const btn = screen.getByRole("button", { name: "Delete" });
    // Not loading: just the label text
    expect(btn.childNodes.length).toBe(1);

    rerender(<ConfirmDialog {...defaultProps} isLoading={true} />);
    const btnLoading = screen.getByRole("button", { name: /Delete/ });
    // Loading: spinner SVG + label text
    expect(btnLoading.childNodes.length).toBe(2);
  });

  test("Cancel button appears before confirm button in DOM (focus order)", () => {
    render(<ConfirmDialog {...defaultProps} />);

    const buttons = screen.getAllByRole("button");
    const cancelIdx = buttons.findIndex((b) => b.textContent?.includes("Cancel"));
    const confirmIdx = buttons.findIndex((b) => b.textContent?.includes("Delete"));
    expect(cancelIdx).toBeLessThan(confirmIdx);
  });
});
