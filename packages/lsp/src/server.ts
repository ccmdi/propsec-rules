import {
    TextDocuments,
    TextDocumentSyncKind,
    DidChangeWatchedFilesNotification,
    type Connection,
    type Diagnostic,
    type InitializeParams,
    type InitializeResult,
} from "vscode-languageserver";
import { TextDocument } from "vscode-languageserver-textdocument";
import { URI } from "vscode-uri";
import { CorpusStore } from "./corpusStore.js";
import { computeDiagnostics } from "./diagnostics.js";
import { loadConfig, CONFIG_FILENAME } from "./config.js";

const DEBOUNCE_MS = 200;

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
            },
        };
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
