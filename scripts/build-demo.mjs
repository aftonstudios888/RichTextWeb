import { build } from "esbuild";
import { mkdir, cp, writeFile } from "node:fs/promises";
await mkdir("site", { recursive: true });
await cp("sample", "site", { recursive: true });
await build({
  entryPoints: ["sample/app.js"],
  outfile: "site/app.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
});
await writeFile("site/.nojekyll", "");
console.log("GitHub Pages sample built in site/.");
