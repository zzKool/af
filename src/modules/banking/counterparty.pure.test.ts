import { describe, expect, it } from "vitest";
import { counterpartyKey, stripCardPrefix } from "./counterparty";

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

  it("stripCardPrefix handles both spellings", () => {
    expect(stripCardPrefix("Kortköp 260727 OPENAI")).toBe("OPENAI");
    expect(stripCardPrefix("KORTKOP 260727 OPENAI")).toBe("OPENAI");
    expect(stripCardPrefix("KORT KOP LIVSMEDEL AB")).toBe("LIVSMEDEL AB");
    expect(stripCardPrefix("Something")).toBe("Something");
  });
});
