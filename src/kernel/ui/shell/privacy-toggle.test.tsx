import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import "@testing-library/jest-dom/vitest";
import { PrivacyToggle } from "./privacy-toggle";

// F150: the eye veils the figures for a screenshot — the attribute on <html> (globals.css blurs) and a cookie
// the root layout reads, so the next page is veiled before React runs; a second click shows them again.
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.privacy;
  // biome-ignore lint/suspicious/noDocumentCookie: the test clears what the toggle wrote
  document.cookie = "af-privacy=; path=/; max-age=0";
});

describe("PrivacyToggle (F150)", () => {
  it("veils, remembers, unveils", () => {
    render(<PrivacyToggle />);
    const eye = screen.getByTestId("privacy-toggle");
    expect(eye).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(eye);
    expect(document.documentElement.dataset.privacy).toBe("on");
    expect(document.cookie).toContain("af-privacy=on");
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(eye).toHaveAccessibleName("Show the figures");
    fireEvent.click(eye);
    expect(document.documentElement.dataset.privacy).toBeUndefined();
    expect(document.cookie).not.toContain("af-privacy=on");
  });
});
