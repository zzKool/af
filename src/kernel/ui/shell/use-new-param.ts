"use client";

// F73: the sidebar's **+ New** links to the page with `?new=1`; the page's primary dialog opens from it.
// One hook for every module: open while the param is there (also when + New is used on the same page),
// and closing the dialog drops the param, so a refresh or the back button does not open it again.
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

export const NEW_PARAM = "new";

/** `[open, setOpen]` for a page's create dialog, opened by `?new=1`. Pass `enabled: false` when the caller
 *  may not create (the param is then ignored and left alone). */
export function useNewParam(enabled = true): [boolean, (open: boolean) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = enabled && searchParams.get(NEW_PARAM) === "1";
  const [open, setOpenState] = useState(requested);

  // + New clicked while already on the page: same route, new params — the component stays mounted
  useEffect(() => {
    if (requested) setOpenState(true);
  }, [requested]);

  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      if (next || searchParams.get(NEW_PARAM) === null) return;
      const rest = new URLSearchParams(searchParams.toString());
      rest.delete(NEW_PARAM);
      const qs = rest.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return [open, setOpen];
}
