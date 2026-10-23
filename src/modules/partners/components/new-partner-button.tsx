"use client";

// The list's one primary (D40 title row): Add partner, opening a small dialog — name, short code, types. The rest
// (identifiers, defaults, address, contacts) is filled on the partner page, where the new row's link leads.
import { useRouter } from "next/navigation";
import { useAction } from "next-safe-action/hooks";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { extractError } from "@/kernel/errors/extract-error";
import { useT } from "@/kernel/i18n/use-t";
import { createPartnerAction } from "@/modules/partners/partners.actions";
import type { PartnerType } from "../types";
import { PARTNER_TYPES } from "./partner-labels";

export function NewPartnerButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>{t("partners.add")}</Button>
      {/* mounted only while open: every opening starts from an empty form */}
      {open && <NewPartnerDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function NewPartnerDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const ids = useId();
  const router = useRouter();
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [types, setTypes] = useState<PartnerType[]>(["client"]);
  const { executeAsync, isPending } = useAction(createPartnerAction);
  const ready = name.trim() !== "" && types.length > 0;

  async function submit() {
    if (!ready) return;
    const r = await executeAsync({
      name: name.trim(),
      shortCode: shortCode.trim().toUpperCase(),
      types,
    });
    const error = extractError(r);
    if (error) {
      toast.error(error);
      return;
    }
    toast.success(t("partners.created"));
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="new-partner-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("partners.add")}</DialogTitle>
        </DialogHeader>
        <form
          id={`${ids}-form`}
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div>
            <label htmlFor="new-partner-name" className="mb-1 block text-xs font-medium">
              {t("partners.new.name")}
            </label>
            <Input
              id="new-partner-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("partners.new.namePlaceholder")}
              autoFocus
            />
          </div>
          <div className="w-32">
            <label htmlFor="new-partner-short" className="mb-1 block text-xs font-medium">
              {t("partners.new.shortCode")}
            </label>
            <Input
              id="new-partner-short"
              value={shortCode}
              onChange={(e) => setShortCode(e.target.value.toUpperCase())}
              placeholder="VA"
              maxLength={6}
              className="uppercase"
            />
          </div>
          <fieldset>
            <legend className="mb-1 block text-xs font-medium">{t("partners.new.types")}</legend>
            <div className="flex gap-4">
              {PARTNER_TYPES.map((type) => (
                <label key={type} className="flex items-center gap-1.5 text-[13px]">
                  <input
                    type="checkbox"
                    checked={types.includes(type)}
                    onChange={(e) =>
                      setTypes((prev) =>
                        e.target.checked ? [...prev, type] : prev.filter((x) => x !== type),
                      )
                    }
                  />
                  {t(`partners.type.${type}`)}
                </label>
              ))}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={`${ids}-form`} disabled={isPending || !ready}>
            {isPending ? t("partners.new.creating") : t("partners.new.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
