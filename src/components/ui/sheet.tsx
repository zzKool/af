"use client";

// shadcn (base-nova) Sheet on Base UI's Dialog — the side panel of a list page. Since D40 it is the **docked
// details panel**: inside the app shell a right-side SheetContent renders into the canvas's dock (details-dock),
// the table narrows, nothing is covered — no backdrop, no focus trap, a click on another row does not close it
// (Escape and the close button do). Outside the shell (tests, print) it falls back to the overlay.
// When the page's table remembers the panel as hidden (F74), the docked panel is a rail with *Show* instead.
// Since F131 the docked panel is resizable: a handle on its left edge (drag; ← wider / → narrower by 40 px;
// double-click resets), 340 px to 75 % of the canvas; the page names the default (`defaultWidth`, px or "55%")
// and the table's layout remembers the width the user chose (`panelWidth`, beside `panelHidden`).
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { PanelRightClose, PanelRightOpen, XIcon } from "lucide-react";
import type * as React from "react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { useT } from "@/kernel/i18n/use-t";
import {
  clampPanelWidth,
  DEFAULT_PANEL_WIDTH,
  MAX_PANEL_FRACTION,
  MIN_PANEL_WIDTH,
  PANEL_RESIZE_STEP,
  type PanelWidth,
  resolvePanelWidth,
  useDetailsDock,
  useDockCanvasWidth,
  useDockedPanelState,
} from "@/kernel/ui/shell/details-dock";
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

// --- the handle on the docked panel's left edge: drag with the pointer (live, committed on release),
//     ← wider / → narrower on the keyboard (committed at once), double-click back to the page's default

function PanelResizeHandle({
  width,
  canvasWidth,
  onResize,
  onCommit,
  onReset,
}: {
  /** the width applied, when known (else the kit's CSS default) */
  width: number | null;
  canvasWidth: number;
  /** the pointer moves: the width to show now; null = back to what is remembered (the drag went nowhere) */
  onResize: (px: number | null) => void;
  /** the pointer released or a key pressed: the width to remember */
  onCommit: (px: number) => void;
  onReset: () => void;
}) {
  const t = useT();
  const start = useRef<{ x: number; width: number } | null>(null);
  /** the panel's current width: the applied one, else measured, else the kit's default */
  const currentWidth = (el: HTMLElement) =>
    width ??
    ((el.closest("[data-slot=sheet-content]") as HTMLElement | null)?.getBoundingClientRect()
      .width ||
      DEFAULT_PANEL_WIDTH);
  const max =
    canvasWidth > 0
      ? Math.floor(canvasWidth * MAX_PANEL_FRACTION)
      : Math.max(MIN_PANEL_WIDTH, width ?? DEFAULT_PANEL_WIDTH);
  return (
    // biome-ignore lint/a11y/useSemanticElements: an <hr> cannot be focused or dragged; the separator role is the ARIA way to say "resizer"
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={t("details.resize")}
      title={t("details.resizeHint")}
      aria-valuenow={Math.round(width ?? DEFAULT_PANEL_WIDTH)}
      aria-valuemin={MIN_PANEL_WIDTH}
      aria-valuemax={max}
      tabIndex={0}
      data-slot="details-resize"
      className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-col-resize select-none hover:bg-primary/40 focus-visible:bg-primary/40 focus-visible:outline-none"
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.preventDefault();
        onReset();
      }}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start.current = { x: e.clientX, width: currentWidth(e.currentTarget) };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        // the panel sits on the right: the handle moving left makes it wider
        onResize(start.current.width + (start.current.x - e.clientX));
      }}
      onPointerUp={(e) => {
        if (!start.current) return;
        const moved = e.clientX !== start.current.x;
        // a click that did not move pins nothing (the page's default stays a fraction of the canvas)
        if (moved) onCommit(start.current.width + (start.current.x - e.clientX));
        else onResize(null);
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const from = currentWidth(e.currentTarget);
        onCommit(from + (e.key === "ArrowLeft" ? PANEL_RESIZE_STEP : -PANEL_RESIZE_STEP));
      }}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  defaultWidth,
  resizable = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "right" | "left";
  /** the docked panel's default width — px, or a fraction of the canvas ("55%"); the kit's 380 / 400 px when absent */
  defaultWidth?: PanelWidth;
  /** the docked panel's resize handle (on by default) */
  resizable?: boolean;
}) {
  const t = useT();
  const dock = useDetailsDock();
  const remembered = useDockedPanelState();
  const canvasWidth = useDockCanvasWidth();
  // the width while the pointer drags (remembered on release), and the one chosen on a page without a table
  const [live, setLive] = useState<number | null>(null);
  const [local, setLocal] = useState<number | null>(null);
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
    const chosen = remembered ? remembered.width : local;
    const remember = (px: number | null) => {
      setLive(null);
      if (remembered) remembered.setWidth(px);
      else setLocal(px);
    };
    const width = resolvePanelWidth(live ?? chosen, defaultWidth, canvasWidth);
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
          style={width != null ? { width } : undefined}
          data-panel-width={width ?? undefined}
          {...props}
        >
          {resizable && (
            <PanelResizeHandle
              width={width}
              canvasWidth={canvasWidth}
              onResize={(px) => setLive(px == null ? null : clampPanelWidth(px, canvasWidth))}
              onCommit={(px) => remember(clampPanelWidth(px, canvasWidth))}
              onReset={() => remember(null)}
            />
          )}
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
          "fixed inset-y-0 z-50 flex w-full flex-col gap-4 overflow-y-auto bg-surface p-4 shadow-pop ring-1 ring-border duration-200 outline-none sm:max-w-xl data-open:animate-in data-closed:animate-out",
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
