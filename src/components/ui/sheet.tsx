"use client";

// shadcn (base-nova) Sheet on Base UI's Dialog — the side panel of a list page. Since D40 it is the **docked
// details panel**: inside the app shell a right-side SheetContent renders into the canvas's dock (details-dock),
// the table narrows, nothing is covered — no backdrop, no focus trap, a click on another row does not close it
// (Escape and the close button do). Outside the shell (tests, print) it falls back to the overlay.
// When the page's table remembers the panel as hidden (F74), the docked panel is a rail with *Show* instead.
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { PanelRightClose, PanelRightOpen, XIcon } from "lucide-react";
import type * as React from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import { useDetailsDock, useDockedPanelState } from "@/kernel/ui/shell/details-dock";
import { cn } from "@/lib/utils";

function CloseButton() {
  const t = useT();
  return (
    <SheetPrimitive.Close
      data-slot="sheet-close"
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-3 right-3"
          aria-label={t("details.close")}
        />
      }
    >
      <XIcon />
    </SheetPrimitive.Close>
  );
}

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  const dock = useDetailsDock();
  return (
    <SheetPrimitive.Root
      data-slot="sheet"
      {...(dock ? { modal: false, disablePointerDismissal: true } : {})}
      {...props}
    />
  );
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetContent({
  className,
  children,
  side = "right",
  ...props
}: SheetPrimitive.Popup.Props & { side?: "right" | "left" }) {
  const t = useT();
  const dock = useDetailsDock();
  const remembered = useDockedPanelState();
  if (dock && side === "right") {
    if (remembered?.hidden) {
      return createPortal(
        <div
          data-slot="details-rail"
          className="flex h-full w-10 flex-col items-center border-l bg-surface pt-3"
        >
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t("details.show")}
            title={t("details.show")}
            onClick={() => remembered.setHidden(false)}
          >
            <PanelRightOpen />
          </Button>
        </div>,
        dock,
      );
    }
    return (
      <SheetPrimitive.Portal container={dock}>
        <SheetPrimitive.Popup
          data-slot="sheet-content"
          data-side="right"
          data-docked=""
          className={cn(
            "relative flex h-full w-[380px] flex-col gap-4 overflow-y-auto border-l bg-surface px-4 py-3.5 outline-none xl:w-[400px]",
            className,
          )}
          {...props}
        >
          {children}
          {remembered && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-3 right-10"
              aria-label={t("details.hide")}
              title={t("details.hide")}
              onClick={() => remembered.setHidden(true)}
            >
              <PanelRightClose />
            </Button>
          )}
          <CloseButton />
        </SheetPrimitive.Popup>
      </SheetPrimitive.Portal>
    );
  }
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 isolate z-50 bg-black/10 duration-100 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed inset-y-0 z-50 flex w-full flex-col gap-4 overflow-y-auto bg-surface p-4 shadow-lg ring-1 ring-border duration-200 outline-none sm:max-w-xl data-open:animate-in data-closed:animate-out",
          side === "right"
            ? "right-0 data-open:slide-in-from-right data-closed:slide-out-to-right"
            : "left-0 data-open:slide-in-from-left data-closed:slide-out-to-left",
          className,
        )}
        {...props}
      >
        {children}
        <CloseButton />
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 pr-16", className)}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-[15px] font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger };
