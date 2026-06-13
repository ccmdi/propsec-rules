import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../..");

const common = {
    bundle: true,
    platform: "node",
    format: "cjs",
    sourcemap: true,
    target: "node18",
    logLevel: "warning",
    // Prefer ESM entry points: jsonc-parser's UMD `main` does a dynamic
    // require("./impl/format") that esbuild can't statically bundle (crashes at
    // runtime); its `module` (ESM) entry uses static imports that bundle cleanly.
    mainFields: ["module", "main"],
};

// The extension runs inside VS Code's host, which provides `vscode` at runtime —
// it must never be bundled.
const extension = {
    ...common,
    entryPoints: [resolve(__dirname, "src/extension.ts")],
    outfile: resolve(__dirname, "dist/extension.js"),
    external: ["vscode"],
};

// The server runs as a standalone child process under plain `node`, so EVERYTHING
// is bundled — including @propsec/* and vscode-languageserver/node, whose missing
// exports map otherwise breaks bare-node ESM resolution.
const server = {
    ...common,
    entryPoints: [resolve(repoRoot, "packages/lsp/src/bin.ts")],
    outfile: resolve(__dirname, "dist/server.js"),
    external: [],
};

function kib(file) {
    return (statSync(file).size / 1024).toFixed(1);
}

await Promise.all([build(extension), build(server)]);

console.log(`built dist/extension.js (${kib(extension.outfile)} KiB)`);
console.log(`built dist/server.js    (${kib(server.outfile)} KiB)`);
