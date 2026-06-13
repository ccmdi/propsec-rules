import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    TextDocuments,
    TextDocumentSyncKind,
    DidChangeWatchedFilesNotification,
    SymbolKind,
    type Connection,
    type Diagnostic,
    type InitializeParams,
    type InitializeResult,
    type CompletionItem,
    type Hover,
    type Location,
    type DocumentSymbol,
    type SymbolInformation,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { getMatchingSchemas, type PropsecConfig } from "@propsec/core";
import {
    buildFileMeta,
    buildValueIndex,
    computeCompletions,
    computeHover,
    keyAtPosition,
    findFieldReferences,
    documentFieldSymbols,
    parseFrontmatter,
    type CompletionContext,
} from "@propsec/engine";
import { CorpusStore } from "./corpusStore.js";
import { computeDiagnostics } from "./diagnostics.js";
import { suggestionToCompletionItem, hoverInfoToHover } from "./completion.js";
import { findFieldRange } from "./configLocate.js";
import { loadConfig, CONFIG_FILENAME } from "./config.js";

const EMPTY_CONFIG: PropsecConfig = { schemaMappings: [], customTypes: [] };

const DEBOUNCE_MS = 200;

/** Upper bound on workspace/symbol results (esp. for an empty query). */
const WORKSPACE_SYMBOL_CAP = 200;

/** Derive the workspace root (fs path) from initialize params. */
function rootFromParams(params: InitializeParams): string | null {
    const folder = params.workspaceFolders?.[0]?.uri;
    if (folder) return URI.parse(folder).fsPath;
    if (params.rootUri) return URI.parse(params.rootUri).fsPath;
    if (params.rootPath) return params.rootPath;
    return null;
}

/**
 * Wire a propsec language server onto an existing connection.
 * Tests pass a custom connection; `bin.ts` passes a stdio connection.
 */
