import { readFile, readdir, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";
import {
  createRegistryClient,
  checkRegistryPackage,
} from "./registry-client.mjs";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const registry = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
const client = createRegistryClient({
  onRetry: ({ operation, attempt, delayMs, status }) =>
    console.warn(
      `Registry ${operation} ${status ? `HTTP ${status}` : "network failure"}; retry ${attempt} in ${delayMs / 1000}s`,
    ),
});
async function check(file, verifyTarball = false) {
  const bytes = await readFile(file);
  return checkRegistryPackage(client, registry, bytes, { verifyTarball });
}
if (process.argv[2] === "prepare") {
  const dir = resolve(process.argv[3]);
  const files = (await readdir(dir)).filter((x) => x.endsWith(".tgz"));
  if (files.length !== 1) throw Error("Expected exactly one release tarball");
  const tarball = resolve(dir, files[0]);
  const sums = await readFile(resolve(dir, "SHA256SUMS.txt"), "utf8");
  const line = sums
    .split("\n")
    .find((l) => l.trim().endsWith("  " + basename(tarball)));
  if (!line) throw Error("Missing tarball checksum");
  const sha = createHash("sha256")
    .update(await readFile(tarball))
    .digest("hex");
  if (line.split(/\s+/)[0] !== sha) throw Error("Release checksum mismatch");
  const meta = await check(tarball);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `tarball=${tarball}\nexists=${Boolean(meta)}\n`,
    );
  console.log(
    `Verified ${pkg.name}@${pkg.version}; published=${Boolean(meta)}`,
  );
} else if (process.argv[2] === "verify") {
  await check(process.argv[3], true);
  console.log(`Verified public package integrity: ${pkg.name}@${pkg.version}`);
} else
  throw Error("Usage: npm-registry.mjs prepare <directory> | verify <tarball>");
