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
