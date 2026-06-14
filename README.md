# mdlsp

Schema validation, autocomplete, and queries for Markdown frontmatter, in any editor. No Obsidian required.

This is the propsec Obsidian plugin pulled out of Obsidian. The same schema checking, plus completion, hover, navigation, and a typed query language, over plain Markdown files.

## Why

Frontmatter is freeform, so it drifts. You rename a field, leave an old one behind, type a number as a string. mdlsp checks your notes against schemas you define and shows you where they're wrong as you type. Your notes are untouched.

JSON Schema already handles per-file frontmatter checking. What it can't do is the vault-wide part: pick a schema from a note's own tags or folder, require a value to be unique across every note, or compare one field to another. That is the part mdlsp adds, and it works in any editor that speaks LSP.

## What you get

- Diagnostics: wrong types, missing required fields, failed constraints, unknown fields, values duplicated across files, malformed YAML. Each one with a line and column.
- Completion: the fields a note's schema expects (which schema depends on the note's tags and folder), plus values other notes already use for that field.
- Hover: a field's type, flags, constraints, and which schema it came from.
- Navigation: jump from a frontmatter key to its definition in the schema, and find every note that uses a field.
- Query: `propsec query "Books/* where rating > 4 sort by rating desc"`, run over the whole vault, with numeric and date comparisons.

## Setup

```
npm install
npm test
```

### VSCode

Open `clients/vscode` and press F5. In the window that opens, open a folder with a `propsec.config.json` at its root. Edit a note's frontmatter and you get diagnostics, completion, and hover.

### Other editors

Build the server once and point your editor's LSP client at it for Markdown files:

```
npm run build --workspace propsec-vscode
node /path/to/mdlsp/clients/vscode/dist/server.js --stdio
```

### CLI

Runs from source for now:

```
npx tsx packages/cli/src/bin.ts check ./vault
npx tsx packages/cli/src/bin.ts query "where status = reading" ./vault --json
npx tsx packages/cli/src/bin.ts init ./vault
```

`init` builds a config from an existing Obsidian propsec plugin's `data.json`. `check` exits non-zero when there are errors, so it works in CI.

## Config

A `propsec.config.json` at the root of the folder you open:

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
        { "name": "rating", "type": "number", "numberConstraints": { "max": 5 } },
        { "name": "isbn", "type": "string", "unique": true }
      ]
    }
  ],
  "customTypes": []
}
```

The `query` decides which notes a schema applies to: `folder`, `folder/*`, `#tag`, or `*`, combined with `and`, `or`, and `not`.

Field types are `string`, `number`, `boolean`, `date`, `array`, `object`, `null`, `unknown`, or a custom type. A field can be `required`, `warn` (a soft requirement), or `unique`. Repeat a field name with different types to make a union, so two `status` entries typed `string` and `null` give `string | null`. Custom types are named groups of fields, and they nest. Constraints cover patterns, min and max, length, item counts, and dates.

Tag matching currently reads the frontmatter `tags:` field only. Inline `#tags` in the body come later.

## Performance

Validation runs at around 140k files per second, and everything scales linearly with the number of notes. The first load parses every file once and writes the result to `<root>/.propsec/cache.json`, keyed by modification time, so later starts skip unchanged files. On a 10k-note vault that takes startup from about 5 seconds down to under one. Add `.propsec/` to your `.gitignore`.

Run the benchmark with `npm run bench --workspace @propsec/bench`.

## Layout

npm workspaces. `@propsec/core` is the pure logic (types, validation, query matching) with no I/O. `@propsec/engine` reads and parses files, builds the index, and caches it. `@propsec/cli` and `@propsec/lsp` are thin layers over those, and `clients/vscode` bundles the server into an extension.

## Status

Validation, the CLI, the LSP, and the VSCode client all work. Still to come: body-level features (inline `#tags`, `[[wikilinks]]`, tasks), completion inside nested types, and folding the original Obsidian plugin back onto this core so the two stop carrying duplicate code.

## License

MIT
