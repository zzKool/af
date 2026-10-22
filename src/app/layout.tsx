import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { parseTheme, THEME_COOKIE } from "@/kernel/ui/theme";
import "./globals.css";

// D40: the system font stack (globals.css) — no next/font, nothing downloaded in any environment.
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
    <html lang="en" data-theme={theme ?? undefined}>
      <body className="antialiased">
        {children}
        <Toaster position="bottom-right" visibleToasts={3} />
      </body>
    </html>
  );
}
