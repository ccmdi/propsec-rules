import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import {
    createConnection,
    StreamMessageReader,
    StreamMessageWriter,
    DiagnosticSeverity,
    CompletionItemKind,
    type CompletionItem,
    type Hover,
    type MarkupContent,
} from "vscode-languageserver/node";
import {
    createMessageConnection,
    StreamMessageReader as ClientReader,
    StreamMessageWriter as ClientWriter,
    NullLogger,
    type MessageConnection,
} from "vscode-jsonrpc/node";
import { URI } from "vscode-uri";
import { startServer } from "./server.js";

interface PublishDiagnosticsParams {
    uri: string;
    diagnostics: {
        range: { start: { line: number; character: number }; end: { line: number; character: number } };
        severity?: number;
        message: string;
        code?: string | number;
        source?: string;
    }[];
}

const CONFIG = JSON.stringify({
    schemaMappings: [
        {
            id: "book",
            name: "Book",
            sourceTemplatePath: null,
            query: "Books/*",
            enabled: true,
            fields: [
                { name: "title", type: "string", required: true },
                { name: "rating", type: "number", required: false },
            ],
        },
    ],
    customTypes: [],
    warnOnUnknownFields: true,
    allowObsidianProperties: true,
});

// title is a valid quoted string; `rating: great` is a string where a number is
// expected -> a single type_mismatch on line 2 (the `rating` key).
const NOTE = '---\ntitle: "1984"\nrating: great\n---\n\nbody\n';

describe("language server wire test (real JSON-RPC over in-memory streams)", () => {
    let root: string;
    let client: MessageConnection;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "propsec-lsp-"));
        await writeFile(join(root, "propsec.config.json"), CONFIG, "utf8");
        await mkdir(join(root, "Books"), { recursive: true });
        await writeFile(join(root, "Books", "1984.md"), NOTE, "utf8");
    });

    afterEach(async () => {
        client?.dispose();
        await rm(root, { recursive: true, force: true });
    });

    it("publishes a type_mismatch diagnostic for an opened note", async () => {
        // Cross-connected duplex pair.
        const clientToServer = new PassThrough();
        const serverToClient = new PassThrough();

        const serverConnection = createConnection(
            new StreamMessageReader(clientToServer),
            new StreamMessageWriter(serverToClient)
        );
        startServer(serverConnection);

        client = createMessageConnection(
            new ClientReader(serverToClient),
            new ClientWriter(clientToServer),
            NullLogger
        );

        const noteUri = URI.file(join(root, "Books", "1984.md")).toString();

        // Capture the first publishDiagnostics for our note.
        const gotDiagnostics = new Promise<PublishDiagnosticsParams>((resolveDiag, reject) => {
            const timer = setTimeout(
                () => reject(new Error("timed out waiting for publishDiagnostics")),
                5000
            );
            client.onNotification(
                "textDocument/publishDiagnostics",
                (params: PublishDiagnosticsParams) => {
                    if (params.uri === noteUri && params.diagnostics.length > 0) {
                        clearTimeout(timer);
                        resolveDiag(params);
                    }
                }
            );
        });

        client.listen();

        await client.sendRequest("initialize", {
            processId: null,
            rootUri: URI.file(root).toString(),
            capabilities: {},
            workspaceFolders: [{ uri: URI.file(root).toString(), name: "vault" }],
        });
        await client.sendNotification("initialized", {});

        await client.sendNotification("textDocument/didOpen", {
            textDocument: {
                uri: noteUri,
                languageId: "markdown",
                version: 1,
                text: NOTE,
            },
        });

        const params = await gotDiagnostics;

        expect(params.uri).toBe(noteUri);
        expect(params.diagnostics.length).toBeGreaterThanOrEqual(1);

        const d = params.diagnostics.find((x) => x.code === "type_mismatch");
        expect(d).toBeDefined();
        expect(d!.severity).toBe(DiagnosticSeverity.Error);
        expect(d!.source).toBe("propsec");
        // "rating" key sits on file line 2, column 0.
        expect(d!.range.start).toEqual({ line: 2, character: 0 });
        expect(d!.message.toLowerCase()).toContain("number");
    });

    it("clears diagnostics on didClose", async () => {
        const clientToServer = new PassThrough();
        const serverToClient = new PassThrough();
        const serverConnection = createConnection(
            new StreamMessageReader(clientToServer),
            new StreamMessageWriter(serverToClient)
        );
        startServer(serverConnection);

        client = createMessageConnection(
            new ClientReader(serverToClient),
            new ClientWriter(clientToServer),
            NullLogger
        );

        const noteUri = URI.file(join(root, "Books", "1984.md")).toString();
        const publishes: PublishDiagnosticsParams[] = [];
        client.onNotification("textDocument/publishDiagnostics", (p: PublishDiagnosticsParams) => {
            if (p.uri === noteUri) publishes.push(p);
        });

        client.listen();
        await client.sendRequest("initialize", {
            processId: null,
            rootUri: URI.file(root).toString(),
            capabilities: {},
            workspaceFolders: [{ uri: URI.file(root).toString(), name: "vault" }],
        });
        await client.sendNotification("initialized", {});
        await client.sendNotification("textDocument/didOpen", {
            textDocument: { uri: noteUri, languageId: "markdown", version: 1, text: NOTE },
        });

        // Wait until we see a non-empty publish.
        await viWaitFor(() => publishes.some((p) => p.diagnostics.length > 0), 5000);

        await client.sendNotification("textDocument/didClose", {
            textDocument: { uri: noteUri },
        });

        // Wait until we see the cleared (empty) publish.
        await viWaitFor(
            () => publishes.some((p) => p.diagnostics.length === 0),
            5000
        );
        const last = publishes[publishes.length - 1];
        expect(last.diagnostics).toEqual([]);
    });
});

