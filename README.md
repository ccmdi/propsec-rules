# propsec-rules

Typed, queryable frontmatter rules for Markdown.

## Why

Frontmatter is structured data with no structure enforced. Notes drift: a field gets renamed, an old one stays behind, a number is typed as a string.

JSON Schema can check one file's frontmatter. However, it can't express the parts that make a folder of notes a dataset, such as which notes a schema applies to (by folder, tag, or another property), a value that must be unique across every note, or a field compared to another field. Many tools can read across notes, but they don't check anything.

propsec-rules is both halves in one language. The rule that picks a schema's notes, the rule that checks a field, and the rule in a query are the same thing, evaluated by the same `propsec-rules` engine.

## Rules

```
file.inFolder("Books") || file.hasTag("book")         which notes a schema covers
size(it) >= 1 && size(it) <= 5                        what a field's value must be
it.exists(t, t.matches("^genre/"))                    some item matches a pattern
it >= started                                         compared to another property
status == "finished"                                  when a field applies at all
```

A rule reads properties by name (`rating`, or `note["date created"]` for names with spaces), the field's own value as `it`, and the file as `file`: `path`, `name`, `folder`, `tags`, `mtime`, `ctime`, `inFolder(...)`, `hasTag(...)`. It has `&&`, `||`, `!`, comparisons, `in`, arithmetic, `has(x)`, `size(x)`, `date(x)`, and methods like `matches`, `contains`, `startsWith`, `exists(x, ...)` and `all(x, ...)`.

The syntax follows [CEL](https://cel.dev), adjusted for frontmatter:

| Frontmatter reality | Rule behavior |
|---------------------|---------------|
| Properties are often missing | A missing property is `null`, not an error |
| YAML quoting is accidental | `"4"` and `4` compare as numbers |
| Numbers have no int/float split | All numbers are one type, `it + 1` just works |
| Values of different kinds | Never order against each other (`"abc" < 5` is false) |
| Negating a missing property | `!x` is only true when `x` is exactly `false` |

## What you get

- **Checks:** wrong types, missing required fields, failed rules, unknown fields, values duplicated across notes, malformed YAML. Each with a line and column.
- **Queries:** `propsec query 'file.inFolder("Books") && rating > 4 sort by rating desc limit 10'`
- **Editor support:** diagnostics, completion (fields a note's schema expects, values other notes already use), hover, go-to-definition, find references.
- **Rule authoring:** type-aware helpers ("at most N characters", "no duplicates"), completion inside rules, errors with positions, warnings for unknown properties, and a plain-words reading of any rule (`in Books or tagged #book`).

## Setup

```
npm install
npm test
```

### CLI

Runs from source for now:

```
npx tsx packages/cli/src/bin.ts check ./vault
npx tsx packages/cli/src/bin.ts query 'status == "reading" select title' ./vault --json
npx tsx packages/cli/src/bin.ts init ./vault
```

`check` exits 1 on errors and 2 on a rule that doesn't parse, so it works in CI. `init` writes a config from an Obsidian propsec plugin's `data.json`.

### VSCode

Open `clients/vscode` and press F5. In the new window, open a folder with a `propsec.config.json` at its root.

### Other editors

Build the server once and point your editor's LSP client at it for Markdown files:

```
npm run build --workspace propsec-vscode
node /path/to/propsec-rules/clients/vscode/dist/server.js --stdio
```

### As a library

```ts
import { compile, readConfig } from "@propsec/core";

const program = compile(readConfig(json));
for (const schema of program.schemas) {
    if (schema.matches(note)) report(schema.check(note));
}
```

`note` is a plain object: path, folder, name, tags, dates, and parsed frontmatter. `@propsec/engine` builds these from files on disk. Compiling a config takes well under a millisecond.

## Config

`propsec.config.json` at the root of the folder you open:

```json
{
  "schemas": [
    {
      "id": "book",
      "name": "Book",
      "enabled": true,
      "where": "file.inFolder(\"Books\") || file.hasTag(\"book\")",
      "fields": [
        { "name": "title", "type": "string", "required": true, "must": "size(it) >= 1" },
        { "name": "rating", "type": "number", "required": false, "must": "it >= 1 && it <= 5" },
        { "name": "isbn", "type": "string", "required": false, "unique": true, "when": "format == \"print\"" }
      ]
    }
  ],
  "types": [],
  "exclude": "file.hasTag(\"archived\")",
  "openFields": ["aliases", "tags", "cssclasses"]
}
```

| Key | Meaning |
|-----|---------|
| `where` | Rule picking the notes a schema covers |
| `when` | Rule for when a field applies |
| `must` | Rule a field's value must pass. Each part joined by `&&` is reported on its own |
| `exclude` | Rule removing notes from every schema |
| `unique` | Value must be unique across the schema's notes |
| `openFields` | Properties never reported as unknown |

Field types are `string`, `number`, `boolean`, `date`, `array`, `object`, `null`, `unknown`, or a custom type. A field can be `required`, `warn` (soft), or `unique`. Repeat a field name with different types for a union (`string` and `null` give `string | null`). Custom types are named groups of fields, and they nest.

## Development
See [docs/development.md](docs/development.md).