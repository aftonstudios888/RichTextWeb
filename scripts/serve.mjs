import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const root = resolve(process.env.SERVE_DIR || "site");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".wasm": "application/wasm",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".map": "application/json",
};
createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    let p = resolve(root, "." + pathname);
    if (p !== root && !p.startsWith(root + sep)) throw Error();
    if ((await stat(p)).isDirectory()) p = resolve(p, "index.html");
    const data = await readFile(p);
    res.writeHead(200, {
      "Content-Type": mime[extname(p)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(Number(process.env.PORT || 4173), "0.0.0.0", () =>
  console.log(`RichTextWeb at http://localhost:${process.env.PORT || 4173}`),
);
