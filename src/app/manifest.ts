import type { MetadataRoute } from "next";

// F142: added to the phone's home screen, the app opens on *Snap a receipt* like an app of its own.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AnalyticsFab",
    short_name: "AF",
    description: "Snap a receipt — it reads itself and becomes an expense.",
    start_url: "/m",
    scope: "/",
    display: "standalone",
    background_color: "#eef1f5",
    theme_color: "#1f2633",
    icons: [{ src: "/brand/af-sign.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
