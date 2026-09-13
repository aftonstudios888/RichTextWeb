/** Validate the publishable tarball from an isolated consumer, rather than importing source. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  copyFile,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryManifest = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const tarballOption = process.argv.indexOf("--tarball");
if (tarballOption >= 0 && !process.argv[tarballOption + 1])
  throw new Error("--tarball requires an archive path");
const suppliedTarball =
  tarballOption >= 0
    ? process.argv[tarballOption + 1]
    : process.env.RELEASE_TARBALL;
const temporary = await mkdtemp(join(tmpdir(), "richtextweb-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 16 * 1024 * 1024,
  });
try {
  let packed;
  let manifest;
  if (suppliedTarball) {
    // The release job verifies its downloaded artifact without rebuilding or repacking it.
    const source = resolve(suppliedTarball);
    const archive = join(temporary, "release-package.tgz");
    await copyFile(source, archive);
    const names = run("tar", ["-tzf", archive]).split("\n").filter(Boolean);
    for (const name of names)
      assert.ok(
        name.startsWith("package/") &&
          !name.split("/").includes("..") &&
          !name.includes("\\"),
        `Unsafe archive path: ${name}`,
      );
    const details = run("tar", ["-tvzf", archive]).split("\n").filter(Boolean);
    for (const line of details)
      assert.ok(
        line[0] === "-" || line[0] === "d",
        "Release archive must contain only regular files and directories",
      );
    const unpacked = join(temporary, "unpacked");
    await mkdir(unpacked);
    run("tar", [
      "-xzf",
      archive,
      "--directory",
      unpacked,
      "--no-same-owner",
      "--no-same-permissions",
    ]);
    manifest = JSON.parse(
      await readFile(join(unpacked, "package/package.json"), "utf8"),
    );
    assert.equal(
      manifest.name,
      repositoryManifest.name,
      "Release artifact package name must match this repository",
    );
    packed = {
      filename: "release-package.tgz",
      files: names
        .filter((name) => !name.endsWith("/"))
        .map((name) => ({ path: name.slice("package/".length) })),
      size: (await stat(archive)).size,
    };
  } else {
    [packed] = JSON.parse(
      run(
        npm,
        ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
        root,
      ),
    );
    manifest = repositoryManifest;
  }
  assert.ok(packed?.filename, "npm pack must produce a tarball");
  const files = new Set(packed.files.map((file) => file.path));
  for (const file of [
    "package.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "src/model.ts",
    "dist/richtextweb.global.js",
    "dist/types/index.d.ts",
    "dist/types/core.d.ts",
    "dist/types/react.d.ts",
  ])
    assert.ok(files.has(file), `Missing published file: ${file}`);
  for (const path of files)
    assert.ok(
      !/(^|\/)(node_modules|\.git|\.env)(\/|$)/.test(path),
      `Unexpected private/build dependency file in package: ${path}`,
    );
  for (const [subpath, entry] of Object.entries(manifest.exports)) {
    if (typeof entry === "string") {
      assert.ok(
        files.has(entry.replace(/^\.\//, "")),
        `Missing export ${subpath}`,
      );
      continue;
    }
    for (const condition of ["types", "import", "require"])
      assert.ok(
        files.has(entry[condition].replace(/^\.\//, "")),
        `Missing ${condition} target for ${subpath}`,
      );
  }
  const consumer = join(temporary, "consumer");
  await mkdir(consumer);
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify(
      {
        name: "richtextweb-package-consumer",
        version: "1.0.0",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );
  const install = [
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--offline",
    join(temporary, packed.filename),
    `react@${manifest.devDependencies.react}`,
    `@types/react@${manifest.devDependencies["@types/react"]}`,
  ];
  if (process.env.RICHTEXTWEB_PACKAGE_OFFLINE !== "1")
    install.splice(install.indexOf("--offline"), 1);
  run(npm, install, consumer);

  const assertions = `
assert.equal(root.FlowDocument, core.FlowDocument, 'root/core must share model constructors');
assert.equal(root.RichTextEngine, core.RichTextEngine, 'root/core must share engine constructors');
assert.equal(root.RichTextBox, web.RichTextBox, 'root/web must share control constructors');
assert.equal(root.DocumentSerializer, formats.DocumentSerializer, 'root/formats must share serializer identity');
assert.equal(root.ObservableObject, mvvm.ObservableObject, 'root/mvvm must share observable constructors');
assert.equal(root.RichTextWebBridge, bridge.RichTextWebBridge, 'root/bridge must share bridge constructors');
assert.ok(react.RichTextEditor, 'optional React component must import');
const document = new core.FlowDocument(new core.Paragraph('published package'));
const engine = new root.RichTextEngine(document);
engine.Select(0, 9); engine.InsertText('installed');
assert.equal(document.Text, 'installed package');
engine.Undo(); assert.equal(document.Text, 'published package');
const imported = formats.fromMarkdown('**Rich text**');
assert.ok(imported instanceof core.FlowDocument, 'formats must construct the core FlowDocument type');
assert.equal(new core.TextPointer(imported, 0).Document, imported);
assert.match(formats.toHTML(imported), /Rich text/);
const model = new mvvm.ObservableObject({ Title: 'first' });
let title; const subscription = model.PropertyChanged.Subscribe(event => { title = event.NewValue; });
model.SetProperty('Title', 'second'); assert.equal(title, 'second'); subscription.Dispose();
const messages = []; const transport = new bridge.RichTextWebBridge(engine, message => messages.push(message));
const result = transport.HandleMessage({ channel: 'richtextweb', version: 1, kind: 'request', id: 'package-test', method: 'setDocument', params: { document: imported.ToJSON() } });
assert.equal(result.error, undefined, result.error?.message);
assert.ok(engine.Document instanceof core.FlowDocument, 'bridge must construct the core FlowDocument type');
assert.equal(engine.Document.Text, 'Rich text');
transport.Dispose(); engine.Dispose(); model.Dispose();
`;
  const entries = [
    ["root", ""],
    ["core", "/core"],
    ["web", "/web"],
    ["formats", "/formats"],
    ["mvvm", "/mvvm"],
    ["bridge", "/bridge"],
    ["react", "/react"],
  ];
  const esm = `import assert from 'node:assert/strict';\n${entries.map(([name, suffix]) => `import * as ${name} from '${manifest.name}${suffix}';`).join("\n")}\n${assertions}\nconsole.log('Installed ESM consumer passed.');\n`;
  const cjs = `const assert = require('node:assert/strict');\n${entries.map(([name, suffix]) => `const ${name} = require('${manifest.name}${suffix}');`).join("\n")}\n${assertions}\nconsole.log('Installed CommonJS consumer passed.');\n`;
  await writeFile(join(consumer, "consumer.mjs"), esm);
  await writeFile(join(consumer, "consumer.cjs"), cjs);
  process.stdout.write(run(process.execPath, ["consumer.mjs"], consumer));
  process.stdout.write(run(process.execPath, ["consumer.cjs"], consumer));

  const typeConsumer = `
import { FlowDocument, Paragraph, Run, RichTextEngine, TextPointer, TextElement } from '${manifest.name}/core';
import { RichTextBox } from '${manifest.name}/web';
import { toHTML, fromMarkdown, DocumentSerializer } from '${manifest.name}/formats';
import { ObservableObject, RelayCommand, Binding, BindingMode } from '${manifest.name}/mvvm';
import { RichTextEditor, type RichTextEditorProps } from '${manifest.name}/react';
import { RichTextWebBridge, type BridgeOutgoingMessage } from '${manifest.name}/bridge';
import { createElement } from 'react';
const document = new FlowDocument(new Paragraph(new Run('typed consumer')));
const engine = new RichTextEngine(document);
engine.ApplyProperty(TextElement.FontWeightProperty.Name, 'Bold');
const position: TextPointer = document.ContentStart;
const element = createElement(RichTextEditor, { document, onDocumentChange: next => console.log(next.Text) } satisfies RichTextEditorProps);
const reference: RichTextBox | null = null;
const html: string = toHTML(fromMarkdown('**typed**'));
const serialized: string = DocumentSerializer.Serialize(document);
const model = new ObservableObject({ Name: 'consumer' });
const command = new RelayCommand<string>(value => console.log(value));
const transport = new RichTextWebBridge(engine, (message: BridgeOutgoingMessage) => console.log(message.kind));
void [position, element, reference, html, serialized, model, command, transport, Binding, BindingMode];
`;
  await writeFile(join(consumer, "consumer.mts"), typeConsumer);
  await writeFile(
    join(consumer, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          lib: ["ES2022", "DOM", "DOM.Iterable"],
        },
        files: ["consumer.mts"],
      },
      null,
      2,
    ),
  );
  run(
    process.execPath,
    [join(root, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    consumer,
  );
  console.log(
    "Installed TypeScript consumer passed across all public entry points.",
  );

  const browserCode = await readFile(
    join(
      consumer,
      "node_modules",
      ...manifest.name.split("/"),
      "dist/richtextweb.global.js",
    ),
    "utf8",
  );
  const context = vm.createContext({
    EventTarget,
    TextEncoder,
    TextDecoder,
    URL,
    setTimeout,
    clearTimeout,
    console,
    atob,
    btoa,
    performance,
  });
  vm.runInContext(browserCode, context, {
    timeout: 10000,
    filename: "richtextweb.global.js",
  });
  assert.equal(typeof context.RichTextWeb?.FlowDocument, "function");
  const standalone = vm.runInContext(
    "new RichTextWeb.FlowDocument(new RichTextWeb.Paragraph('standalone')).Text",
    context,
  );
  assert.equal(standalone, "standalone");
  console.log(
    `Standalone browser bundle passed without module resolution. Tarball: ${packed.files.length} files, ${packed.size.toLocaleString()} bytes compressed.`,
  );
} catch (error) {
  if (error?.stdout) process.stderr.write(String(error.stdout));
  if (error?.stderr) process.stderr.write(String(error.stderr));
  throw error;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
