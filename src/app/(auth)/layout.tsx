import { headers } from "next/headers";
import { uiLanguageFromAcceptLanguage } from "@/kernel/i18n/locale";
import { LocaleProvider } from "@/kernel/i18n/locale-provider";

// Login and register run before there is a user preference: the browser's Accept-Language picks fr / sv / en.
// Resolved on the server so the server render and the client render agree (no hydration flip).
export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = uiLanguageFromAcceptLanguage((await headers()).get("accept-language"));
  return (
    <LocaleProvider initialLocale={lang}>
      <div lang={lang}>{children}</div>
    </LocaleProvider>
  );
}
