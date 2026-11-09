import { redirect } from "next/navigation";

// F157: Settings is one page with a sub-menu (the layout); its first section is the user's own preferences.
export default function SettingsPage() {
  redirect("/settings/my-preferences");
}
