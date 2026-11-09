import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { DateInput, isIsoDate } from "./date-input";

afterEach(cleanup);

const changed = vi.fn();
function Host() {
  const [v, setV] = useState("2026-11-09");
  return (
    <DateInput
      value={v}
      onChange={(e) => {
        changed(e.target.value);
        setV(e.target.value);
      }}
      data-testid="d"
    />
  );
}

describe("isIsoDate", () => {
  it("a real day only", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2024-02-29")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("11/09/2026")).toBe(false);
    expect(isIsoDate("2026-1-5")).toBe(false);
  });
});

describe("DateInput — yyyy-mm-dd in every language", () => {
  it("shows the value as typed in the rule, never the browser's format", () => {
    render(<DateInput value="2026-11-09" onChange={() => {}} data-testid="d" />);
    expect(screen.getByTestId("d")).toHaveValue("2026-11-09");
  });

  it("hands out a complete date or an empty field only; a blur on half a date puts the last one back", () => {
    render(<Host />);
    const input = screen.getByTestId("d");
    fireEvent.change(input, { target: { value: "2026-12" } });
    expect(input).toHaveValue("2026-12");
    expect(changed).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "2026-12-24" } });
    expect(changed).toHaveBeenLastCalledWith("2026-12-24");
    fireEvent.change(input, { target: { value: "2026-12-3" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("2026-12-24");
    fireEvent.change(input, { target: { value: "" } });
    expect(changed).toHaveBeenLastCalledWith("");
  });

  it("follows a value changed from outside", () => {
    const { rerender } = render(
      <DateInput value="2026-01-01" onChange={() => {}} data-testid="d" />,
    );
    rerender(<DateInput value="2026-03-15" onChange={() => {}} data-testid="d" />);
    expect(screen.getByTestId("d")).toHaveValue("2026-03-15");
  });
});
