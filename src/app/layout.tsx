import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { parseTheme, THEME_COOKIE } from "@/kernel/ui/theme";
import "./globals.css";

// D76: Geist and Geist Mono, self-hosted from the `geist` package (next/font/local) — the files ship in the
// image, nothing is fetched at build or at run time; globals.css maps --font-sans / --font-mono onto them.
// The favicon is `app/icon.svg` (the AF sign, public/brand/af-sign.svg).
export const metadata: Metadata = {
  title: "AF",
  description: "AnalyticsFab — business administration",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // the user's theme (D43) in the first HTML — the cookie mirrors user_preferences.theme; none = the OS decides
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme ?? undefined}
      className={`${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="antialiased">
        {children}
        <Toaster position="bottom-right" visibleToasts={3} />
      </body>
    </html>
  );
}
