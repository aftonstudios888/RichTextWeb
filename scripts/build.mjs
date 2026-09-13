import { build } from "esbuild";
import { rm, mkdir, readdir, writeFile, cp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc"], {
  stdio: "inherit",
});
const entries = (await readdir("src"))
  .filter((x) => x.endsWith(".ts"))
  .map((x) => `src/${x}`);
await build({
  entryPoints: entries,
  outdir: "dist/esm",
  bundle: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  packages: "external",
});
await build({
  entryPoints: entries,
  outdir: "dist/cjs",
  bundle: false,
  format: "cjs",
  platform: "neutral",
  target: "es2022",
  sourcemap: true,
  packages: "external",
});
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/richtextweb.global.js",
  bundle: true,
  format: "iife",
  globalName: "RichTextWeb",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
});
await writeFile("dist/cjs/package.json", JSON.stringify({ type: "commonjs" }));
await build({
  entryPoints: ["src/pdf.ts"],
  outfile: "dist/richtextweb.pdf.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  minify: true,
  sourcemap: true,
  legalComments: "linked",
});
await mkdir("dist/pdf-assets", { recursive: true });
await cp(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "dist/pdf-assets/pdf.worker.mjs",
);
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"])
  await cp(
    `node_modules/pdfjs-dist/${directory}`,
    `dist/pdf-assets/${directory}`,
    { recursive: true },
  );
await cp("node_modules/pdfjs-dist/LICENSE", "dist/pdf-assets/LICENSE");
console.log(
  "Built ESM, CommonJS, declarations, and standalone browser bundle.",
);
