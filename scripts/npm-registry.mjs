import { readFile, readdir, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, basename } from "node:path";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const registry = `https://registry.npmjs.org/${encodeURIComponent(pkg.name)}/${encodeURIComponent(pkg.version)}`;
const integrity = (bytes) =>
  "sha512-" + createHash("sha512").update(bytes).digest("base64");
async function metadata() {
  const r = await fetch(registry);
  if (r.status === 404) return null;
  if (!r.ok) throw Error(`Registry returned ${r.status}`);
  return r.json();
}
async function check(file) {
  const bytes = await readFile(file);
  const meta = await metadata();
  if (meta && meta.dist.integrity !== integrity(bytes))
    throw Error(
      "An immutable npm version already exists with different bytes. Bump the version.",
    );
  return { meta, bytes };
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
  const { meta } = await check(tarball);
  if (process.env.GITHUB_OUTPUT)
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `tarball=${tarball}\nexists=${Boolean(meta)}\n`,
    );
  console.log(
    `Verified ${pkg.name}@${pkg.version}; published=${Boolean(meta)}`,
  );
} else if (process.argv[2] === "verify") {
  const { meta, bytes } = await check(process.argv[3]);
  if (!meta) throw Error("Published version not found");
  const remote = await fetch(meta.dist.tarball);
  if (!remote.ok) throw Error("Cannot retrieve published tarball");
  const fetched = new Uint8Array(await remote.arrayBuffer());
  if (integrity(fetched) !== integrity(bytes))
    throw Error("Published bytes differ from release");
  console.log(`Verified public package integrity: ${pkg.name}@${pkg.version}`);
} else
  throw Error("Usage: npm-registry.mjs prepare <directory> | verify <tarball>");
