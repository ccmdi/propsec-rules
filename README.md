# mdlsp — propsec for Markdown

**Schema validation, autocomplete, hover, navigation, and typed queries for Markdown frontmatter — in any editor, no Obsidian required.**

`mdlsp` generalizes the [propsec](https://github.com/ccmdi) Obsidian plugin into an editor-agnostic toolset: a language server (LSP), a CLI, and a reusable engine. You define schemas for your notes' frontmatter once, and get live diagnostics, context-aware completion, and a typed query language everywhere — your editor, your scripts, your CI.

> Status: Phases 0–4 complete (validation, engine, CLI, LSP, VSCode client) + persisted startup cache. 443 tests. Body-level features (inline `#tags`, `[[wikilinks]]`) are planned (Phase 5).

## Why this exists

Per-file frontmatter type-checking is already a solved problem — JSON Schema (via the YAML language server or `remark-lint-frontmatter-schema`) does it well. The value here is the **vault-aware** layer that JSON Schema *structurally cannot* do, plus the surface nobody offers editor-agnostically:

- **Content-based schema targeting** — which schema applies is decided by the note's *own* tags/path/properties (`#book or Books/*`), not a static filename glob. Autocomplete in `Books/` suggests different fields than `Journal/`.
- **Cross-file constraints** — `unique` across the whole corpus (e.g. no two notes share an `isbn`). Impossible in a single-document validator.
- **Cross-field constraints** — compare one field to another (`endDate >= startDate`).
- **Autocomplete + hover** for frontmatter keys/values, in any LSP editor.

The unifying idea: a single typed **index** of the corpus drives validation, completion, hover, navigation, and query — they're all just reads of one model.

## Features

- **Diagnostics** — type mismatches, missing required fields, constraint violations (regex/min/max/length/items/dates), unknown fields, malformed YAML, cross-file duplicates — with exact `line:col` ranges.
- **Completion** — schema fields at key positions (chosen by targeting); values from type (booleans/null) + values other notes already use for that field.
- **Hover** — a field's type, flags (required/optional/unique), constraints, source schema, and your `description` doc-strings.
- **Navigation** — go-to-definition (field → its schema declaration), find-references (field → notes using it), document & workspace symbols.
- **Typed query** — `propsec query "Books/* where rating > 4 sort by rating desc"`; numeric/date-aware, schema-validated field names.
- **Obsidian bridge** — generate a config from an existing propsec Obsidian plugin's `data.json`.

## Architecture

A monorepo (npm workspaces). The core is pure and I/O-free; everything else is a thin surface over it.

| Package | Role |
|---|---|
| `@propsec/core` | Pure kernel: type system, validation, query DSL + targeting over a `FileMeta` abstraction. No I/O, no Obsidian. |
| `@propsec/engine` | I/O + parsing: position-preserving YAML parse, `FileMeta` builder, cross-file `unique`, completion/hover compute, corpus value index, **persisted mtime parse cache**. |
| `@propsec/cli` | `propsec check`, `propsec query`, `propsec init`. |
| `@propsec/lsp` | Language server: diagnostics, completion, hover, definition, references, symbols. |
| `clients/vscode` | Minimal VSCode extension bundling the server. |
| `@propsec/bench` | Benchmark suite (scalability/perf). |

## Getting started

```bash
npm install      # wires the workspace
npm test         # run all package test suites (vitest)
```

### In VSCode

1. Open `clients/vscode` in VSCode and press **F5** (builds the server bundle + launches the Extension Development Host).
2. In the dev window, open a folder that has a `propsec.config.json` at its root.
3. Edit a note's frontmatter → diagnostics, autocomplete (start typing a key or `Ctrl+Space`), hover, F12 go-to-definition.

### In any other editor (Neovim, Zed, Helix, …)

Build the bundle once, then point your editor's LSP client at it:

```bash
npm run build --workspace propsec-vscode
# then configure your editor to launch, for markdown files:
node /path/to/mdlsp/clients/vscode/dist/server.js --stdio
```

### CLI

The CLI currently runs from source via `tsx` (a published binary is future work):

```bash
# validate a folder against its propsec.config.json
npx tsx packages/cli/src/bin.ts check ./my-vault

# typed query
npx tsx packages/cli/src/bin.ts query "Books/* where rating >= 4 sort by rating desc" ./my-vault
npx tsx packages/cli/src/bin.ts query "where status = reading" ./my-vault --json

# generate a config from an Obsidian propsec plugin's data.json
npx tsx packages/cli/src/bin.ts init ./my-vault            # auto-detects .obsidian/plugins/*propsec*/data.json
```

`check` exits non-zero when there are errors, so it drops straight into CI / pre-commit.

## Configuration

A `propsec.config.json` at the root of the folder you open / scan:

```json
{
  "schemaMappings": [
    {
      "id": "book",
      "name": "Book",
      "query": "Books/* or #book",
      "enabled": true,
      "fields": [
        { "name": "title", "type": "string", "required": true },
        { "name": "author", "type": "string", "required": true },
        { "name": "rating", "type": "number", "numberConstraints": { "max": 5 } },
        { "name": "status", "type": "string", "description": "reading | read | dnf" },
        { "name": "isbn", "type": "string", "unique": true }
      ]
    }
  ],
  "customTypes": [],
  "warnOnUnknownFields": true,
  "allowObsidianProperties": true
}
```

**Targeting DSL** (which files a schema applies to): `folder`, `folder/*` (recursive), `#tag`, `*` (all), combined with `and` / `or` / `not` — e.g. `Library/* and #book not #draft`.

**Query DSL**: `[<targeting>] [where <cond> [and <cond>]…] [sort by <field> [asc|desc]] [limit <n>] [select <fields>]`. Conditions use `=, !=, >, <, >=, <=, contains, exists, missing`.

**Field types**: `string`, `number`, `boolean`, `date`, `array`, `object`, `null`, `unknown`, or a custom type. Flags: `required` / `warn` / `unique`. A field name repeated with different types forms a **union** (e.g. two `series` entries → `string | null`). Per-type constraints: `stringConstraints` (pattern/minLength/maxLength), `numberConstraints` (min/max), `dateConstraints` (min/max), `arrayConstraints` (minItems/maxItems/contains). Also: conditional validation and cross-field constraints.

> Note: tag targeting currently matches **frontmatter** `tags:` only. Inline body `#tags` arrive with Phase 5.

## Performance

Linear in corpus size, and fast. From `@propsec/bench` (node 23, 12 cores), median ms:

| notes | cold load | **warm load** | validate | query | per-edit | completion |
|---|---|---|---|---|---|---|
| 1,000 | 555 | **89** | 8 | 6 | 8 | 0.9 |
| 10,000 | 5,300 | **800** | 70 | 46 | 73 | 16 |

- Validation is ~140k files/sec. Everything scales ~O(N).
- **Startup uses a persisted parse cache** (`<root>/.propsec/cache.json`, keyed by mtime+size): the first load parses everything once; subsequent starts skip unchanged files (~6.7× faster). Add `.propsec/` to your `.gitignore`.
- The only per-keystroke O(N) paths (revalidate, completion's value-index rebuild) stay interactive to ~10k notes; caching the value index and incremental revalidation are the levers for 50k+ vaults.

Run it yourself: `npm run bench --workspace @propsec/bench` (`--sizes 100,1000,10000`).

## Development

- Tests: `npx vitest run --root packages/<name>` per package (`core`, `engine`, `cli`, `lsp`, `bench`) or `npm test`.
- The VSCode client bundles the server from source via esbuild; after changing a server runtime dependency, verify through the **bundle** (`npm test --workspace propsec-vscode`), not just `vitest`.

## Roadmap

- **Phase 5 — body-level**: inline `#tags`, `[[wikilinks]]` (completion, go-to-def, backlinks, broken-link diagnostics), tasks, headings, Dataview inline fields — via incremental `tree-sitter-markdown`. Also unlocks inline-tag targeting.
- **Optimization pass**: cache the value index (O(1) completion), incremental per-edit revalidation, persisted corpus cache for instant warm starts — only needed at very large (50k+) vaults.
- Wire the original Obsidian plugin to consume `@propsec/core`; package/publish the CLI and VSCode extension.

## License

MIT
