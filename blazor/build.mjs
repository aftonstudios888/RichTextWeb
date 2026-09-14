import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
await import('./runtime-source/blazor/build-consumer.mjs');
for (const dependency of ['pdfjs-dist', 'pdf-lib', '@pdf-lib/fontkit', 'jszip', 'marked']) {
  const directory = `node_modules/${dependency}`;
  if (!existsSync(directory)) continue;
  for (const entry of readdirSync(directory)) {
    if (!/^(licen[sc]e|notice|copying)(\.|$)/i.test(entry)) continue;
    const target = `blazor/src/wwwroot/licenses/${dependency.replaceAll('/', '_')}`;
    mkdirSync(target, { recursive: true }); cpSync(join(directory, entry), join(target, entry));
  }
}
function inspect(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const item = join(path, entry.name);
    if (entry.isDirectory()) inspect(item);
    else if (/\.(ttf|otf|woff2?|ttc|otc|eot|pfa|pfb)$/i.test(item)) throw new Error(`Font binaries are not distributed in this package: ${item}`);
  }
}
inspect('blazor/src/wwwroot');
