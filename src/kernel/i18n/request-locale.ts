import { headers } from "next/headers";
import { acceptLanguageTagWithDictionary } from "./locale";

// Server side of "no preference = the browser's language": the request's Accept-Language stands in for
// `navigator.language`, so a server page and the client components under it pick the same language.

/** The browser's locale tag that has a dictionary, from the request; null when none has (English). */
export async function browserLocale(): Promise<string | null> {
  return acceptLanguageTagWithDictionary((await headers()).get("accept-language"));
}

/** The locale a server page renders in: the user's preference, else the browser's. */
export async function requestLocale(preference: string | null | undefined): Promise<string | null> {
  return preference ?? (await browserLocale());
}