// --- Completion + hover wire tests -----------------------------------------

// Book schema with title (string, required), rating (number), status (string).
// `status` is also seeded in another note so the value index has entries.
const CONFIG_CH = JSON.stringify({
    schemaMappings: [
        {
            id: "book",
            name: "Book",
            sourceTemplatePath: null,
            query: "Books/*",
            enabled: true,
            fields: [
                { name: "title", type: "string", required: true },
                { name: "rating", type: "number", required: false },
                { name: "status", type: "string", required: false },
            ],
        },
    ],
    customTypes: [],
    warnOnUnknownFields: true,
    allowObsidianProperties: true,
});

// Empty frontmatter -> KEY context on line 1 (no keys present, so all are offered).
const NOTE_EMPTY = "---\n\n---\n";
// A note with title present -> hover target on line 1.
const NOTE_TITLED = '---\ntitle: "Dune"\n---\n';
// Seeds a corpus `status` value so the value index is non-empty.
const NOTE_SEED = "---\nstatus: reading\n---\n";

/** Wire up a server+client duplex pair and run the LSP initialize handshake. */
async function connectAndInit(root: string): Promise<MessageConnection> {
    const clientToServer = new PassThrough();
    const serverToClient = new PassThrough();
    const serverConnection = createConnection(
        new StreamMessageReader(clientToServer),
        new StreamMessageWriter(serverToClient)
    );
    startServer(serverConnection);

    const conn = createMessageConnection(
        new ClientReader(serverToClient),
        new ClientWriter(clientToServer),
        NullLogger
    );
    conn.listen();

    await conn.sendRequest("initialize", {
        processId: null,
        rootUri: URI.file(root).toString(),
        capabilities: {},
        workspaceFolders: [{ uri: URI.file(root).toString(), name: "vault" }],
    });
    await conn.sendNotification("initialized", {});
    return conn;
}

