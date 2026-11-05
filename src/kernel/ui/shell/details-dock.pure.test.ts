import { describe, expect, it } from "vitest";
import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  MIN_PANEL_WIDTH,
  resolvePanelWidth,
} from "./details-dock";

// The work surface's width arithmetic (F131, the review §6.2 / O1): the page's default — px or a fraction of
// the canvas — then the remembered width wins; never under 340 px, never over 75 % of the canvas.
describe("clampPanelWidth", () => {
  it("holds the panel between 340 px and three quarters of the canvas", () => {
    expect(clampPanelWidth(100, 1200)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(687.6, 1200)).toBe(688);
    expect(clampPanelWidth(5000, 1200)).toBe(900);
  });

  it("without a measured canvas only the minimum applies", () => {
    expect(clampPanelWidth(100, 0)).toBe(MIN_PANEL_WIDTH);
    expect(clampPanelWidth(5000, 0)).toBe(5000);
  });
});

describe("resolvePanelWidth", () => {
  it("a remembered width wins over the page's default, clamped to today's canvas", () => {
    expect(resolvePanelWidth(600, "55%", 1200)).toBe(600);
    expect(resolvePanelWidth(2000, "55%", 1200)).toBe(900);
    expect(resolvePanelWidth(600, 380, 1200)).toBe(600);
  });

  it("a fraction is the share of the measured canvas; before the measure it leaves the kit's CSS default", () => {
    expect(resolvePanelWidth(null, "55%", 1250)).toBe(688);
    expect(resolvePanelWidth(null, "55%", 0)).toBeNull();
    expect(resolvePanelWidth(null, "90%", 1000)).toBe(750);
  });

  it("a px default is applied as given, within the bounds; no default leaves the kit's CSS width", () => {
    expect(resolvePanelWidth(null, 420, 1200)).toBe(420);
    expect(resolvePanelWidth(null, 100, 1200)).toBe(MIN_PANEL_WIDTH);
    expect(resolvePanelWidth(null, undefined, 1200)).toBeNull();
    expect(resolvePanelWidth(undefined, undefined, 0)).toBeNull();
    expect(DEFAULT_PANEL_WIDTH).toBe(380);
  });
});
