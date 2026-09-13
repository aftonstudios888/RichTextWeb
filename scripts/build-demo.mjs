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
await build({
  entryPoints: ["src/pdf.ts"],
  outfile: "site/richtextweb.pdf.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
});
await mkdir("site/pdf-assets", { recursive: true });
await cp(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "site/pdf-assets/pdf.worker.mjs",
);
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"])
  await cp(
    `node_modules/pdfjs-dist/${directory}`,
    `site/pdf-assets/${directory}`,
    { recursive: true },
  );
await cp("node_modules/pdfjs-dist/LICENSE", "site/pdf-assets/LICENSE");
await writeFile("site/.nojekyll", "");
console.log("GitHub Pages sample built in site/.");
