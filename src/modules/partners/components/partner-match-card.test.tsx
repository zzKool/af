// The partner match card (documents T026, FR-003, US1/AC4): the OCR vendor address goes to the match as text and
// pre-fills *Create new partner*.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const calls = vi.hoisted(() => ({
  match: vi.fn().mockResolvedValue({ data: { data: [] } }),
  create: vi.fn().mockResolvedValue({ data: { data: { id: "new-p" } } }),
}));

vi.mock("next-safe-action/hooks", () => ({
  useAction: (action: string) => ({
    executeAsync: action === "match" ? calls.match : calls.create,
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() } }));
vi.mock("@/modules/partners/partners.actions", () => ({
  matchPartnersAction: "match",
  createPartnerAction: "create",
}));

import { PartnerMatchCard } from "./partner-match-card";

const vendor = {
  name: "Test Vendor AB",
  vatNumber: "SE556677889901",
  address: {
    street: "Storgatan 1",
    postalCode: "111 22",
    city: "Stockholm",
    country: "SE",
    text: "Storgatan 1, 111 22 Stockholm, Sweden",
  },
};

describe("PartnerMatchCard — the vendor address", () => {
  afterEach(() => {
    cleanup();
    calls.match.mockClear();
    calls.create.mockClear();
  });

  it("matches on the printed address and creates the new vendor with its parts", async () => {
    const onCreated = vi.fn();
    render(
      <PartnerMatchCard vendor={vendor} selectedId="" onUseMatch={vi.fn()} onCreated={onCreated} />,
    );
    await waitFor(() => expect(calls.match).toHaveBeenCalled());
    expect(calls.match.mock.calls[0][0]).toMatchObject({
      name: "Test Vendor AB",
      address: "Storgatan 1, 111 22 Stockholm, Sweden",
      type: "vendor",
    });
    fireEvent.click(await screen.findByTestId("partner-match-new"));
    expect(screen.getByTestId("new-vendor-address")).toHaveTextContent("Storgatan 1, 111 22");
    fireEvent.click(screen.getByTestId("new-vendor-create"));
    await waitFor(() => expect(calls.create).toHaveBeenCalled());
    expect(calls.create.mock.calls[0][0]).toMatchObject({
      name: "Test Vendor AB",
      types: ["vendor"],
      vatNumber: "SE556677889901",
      address: { street: "Storgatan 1", postalCode: "111 22", city: "Stockholm", country: "SE" },
    });
    await waitFor(() =>
      expect(onCreated).toHaveBeenCalledWith({ id: "new-p", name: "Test Vendor AB" }),
    );
  });

  it("without an address: an empty address, nothing shown", async () => {
    render(
      <PartnerMatchCard
        vendor={{ name: "Test Vendor AB" }}
        selectedId=""
        onUseMatch={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByTestId("partner-match-new"));
    expect(screen.queryByTestId("new-vendor-address")).toBeNull();
    fireEvent.click(screen.getByTestId("new-vendor-create"));
    await waitFor(() => expect(calls.create).toHaveBeenCalled());
    expect(calls.create.mock.calls[0][0].address).toEqual({});
  });

  it("one partner per name / VAT number (D70): a refused create names the existing one and the card uses it", async () => {
    const onUseMatch = vi.fn();
    const onCreated = vi.fn();
    calls.create.mockResolvedValueOnce({
      data: {
        error: {
          code: "DUPLICATE_ENTRY",
          message: "A partner named “Test Vendor AB” exists already — use it instead",
          retryable: false,
          details: { existingId: "old-p", existingName: "Test Vendor AB", field: "name" },
        },
      },
    });
    render(
      <PartnerMatchCard vendor={vendor} selectedId="" onUseMatch={onUseMatch} onCreated={onCreated} />,
    );
    fireEvent.click(await screen.findByTestId("partner-match-new"));
    fireEvent.click(screen.getByTestId("new-vendor-create"));
    await waitFor(() => expect(onUseMatch).toHaveBeenCalledWith("old-p"));
    expect(onCreated).not.toHaveBeenCalled();
    // the inline form closed: the card is back to its matches
    expect(screen.queryByTestId("new-vendor-create")).toBeNull();
  });
});
