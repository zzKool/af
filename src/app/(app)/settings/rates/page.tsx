import { redirect } from "next/navigation";

// F136: the exchange rates moved to the menu (`/rates`); the old settings address sends there.
export default function RatesSettingsPage() {
  redirect("/rates");
}