export function startServer(connection: Connection): void {
    const documents = new TextDocuments(TextDocument);
    let store: CorpusStore | null = null;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    /**
     * Recompute and publish diagnostics. Phase 2 scope: publish for OPEN documents
     * ONLY (so cleared files are emptied). Whole-vault publishing is a later enhancement.
     */
    function revalidate(): void {
        if (!store) return;
        const map: Map<string, Diagnostic[]> = store.config
            ? computeDiagnostics(store.snapshot(), store.config)
            : new Map();

        for (const doc of documents.all()) {
            const relPath = store.uriToRelPath(doc.uri);
            connection.sendDiagnostics({ uri: doc.uri, diagnostics: map.get(relPath) ?? [] });
        }
    }

    function scheduleRevalidate(): void {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(revalidate, DEBOUNCE_MS);
    }

    connection.onInitialize((params: InitializeParams): InitializeResult => {
        const rootDir = rootFromParams(params);
        if (rootDir) {
            const config = loadConfig(rootDir, (m) => connection.console.error(m));
            store = new CorpusStore(rootDir, config);
            // Kick off the initial disk load, then validate whatever is already open.
            store
                .reload()
                .then(() => revalidate())
                .catch((err) => connection.console.error(`propsec: initial load failed: ${err}`));
        } else {
            connection.console.error("propsec: no workspace root; diagnostics disabled");
        }

        return {
            capabilities: {
                textDocumentSync: TextDocumentSyncKind.Incremental,
                completionProvider: { triggerCharacters: [":"], resolveProvider: false },
                hoverProvider: true,
                definitionProvider: true,
                referencesProvider: true,
                documentSymbolProvider: true,
                workspaceSymbolProvider: true,
            },
        };
    });

    /**
     * Build a completion/hover context from the LIVE document text (not the store
     * overlay, whose update is debounced). Returns null if the document is unknown
     * or the store hasn't initialized.
     */
    function contextFor(uri: string, position: CompletionContext["position"]): CompletionContext | null {
        if (!store) return null;
        const doc = documents.get(uri);
        if (!doc) return null;
        const text = doc.getText();
        const relPath = store.uriToRelPath(uri);
        const { meta } = buildFileMeta({ path: relPath, content: text, mtime: 0, ctime: 0 });
        return { fileMeta: meta, parsed: parseFrontmatter(text), text, position };
    }

    connection.onCompletion((params): CompletionItem[] => {
        const ctx = contextFor(params.textDocument.uri, params.position);
        if (!ctx) return [];
        const config = store!.config ?? EMPTY_CONFIG;
        const valueIndex = buildValueIndex(store!.snapshot());
        return computeCompletions(ctx, config, valueIndex).map(suggestionToCompletionItem);
    });

    connection.onHover((params): Hover | null => {
        const ctx = contextFor(params.textDocument.uri, params.position);
        if (!ctx) return null;
        const config = store!.config ?? EMPTY_CONFIG;
        const info = computeHover(ctx, config);
        return info ? hoverInfoToHover(info) : null;
    });

    /** URI of `<rootDir>/propsec.config.json`. */
    function configFileUri(): string {
        return URI.file(join(store!.rootDir, CONFIG_FILENAME)).toString();
    }

    // Go-to-definition: jump from a frontmatter key to its field def in propsec.config.json.
    connection.onDefinition((params): Location | Location[] | null => {
        const ctx = contextFor(params.textDocument.uri, params.position);
        if (!ctx) return null;
        const hk = keyAtPosition(ctx);
        if (!hk) return null;

        const schemas = getMatchingSchemas(ctx.fileMeta, store!.config ?? EMPTY_CONFIG);
        const lower = hk.key.toLowerCase();
        const defining = schemas.filter((s) =>
            s.fields.some((f) => f.name.toLowerCase() === lower)
        );
        if (defining.length === 0) return null;

        let configText: string;
        try {
            configText = readFileSync(join(store!.rootDir, CONFIG_FILENAME), "utf8");
        } catch {
            return null;
        }
        const uri = configFileUri();

        const locations: Location[] = [];
        for (const schema of defining) {
            const range = findFieldRange(configText, schema.id, hk.key);
            if (range) locations.push({ uri, range });
        }
        if (locations.length === 0) return null;
        return locations.length === 1 ? locations[0] : locations;
    });

    // Find-references: all notes whose schema defines the key and that have it present.
    connection.onReferences((params): Location[] => {
        const ctx = contextFor(params.textDocument.uri, params.position);
        if (!ctx) return [];
        const hk = keyAtPosition(ctx);
        if (!hk) return [];
        const config = store!.config ?? EMPTY_CONFIG;
        return findFieldReferences(store!.snapshot(), config, hk.key).map(({ path, range }) => ({
            uri: store!.relPathToUri(path),
            range,
        }));
    });

    // Document symbols: one Field symbol per top-level frontmatter key.
    connection.onDocumentSymbol((params): DocumentSymbol[] => {
        const ctx = contextFor(params.textDocument.uri, { line: 0, character: 0 });
        if (!ctx) return [];
        return documentFieldSymbols(ctx.parsed).map(({ name, range }) => ({
            name,
            kind: SymbolKind.Field,
            range,
            selectionRange: range,
        }));
    });

    // Workspace symbols: note files whose basename matches the query substring.
    connection.onWorkspaceSymbol((params): SymbolInformation[] => {
        if (!store) return [];
        const q = params.query.toLowerCase();
        const zero = { line: 0, character: 0 };
        const out: SymbolInformation[] = [];
        for (const file of store.snapshot()) {
            if (q && !file.meta.basename.toLowerCase().includes(q)) continue;
            out.push({
                name: file.meta.basename,
                kind: SymbolKind.File,
                location: {
                    uri: store.relPathToUri(file.meta.path),
                    range: { start: zero, end: zero },
                },
            });
            if (out.length >= WORKSPACE_SYMBOL_CAP) break;
        }
        return out;
    });

    connection.onInitialized(() => {
        // Watch the config file so edits/saves reload config + revalidate.
        connection.client
            .register(DidChangeWatchedFilesNotification.type, {
                watchers: [{ globPattern: `**/${CONFIG_FILENAME}` }],
            })
            .catch(() => {
                // Client may not support dynamic registration; config still loads on init.
            });
    });

    // Open + change: overlay the live text, then debounce-revalidate.
    documents.onDidChangeContent((e) => {
        if (!store) return;
        const relPath = store.uriToRelPath(e.document.uri);
        store.overlay(relPath, e.document.getText());
        scheduleRevalidate();
    });

    // Close: drop the overlay and clear that document's diagnostics.
    documents.onDidClose((e) => {
        if (!store) return;
        const relPath = store.uriToRelPath(e.document.uri);
        store.removeOverlay(relPath);
        connection.sendDiagnostics({ uri: e.document.uri, diagnostics: [] });
        scheduleRevalidate();
    });

    // Config (or other watched files) changed on disk: reload config + corpus, revalidate.
    connection.onDidChangeWatchedFiles((params) => {
        if (!store) return;
        const touchedConfig = params.changes.some((c) =>
            c.uri.endsWith(`/${CONFIG_FILENAME}`)
        );
        const reloadConfig = touchedConfig
            ? Promise.resolve().then(() => {
                  store!.config = loadConfig(store!.rootDir, (m) => connection.console.error(m));
              })
            : Promise.resolve();

        reloadConfig
            .then(() => store!.reload())
            .then(() => revalidate())
            .catch((err) => connection.console.error(`propsec: reload failed: ${err}`));
    });

    documents.listen(connection);
    connection.listen();
}
