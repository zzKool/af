// Cross-platform postinstall: copy the pdf.js worker into public/ (Windows has no cp/mkdir -p).
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const src = join("node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dir = "public";
if (!existsSync(src)) {
  console.warn(`[postinstall] ${src} not found, skipping`);
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
copyFileSync(src, join(dir, "pdf.worker.min.mjs"));
console.log("[postinstall] copied pdf.worker.min.mjs to public/");
