"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import type { ConfirmDialogProps } from "@/components/ui/confirm-dialog";

interface ConfirmOptions {
  description?: string;
}

interface UseConfirmDialogOptions {
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
}

export function useConfirmDialog(options: UseConfirmDialogOptions = {}) {
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [description, setDescription] = useState(options.description ?? "");
  const pendingAction = useRef<(() => Promise<void>) | null>(null);
  const defaultDescriptionRef = useRef(options.description ?? "");
  defaultDescriptionRef.current = options.description ?? "";

  const confirm = useCallback((action: () => Promise<void>, opts?: ConfirmOptions) => {
    pendingAction.current = action;
    setDescription(opts?.description ?? defaultDescriptionRef.current);
    setOpen(true);
  }, []);

  const handleConfirm = useCallback(async () => {
    const action = pendingAction.current;
    if (!action) return;

    setIsLoading(true);
    try {
      await action();
      setOpen(false);
      pendingAction.current = null;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (isLoading) return;
      setOpen(nextOpen);
      if (!nextOpen) {
        pendingAction.current = null;
      }
    },
    [isLoading],
  );

  const dialogProps: ConfirmDialogProps = {
    open,
    onOpenChange: handleOpenChange,
    title: options.title,
    description,
    confirmLabel: options.confirmLabel,
    cancelLabel: options.cancelLabel,
    onConfirm: handleConfirm,
    isLoading,
    variant: options.variant,
  };

  return { dialogProps, confirm } as const;
}