describe("completion + hover wire test (real JSON-RPC requests)", () => {
    let root: string;
    let client: MessageConnection;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "propsec-lsp-ch-"));
        await writeFile(join(root, "propsec.config.json"), CONFIG_CH, "utf8");
        await mkdir(join(root, "Books"), { recursive: true });
        await writeFile(join(root, "Books", "x.md"), NOTE_EMPTY, "utf8");
        await writeFile(join(root, "Books", "hover.md"), NOTE_TITLED, "utf8");
        await writeFile(join(root, "Books", "seed.md"), NOTE_SEED, "utf8");
    });

    afterEach(async () => {
        client?.dispose();
        await rm(root, { recursive: true, force: true });
    });

    it("returns schema field completions at a key position", async () => {
        client = await connectAndInit(root);

        const uri = URI.file(join(root, "Books", "x.md")).toString();
        await client.sendNotification("textDocument/didOpen", {
            textDocument: { uri, languageId: "markdown", version: 1, text: NOTE_EMPTY },
        });

        // Cursor on the empty frontmatter line (line 1) -> KEY context.
        const items = (await client.sendRequest("textDocument/completion", {
            textDocument: { uri },
            position: { line: 1, character: 0 },
        })) as CompletionItem[];

        const labels = items.map((i) => i.label).sort();
        expect(labels).toEqual(["rating", "status", "title"]);

        const title = items.find((i) => i.label === "title")!;
        expect(title.kind).toBe(CompletionItemKind.Field);
        const rating = items.find((i) => i.label === "rating")!;
        expect(rating.kind).toBe(CompletionItemKind.Field);
    });

    it("offers corpus-observed values for a key from the value index", async () => {
        client = await connectAndInit(root);

        // Open the seed note so its `status: reading` enters the value index via the
        // open-doc overlay (deterministic; avoids racing the async disk reload).
        const seedUri = URI.file(join(root, "Books", "seed.md")).toString();
        await client.sendNotification("textDocument/didOpen", {
            textDocument: { uri: seedUri, languageId: "markdown", version: 1, text: NOTE_SEED },
        });

        // Open a note where we are typing a `status:` value.
        const uri = URI.file(join(root, "Books", "x.md")).toString();
        const typing = "---\nstatus: \n---\n";
        await client.sendNotification("textDocument/didOpen", {
            textDocument: { uri, languageId: "markdown", version: 1, text: typing },
        });

        // Cursor right after `status: ` (line 1, char 8) -> VALUE context.
        const items = (await client.sendRequest("textDocument/completion", {
            textDocument: { uri },
            position: { line: 1, character: 8 },
        })) as CompletionItem[];

        const statusValue = items.find((i) => i.label === "reading");
        expect(statusValue).toBeDefined();
        expect(statusValue!.kind).toBe(CompletionItemKind.Value);
    });

    it("returns a markdown hover over the title key with type and schema name", async () => {
        client = await connectAndInit(root);

        const uri = URI.file(join(root, "Books", "hover.md")).toString();
        await client.sendNotification("textDocument/didOpen", {
            textDocument: { uri, languageId: "markdown", version: 1, text: NOTE_TITLED },
        });

        // Hover over the `title` key (line 1, char 2).
        const hover = (await client.sendRequest("textDocument/hover", {
            textDocument: { uri },
            position: { line: 1, character: 2 },
        })) as Hover;

        expect(hover).not.toBeNull();
        const contents = hover.contents as MarkupContent;
        expect(contents.kind).toBe("markdown");
        expect(contents.value).toContain("`title`: string");
        expect(contents.value).toContain("from schema: **Book**");
    });

    it("returns [] completions and null hover when off the frontmatter", async () => {
        client = await connectAndInit(root);

        const uri = URI.file(join(root, "Books", "hover.md")).toString();
        await client.sendNotification("textDocument/didOpen", {
            textDocument: { uri, languageId: "markdown", version: 1, text: NOTE_TITLED },
        });

        // line 3 is past the closing fence (body region).
        const items = (await client.sendRequest("textDocument/completion", {
            textDocument: { uri },
            position: { line: 3, character: 0 },
        })) as CompletionItem[];
        expect(items).toEqual([]);

        const hover = (await client.sendRequest("textDocument/hover", {
            textDocument: { uri },
            position: { line: 3, character: 0 },
        })) as Hover | null;
        expect(hover).toBeNull();
    });
});

/** Minimal poll-until helper (avoids extra deps; resolves when predicate is true). */
function viWaitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
    return new Promise((resolveWait, reject) => {
        const start = Date.now();
        const tick = () => {
            if (predicate()) return resolveWait();
            if (Date.now() - start > timeoutMs) return reject(new Error("viWaitFor timed out"));
            setTimeout(tick, 20);
        };
        tick();
    });
}
