import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { requireCaller } from "@/kernel/auth/caller";
import { prisma } from "@/kernel/db/client";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";
import { browserLocale } from "@/kernel/i18n/request-locale";
import { parseTheme } from "@/kernel/ui/theme";
import { ThemeSync } from "@/kernel/ui/theme-sync";

// The phone (F142, Pulse phase 6c): one column, no rail — the owner snaps a receipt where he is, over his own
// network (nothing about it in the repo, D51). Added to the home screen it opens like an app (`app/manifest.ts`).
export const metadata: Metadata = {
  title: "AF · Snap a receipt",
  appleWebApp: { capable: true, title: "AF", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function PhoneLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const auth = await requireCaller({ action: "create", subject: "expense" });
  const pref = await prisma.userPreference.findUnique({
    where: { userId: auth.userId },
    select: { locale: true, theme: true },
  });
  return (
    <>
      <ThemeSync theme={parseTheme(pref?.theme)} />
      <LocaleProvider initialLocale={pref?.locale ?? null} browserLocale={await browserLocale()}>
        <div className="min-h-dvh bg-app px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-8">
          <header className="mx-auto mb-4 flex w-full max-w-md items-center justify-between">
            <Link href="/m" className="flex items-center gap-2" aria-label="AF">
              {/* biome-ignore lint/performance/noImgElement: a static SVG logo, no optimisation to gain */}
              <img src="/brand/af-sign.svg" alt="" className="size-7" />
              <span className="text-sm font-semibold">AnalyticsFab</span>
            </Link>
            <Link href="/dashboard" className="text-xs text-muted-foreground">
              ↗
            </Link>
          </header>
          {children}
        </div>
      </LocaleProvider>
    </>
  );
}
