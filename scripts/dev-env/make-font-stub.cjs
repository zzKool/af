// Writes a next/font/google mock for sessions where fonts.googleapis.com is unreachable (cloud agent sessions).
//   node scripts/dev-env/make-font-stub.cjs <out.js>
//   NEXT_FONT_GOOGLE_MOCKED_RESPONSES=<out.js> npm run build
// Next (webpack and Turbopack) reads that env var: a module mapping each Google Fonts CSS URL to its CSS; with it
// set, a font file URL is taken as the file's bytes instead of being downloaded. Turbopack bundles the mock in
// its own context, so it must be plain data (no require, no Proxy) — hence this generator. The keys are the URLs
// Next itself computes for a default call (`Geist({ subsets: [...] })`) of every family in its font-data.json;
// each answers with one latin @font-face, so the build passes and the page falls back to the system font.
// A call with explicit weights / styles / display: add it to EXTRA. Never used by CI or the image.
const fs = require("node:fs");
const dir = "next/dist/compiled/@next/font/dist/google/";
const fontData = require(`${dir}font-data.json`);
const { getFontAxes } = require(`${dir}get-font-axes`);
const { getGoogleFontsUrl } = require(`${dir}get-google-fonts-url`);

const EXTRA = []; // [family, weights[], styles[], display]

const out = process.argv[2];
if (!out) {
  console.error("usage: node scripts/dev-env/make-font-stub.cjs <out.js>");
  process.exit(2);
}

const css = (family) =>
  `@font-face{font-family:'${family}';font-style:normal;font-weight:400;font-display:swap;src:url(https://fonts.gstatic.com/s/stub/v1/stub.woff2) format('woff2');unicode-range:U+0000-00FF;}`;

const responses = {};
const add = (family, weights, styles, display) => {
  try {
    responses[getGoogleFontsUrl(family, getFontAxes(family, weights, styles, undefined), display)] =
      css(family);
  } catch {
    // a default call Next itself rejects (e.g. a non-variable font without weights) — nothing to mock
  }
};
for (const [family, data] of Object.entries(fontData)) {
  add(
    family,
    data.weights.includes("variable") ? ["variable"] : [data.weights[0]],
    ["normal"],
    "swap",
  );
}
for (const [family, weights, styles, display] of EXTRA) add(family, weights, styles, display);

fs.writeFileSync(out, `module.exports = ${JSON.stringify(responses)};\n`);
console.log(`  font mock: ${Object.keys(responses).length} URLs → ${out}`);
