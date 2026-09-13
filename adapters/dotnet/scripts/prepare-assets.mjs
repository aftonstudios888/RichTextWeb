import { cp, mkdir, copyFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(process.argv[2] ?? "artifacts/desktop/web");
await access(resolve(repo, "dist/richtextweb.global.js"));
await mkdir(output, { recursive: true });
await copyFile(
  resolve(nativeRoot, "web/editor.html"),
  resolve(output, "editor.html"),
);
await copyFile(
  resolve(repo, "dist/richtextweb.global.js"),
  resolve(output, "richtextweb.global.js"),
);
await cp(
  resolve(repo, "dist/richtextweb.global.js.LEGAL.txt"),
  resolve(output, "richtextweb.global.js.LEGAL.txt"),
).catch((error) => {
  if (error.code !== "ENOENT") throw error;
});
console.log(`Prepared self-contained native editor assets at ${output}`);
