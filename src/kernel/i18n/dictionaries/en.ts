// UI strings — English is the key set; every other dictionary is typed against it (sv later = one more file).
// Keys are `<module>.<area>.<name>`; `{name}` placeholders are filled by translate()/useT().
export const en = {
  "common.save": "Save",
  "common.cancel": "Cancel",
  "common.delete": "Delete",
  "common.add": "Add",
  "common.edit": "Edit",
  "common.open": "Open",
  "common.today": "Today",

  "contracts.currentRate": "Current rate",
  "contracts.currentRate.none": "No rate for today",
  "contracts.currency.lockedHint":
    "Rates exist in this currency — use a second contract for another currency.",

  "contracts.rates.title": "Rates",
  "contracts.rates.validFrom": "Valid from",
  "contracts.rates.validTo": "Valid to",
  "contracts.rates.rate": "Rate",
  "contracts.rates.unit": "Unit",
  "contracts.rates.unit.day": "day",
  "contracts.rates.note": "Note",
  "contracts.rates.open": "Open",
  "contracts.rates.state.current": "Current",
  "contracts.rates.state.expired": "Expired",
  "contracts.rates.state.future": "Future",
  "contracts.rates.empty": "No rates yet",
  "contracts.rates.add": "Add rate",
  "contracts.rates.tip": 'Leave "valid to" empty for an ongoing rate.',
  "contracts.rates.added": "Rate added",
  "contracts.rates.updated": "Rate updated",
  "contracts.rates.deleted": "Rate deleted",
  "contracts.rates.deleteConfirm.title": "Delete rate",
  "contracts.rates.deleteConfirm.description":
    "Delete the rate {rate} valid from {from}? Rates used on an invoice cannot be deleted.",
  "contracts.rates.error.amount": "A valid amount is required",
  "contracts.rates.error.validFrom": "Valid from is required",
  "contracts.rates.error.validTo": "Valid to must be on or after valid from",
  "contracts.rates.error.overlap": "This rate overlaps an existing rate ({from} → {to})",
  "contracts.rates.error.inUse":
    "This rate is used on {n} invoice line(s) and cannot be deleted — close it instead",
} as const;

export type MessageKey = keyof typeof en;
export type Dictionary = Record<MessageKey, string>;
