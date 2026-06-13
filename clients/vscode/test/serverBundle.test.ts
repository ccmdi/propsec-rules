import { describe, it, expect } from "vitest";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SERVER = resolve(__dirname, "..", "dist", "server.js");
const TIMEOUT_MS = 8000;

/** Frame a JSON-RPC message with an LSP Content-Length header. */
function frame(message: unknown): Buffer {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"), body]);
}

/**
 * Read framed LSP messages off the child's stdout and resolve with the first one
 * carrying the given request id.
 */
function readResponse(child: ChildProcessWithoutNullStreams, id: number): Promise<any> {
    return new Promise((resolvePromise, reject) => {
        let buf = Buffer.alloc(0);
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`timed out after ${TIMEOUT_MS}ms waiting for response id=${id}. stderr:\n${stderr}`));
        }, TIMEOUT_MS);
        let stderr = "";

        const onStderr = (d: Buffer) => { stderr += d.toString("utf8"); };

        const onData = (chunk: Buffer) => {
            buf = Buffer.concat([buf, chunk]);
            // Parse as many complete frames as are buffered.
            while (true) {
                const headerEnd = buf.indexOf("\r\n\r\n");
                if (headerEnd === -1) return;
                const header = buf.subarray(0, headerEnd).toString("ascii");
                const match = /Content-Length:\s*(\d+)/i.exec(header);
                if (!match) {
                    cleanup();
                    reject(new Error(`malformed header: ${header}`));
                    return;
                }
                const len = Number(match[1]);
                const start = headerEnd + 4;
                if (buf.length < start + len) return; // wait for full body
                const body = buf.subarray(start, start + len).toString("utf8");
                buf = buf.subarray(start + len);
                let msg: any;
                try {
                    msg = JSON.parse(body);
                } catch (e) {
                    cleanup();
                    reject(new Error(`invalid JSON body: ${body}`));
                    return;
                }
                if (msg.id === id) {
                    cleanup();
                    resolvePromise(msg);
                    return;
                }
                // Otherwise it's a notification/other response; keep reading.
            }
        };

        function cleanup() {
            clearTimeout(timer);
            child.stdout.off("data", onData);
            child.stderr.off("data", onStderr);
        }

        child.stdout.on("data", onData);
        child.stderr.on("data", onStderr);
    });
}

describe("bundled server (dist/server.js) speaks LSP under plain node", () => {
    it("responds to initialize with textDocumentSync capability", async () => {
        const dir = await mkdtemp(join(tmpdir(), "propsec-bundle-"));
        await writeFile(
            join(dir, "propsec.config.json"),
            JSON.stringify({ schemaMappings: {} }),
            "utf8",
        );

        const child = spawn(process.execPath, [SERVER, "--stdio"], {
            stdio: ["pipe", "pipe", "pipe"],
        });

        try {
            const initialize = {
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                    processId: null,
                    rootUri: pathToFileURL(dir).toString(),
                    capabilities: {},
                },
            };

            const responsePromise = readResponse(child, 1);
            child.stdin.write(frame(initialize));

            const response = await responsePromise;

            expect(response.result).toBeDefined();
            expect(response.result.capabilities).toBeDefined();
            // Incremental sync === 2. Server declares it; proves the bundle runs + negotiates.
            expect(response.result.capabilities.textDocumentSync).toBe(2);

            // Be a well-behaved client: initialized, then shutdown/exit.
            child.stdin.write(frame({ jsonrpc: "2.0", method: "initialized", params: {} }));
            const shutdownPromise = readResponse(child, 2);
            child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "shutdown" }));
            await shutdownPromise.catch(() => undefined); // best-effort
            child.stdin.write(frame({ jsonrpc: "2.0", method: "exit" }));
        } finally {
            if (!child.killed) child.kill();
            await rm(dir, { recursive: true, force: true });
        }
    });
});
