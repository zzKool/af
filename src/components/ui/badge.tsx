import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// D40: a badge is a **tag** — metadata (bank, currency, type), grey, 4 px, never a colour and never a state
// (states are <StateLabel>: icon + word). `default` and `secondary` are the tag; `outline` a bordered tag.
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-1.5 text-xs whitespace-nowrap focus-visible:ring-2 focus-visible:ring-ring/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-tag text-foreground [a]:hover:bg-hover",
        secondary: "bg-tag text-foreground [a]:hover:bg-hover",
        destructive: "bg-tag text-destructive",
        outline: "border-border text-foreground [a]:hover:bg-hover",
        ghost: "text-muted-foreground hover:bg-hover",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  });
}

export { Badge, badgeVariants };
