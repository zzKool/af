import { redirect } from "next/navigation";

// F153: the inbox became the documents desk (/documents) — old links and bookmarks land there.
export default function DocumentInboxPage() {
  redirect("/documents");
}
