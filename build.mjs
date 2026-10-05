// ParcLive build: compiles app.jsx once (esbuild) so browsers no longer have to download and
// run Babel on every page load. Output goes to dist/ (this is what GitHub Pages publishes).
//   npm install && npm run build
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const html = readFileSync("index.html", "utf8");

// Libraries stay on the CDN (resolved by the import map in index.html) and are NOT bundled.
const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
const external = Object.keys(importMap);

const result = await build({
  entryPoints: ["app.jsx"],
  bundle: true,
  write: false,
  format: "esm",
  target: "es2020",
  jsx: "transform", // classic runtime: same as the former in-browser Babel preset (React is imported in app.jsx)
  minify: true,
  legalComments: "none",
  loader: { ".jsx": "jsx" },
  external,
  logLevel: "info",
});
const code = result.outputFiles[0].text;
const hash = createHash("sha256").update(code).digest("hex").slice(0, 10);
const jsName = `app.${hash}.js`;

// ---- index.html: swap the Babel-in-the-browser setup for the compiled bundle ----
let out = html;
function swap(re, replacement, what) {
  if (!re.test(out)) throw new Error(`build: could not find ${what} in index.html`);
  out = out.replace(re, replacement);
}
swap(/<!-- Babel standalone[\s\S]*?-->\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone[^>]*><\/script>\s*/, "", "the Babel <script>");
// start downloading the app and its libraries in parallel instead of one after the other
// (only libraries the bundle really imports up-front; xlsx is loaded on demand)
const usedUpFront = Object.entries(importMap).filter(([k]) => k !== "xlsx" && code.includes(`from"${k}"`));
const preload = [`./${jsName}`, ...usedUpFront.map(([, v]) => v)]
  .map((u) => `<link rel="modulepreload" href="${u}" crossorigin />`)
  .join("\n");
swap(/<script type="text\/babel"[^>]*src="\.\/app\.jsx"><\/script>/, `<script type="module" src="./${jsName}"></script>`, "the app.jsx <script>");
swap(/<style>/, `${preload}\n\n<style>`, "the <style> tag");

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/fonts", { recursive: true });

// ---- styles: Tailwind compiled once (no more runtime CDN script) + self-hosted Inter ----
for (const f of ["inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2"]) {
  copyFileSync(`node_modules/@fontsource-variable/inter/files/${f}`, `dist/fonts/${f}`);
}
execFileSync("node_modules/.bin/tailwindcss", ["-c", "tailwind.config.cjs", "-i", "styles.src.css", "-o", "dist/styles.tmp.css", "--minify"], { stdio: "pipe" });
const css = readFileSync("dist/styles.tmp.css", "utf8");
rmSync("dist/styles.tmp.css");
const cssName = `styles.${createHash("sha256").update(css).digest("hex").slice(0, 10)}.css`;
writeFileSync(`dist/${cssName}`, css);
swap(/<!-- Tailwind[\s\S]*?-->\s*<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/, `<link rel="preload" href="./fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />\n<link rel="stylesheet" href="./${cssName}" />`, "the Tailwind CDN <script>");

writeFileSync(`dist/${jsName}`, code);
writeFileSync("dist/index.html", out);
if (existsSync(".nojekyll")) copyFileSync(".nojekyll", "dist/.nojekyll");
console.log(`build ok: dist/${jsName} (${(code.length / 1024).toFixed(0)} KB JS) + dist/${cssName} (${(css.length / 1024).toFixed(0)} KB CSS)`);
