"use client";

// Start a draft: client → contract (fills everything) → type, issue date, period. Creating opens the sheet.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { getContractsAction } from "@/modules/contracts/ui";
import { createDraftAction } from "@/modules/invoices/invoices.actions";

export type ClientOption = { id: string; name: string; shortCode: string | null };
type ContractOption = { id: string; name: string; currency: string | null };

export function NewInvoiceForm({
  clients,
  initialType,
  today,
}: {
  clients: ClientOption[];
  initialType: "invoice" | "quote";
  today: string;
}) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [type, setType] = useState<"invoice" | "quote">(initialType);
  const [partnerId, setPartnerId] = useState<string>(clients[0]?.id ?? "");
  // the contract list carries the client it was loaded for: a list (or a pick) of another client is never shown
  // nor submitted — client A → contract → client B used to submit A's contract while B's list loaded (F76)
  const [loaded, setLoaded] = useState<{ partnerId: string; contracts: ContractOption[] } | null>(
    null,
  );
  const [contractId, setContractId] = useState<string>("");
  const [issueDate, setIssueDate] = useState(today);
  const [periodLabel, setPeriodLabel] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const { executeAsync: loadContracts } = useAction(getContractsAction);
  const { executeAsync: create, isPending } = useAction(createDraftAction);

  useEffect(() => {
    if (!partnerId) return;
    let cancelled = false;
    (async () => {
      const r = await loadContracts({ partnerId });
      if (cancelled) return;
      const list = (r?.data?.data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        currency: c.currency,
      }));
      setLoaded({ partnerId, contracts: list });
      setContractId(list[0]?.id ?? "");
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerId, loadContracts]);

  const contractsReady = loaded?.partnerId === partnerId;
  const contracts = contractsReady ? loaded.contracts : [];
  // only a contract of the list loaded for this client goes out
  const pickedContract = contracts.some((c) => c.id === contractId) ? contractId : "";

  function changePartner(next: string) {
    if (next === partnerId) return;
    setContractId(""); // in the same render as the client: no frame where B is paired with A's contract
    setPartnerId(next);
  }

  async function submit() {
    if (!partnerId || !contractsReady) return;
    const r = await create({
      type,
      partnerId,
      contractId: pickedContract || null,
      issueDate,
      periodLabel: periodLabel.trim() || null,
      periodStart: periodStart || null,
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("invoices.created"));
    router.push(`/invoices/${r?.data?.data?.id}`);
  }

  const partner = clients.find((c) => c.id === partnerId);

  return (
    <form
      className="grid max-w-3xl gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div>
        <label htmlFor={`${ids}-type`} className="mb-1 block text-xs font-medium">
          {t("invoices.form.type")}
        </label>
        <Select value={type} onValueChange={(v) => v && setType(v as "invoice" | "quote")}>
          <SelectTrigger id={`${ids}-type`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="invoice">{t("invoices.type.invoice")}</SelectItem>
            <SelectItem value="quote">{t("invoices.type.quote")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <label htmlFor={`${ids}-partner`} className="mb-1 block text-xs font-medium">
          {t("invoices.form.partner")}
        </label>
        <Select value={partnerId} onValueChange={(v) => v && changePartner(v)}>
          <SelectTrigger id={`${ids}-partner`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.shortCode ? `[${c.shortCode}] ${c.name}` : c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {partner && !partner.shortCode && (
          <p className="mt-1 text-xs text-amber-700">{t("invoices.form.noShortCode")}</p>
        )}
      </div>
      <div>
        <label htmlFor={`${ids}-contract`} className="mb-1 block text-xs font-medium">
          {t("invoices.form.contract")}
        </label>
        <Select
          value={pickedContract || "__none__"}
          disabled={!contractsReady}
          onValueChange={(v) => setContractId(!v || v === "__none__" ? "" : v)}
        >
          <SelectTrigger id={`${ids}-contract`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("invoices.form.noContract")}</SelectItem>
            {contracts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
                {c.currency ? ` (${c.currency})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label htmlFor={`${ids}-date`} className="mb-1 block text-xs font-medium">
          {t("invoices.form.issueDate")}
        </label>
        <Input
          id={`${ids}-date`}
          type="date"
          value={issueDate}
          onChange={(e) => setIssueDate(e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${ids}-period`} className="mb-1 block text-xs font-medium">
          {t("invoices.form.period")}
        </label>
        <Input
          id={`${ids}-period`}
          value={periodLabel}
          onChange={(e) => setPeriodLabel(e.target.value)}
          placeholder={t("invoices.form.periodPlaceholder")}
        />
      </div>
      <div>
        <label htmlFor={`${ids}-start`} className="mb-1 block text-xs font-medium">
          {t("invoices.form.periodStart")}
        </label>
        <Input
          id={`${ids}-start`}
          type="date"
          value={periodStart}
          onChange={(e) => setPeriodStart(e.target.value)}
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("invoices.form.periodStartHint")}</p>
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isPending || !partnerId || !contractsReady}>
          {t("invoices.form.create")}
        </Button>
      </div>
    </form>
  );
}
