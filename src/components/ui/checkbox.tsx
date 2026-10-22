"use client";

// shadcn (base-nova) checkbox — hand-written in the registry's shape; see popover.tsx.
import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/lib/utils";

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-[3px] border border-input bg-surface transition-shadow outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50 data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:border-primary data-indeterminate:bg-primary data-indeterminate:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
        keepMounted
        render={(renderProps, state) => (
          <span {...renderProps}>
            {state.indeterminate ? (
              <MinusIcon className="size-3" />
            ) : state.checked ? (
              <CheckIcon className="size-3" />
            ) : null}
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
