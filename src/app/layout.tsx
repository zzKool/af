import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

// D40: the system font stack (globals.css) — no next/font, nothing downloaded in any environment.
// The favicon is `app/icon.svg` (the AF sign, public/brand/af-sign.svg).
export const metadata: Metadata = {
  title: "AF",
  description: "AnalyticsFab — business administration",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        <Toaster position="bottom-right" visibleToasts={3} />
      </body>
    </html>
  );
}
