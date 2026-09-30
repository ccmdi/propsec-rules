# Development

```
npm install
npm test
```

## Layout

npm workspaces.

| Package | Role |
|---------|------|
| `@propsec/core` | Rule language, compiler, validation. Pure, no I/O |
| `@propsec/engine` | Reads and parses files, caches them, runs checks and queries |
| `@propsec/cli` | `check`, `query`, `init` |
| `@propsec/lsp` | Language server |
| `clients/vscode` | VSCode extension (bundles the server) |

## Performance

Validating 10,000 notes takes about 15 ms. Everything scales linearly with the number of notes.

The first load parses every file once and caches it in `<root>/.propsec/cache.json` (keyed by modification time), so later starts skip unchanged files. Add `.propsec/` to your `.gitignore`.

```
npm run bench --workspace @propsec/bench
```

## Status

Checks, queries, the CLI, the language server and the VSCode client all work.

Known gaps:
- Outside Obsidian, `file.tags` only reads the frontmatter `tags:` field (no inline `#tags` yet)

Planned:
- Rule helpers inside `propsec.config.json` in the editor
- Body-level features: inline `#tags`, `[[wikilinks]]`, tasks
- Completion inside nested types
