// A refused rate write in the user's language. The service's message is English; its `details` say which rule
// refused, and each rule has a key. Client-safe (no Prisma) — the Rates section and its test read it.
//
//   details { from, to }      the dates overlap another rate            contracts.rates.error.overlap
//   details { usedOn, fields } a used rate's start or amount changed (F63) contracts.rates.error.usedLocked
//   details { n }             a used rate cannot be deleted               contracts.rates.error.inUse
//   anything else             the service's message as it came
import type { AppError } from "@/kernel/errors/app-error";
import type { MessageKey, MessageParams } from "@/kernel/i18n/translate";

type Translate = (key: MessageKey, params?: MessageParams) => string;

export function rateErrorText(err: AppError, t: Translate): string {
  const d = err.details;
  if (d && "from" in d && "to" in d) {
    return t("contracts.rates.error.overlap", {
      from: String(d.from),
      to: d.to === "open" ? t("contracts.rates.open") : String(d.to),
    });
  }
  // checked before `n`: the edit refusal carries `usedOn` precisely so it never reads as the delete text
  if (d && "usedOn" in d) return t("contracts.rates.error.usedLocked", { n: Number(d.usedOn) });
  if (d && "n" in d) return t("contracts.rates.error.inUse", { n: Number(d.n) });
  return err.message;
}
