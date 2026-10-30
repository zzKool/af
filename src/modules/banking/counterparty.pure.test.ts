import { describe, expect, it } from "vitest";
import { counterpartyKey, stripCardPrefix, stripReference } from "./counterparty";

describe("counterparty key (Excel Column1)", () => {
  it("takes the name first, upper-cased and collapsed", () => {
    expect(counterpartyKey({ name: "  Skatteverket  " })).toBe("SKATTEVERKET");
    expect(counterpartyKey({ name: "AVGIFTER NORDEA", additionalDetails: "Priset for juni" })).toBe(
      "AVGIFTER NORDEA",
    );
  });

  it("falls back to the additional details without the card prefix", () => {
    expect(
      counterpartyKey({
        name: "",
        additionalDetails: "Kortköp 260727 OPENAI *CHATGPT SUBS",
        message: "OPENAI *CHATGPT 1234",
      }),
    ).toBe("OPENAI *CHATGPT SUBS");
    expect(counterpartyKey({ name: "KORT KOP LIVSMEDEL AB" })).toBe("LIVSMEDEL AB");
  });

  it("falls back to message, sender, recipient, then UNKNOWN", () => {
    expect(counterpartyKey({ message: "CHANGE CHFSEK" })).toBe("CHANGE CHFSEK");
    expect(counterpartyKey({ sender: "2026", additionalDetails: "" })).toBe("2026");
    expect(counterpartyKey({ recipient: "123 45 67-8" })).toBe("123 45 67-8");
    expect(counterpartyKey({})).toBe("UNKNOWN");
  });

  it("drops a trailing 4-digit card suffix", () => {
    expect(counterpartyKey({ message: "ANTHROPIC* CLAU 1234" })).toBe("ANTHROPIC* CLAU");
    expect(counterpartyKey({ name: "Ränta 2026" })).toBe("RÄNTA");
  });

  it("drops a per-transaction reference at the end (D71): a `#…` bill number, a `* CODE` with digits", () => {
    expect(counterpartyKey({ additionalDetails: "Kortköp 260709 MICROSOFT#G169504312" })).toBe(
      "MICROSOFT",
    );
    expect(counterpartyKey({ additionalDetails: "Kortköp 260707 MSFT * E0100ZW7M8" })).toBe("MSFT");
    expect(counterpartyKey({ additionalDetails: "Kortköp 260801 AMZN MKTP SE*2A1BC3DEF" })).toBe(
      "AMZN MKTP SE",
    );
    // next month's row of the same merchant: the same key
    expect(counterpartyKey({ additionalDetails: "Kortköp 260809 MICROSOFT#G170011223" })).toBe(
      counterpartyKey({ additionalDetails: "Kortköp 260709 MICROSOFT#G169504312" }),
    );
  });

  it("keeps a `*` product name without digits, and a reference in the middle", () => {
    expect(counterpartyKey({ additionalDetails: "Kortköp 260727 OPENAI *CHATGPT SUBS" })).toBe(
      "OPENAI *CHATGPT SUBS",
    );
    expect(counterpartyKey({ additionalDetails: "Kortköp 260727 ANTHROPIC* CLAUDE SU" })).toBe(
      "ANTHROPIC* CLAUDE SU",
    );
    expect(counterpartyKey({ name: "Skattepunkten´s Office Services AB" })).toBe(
      "SKATTEPUNKTEN´S OFFICE SERVICES AB",
    );
    expect(counterpartyKey({ message: "#REF ONLY" })).toBe("#REF ONLY");
    // a text that is only a reference does not vanish into an empty key
    expect(counterpartyKey({ additionalDetails: "Kortköp 260709 #G169504312" })).toBe("UNKNOWN");
    expect(stripReference("MICROSOFT#G169504312 6482")).toBe("MICROSOFT#G169504312 6482");
  });

  it("stripCardPrefix handles both spellings", () => {
    expect(stripCardPrefix("Kortköp 260727 OPENAI")).toBe("OPENAI");
    expect(stripCardPrefix("KORTKOP 260727 OPENAI")).toBe("OPENAI");
    expect(stripCardPrefix("KORT KOP LIVSMEDEL AB")).toBe("LIVSMEDEL AB");
    expect(stripCardPrefix("Something")).toBe("Something");
  });
});
