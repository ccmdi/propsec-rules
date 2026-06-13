# Propsec — Markdown Frontmatter (VSCode)

A minimal VSCode extension that runs the `@propsec/lsp` language server so Markdown
frontmatter gets **live squiggles** as you type.

The extension ships two CommonJS bundles produced by esbuild:

- `dist/extension.js` — the VSCode client (activates on Markdown, spawns the server).
- `dist/server.js` — the `@propsec/lsp` server, fully bundled so it runs under **plain `node`**
  (the raw TS server can't, because `vscode-languageserver/node` has no `exports` map).

## Build

From the repo root:

```sh
npm install
npm run build --workspace propsec-vscode
```

Or from this folder:

```sh
npm run build
```

This writes `dist/extension.js` and `dist/server.js` (and source maps).

## Try it in VSCode

1. Open `clients/vscode` in VSCode.
2. Press **F5** ("Run Extension"). This builds and launches an **Extension Development Host**.
3. In the new window, **open a folder** that contains:
   - a `propsec.config.json` (your schema mappings), and
   - some Markdown files with frontmatter.
4. Open a Markdown file — invalid frontmatter is underlined with squiggles. Edits revalidate live;
   saving `propsec.config.json` reloads the config.

Example `propsec.config.json`:

```json
{
  "schemaMappings": {
    "*": { "title": "string", "rating": "number" }
  }
}
```

### Override the server path (optional)

Set `propsec.serverPath` in your settings to point at a different server bundle.
Leave it empty to use the bundled `dist/server.js`.

## Use from another editor (Neovim, Zed, …)

The bundled server is editor-agnostic — point any LSP client at it over stdio:

```
node /absolute/path/to/clients/vscode/dist/server.js --stdio
```

### Neovim (`vim.lsp.start`)

```lua
vim.lsp.start({
  name = "propsec",
  cmd = { "node", "/abs/path/to/clients/vscode/dist/server.js", "--stdio" },
  root_dir = vim.fs.dirname(vim.fs.find({ "propsec.config.json" }, { upward = true })[1]),
  filetypes = { "markdown" },
})
```

### Zed (`settings.json` / extension `lsp`)

Configure a custom language server with the command:

```
node /abs/path/to/clients/vscode/dist/server.js --stdio
```

scoped to the Markdown language, with the workspace root containing `propsec.config.json`.

## Test

```sh
npm run test --workspace propsec-vscode
```

This builds the bundles, then runs a headless handshake test (`test/serverBundle.test.ts`)
that spawns `node dist/server.js --stdio`, performs an LSP `initialize`, and asserts the
server returns `capabilities.textDocumentSync` — proving the bundled server runs under plain
node and speaks LSP, without launching the VSCode UI.
