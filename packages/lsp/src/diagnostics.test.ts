import { describe, it, expect } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver";
import type { PropsecConfig, SchemaMapping } from "@propsec/core";
import { buildFileMeta, type CorpusFile } from "@propsec/engine";
import { computeDiagnostics, violationToDiagnostic } from "./diagnostics.js";

function schema(over: Partial<SchemaMapping> & Pick<SchemaMapping, "fields">): SchemaMapping {
    return {
        id: "book",
        name: "Book",
        sourceTemplatePath: null,
        query: "Books",
        enabled: true,
        ...over,
    };
}

function config(schemas: SchemaMapping[], over?: Partial<PropsecConfig>): PropsecConfig {
    return {
        schemaMappings: schemas,
        customTypes: [],
        warnOnUnknownFields: true,
        allowObsidianProperties: true,
        ...over,
    };
}

const file = (path: string, content: string): CorpusFile =>
    buildFileMeta({ path, content, mtime: 1, ctime: 1 });

describe("violationToDiagnostic", () => {
    it("maps an error violation directly (range, code, source)", () => {
        const d = violationToDiagnostic({
            filePath: "a.md",
            schemaMapping: schema({ fields: [] }),
            field: "count",
            type: "type_mismatch",
            message: "Expected number",
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
        });
        expect(d).toEqual({
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
            severity: DiagnosticSeverity.Error,
            message: "Expected number",
            code: "type_mismatch",
            source: "propsec",
        });
    });

    it("maps a warning violation to Warning severity", () => {
        const d = violationToDiagnostic({
            filePath: "a.md",
            schemaMapping: schema({ fields: [] }),
            field: "extra",
            type: "unknown_field",
            message: "Unknown field",
            range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
        });
        expect(d.severity).toBe(DiagnosticSeverity.Warning);
        expect(d.code).toBe("unknown_field");
    });
});

describe("computeDiagnostics", () => {
    it("type_mismatch -> Error, range on the key, code+source set", () => {
        const s = schema({ fields: [{ name: "count", type: "number", required: true }] });
        const f = file("Books/a.md", "---\ncount: notanumber\n---\n");

        const map = computeDiagnostics([f], config([s]));
        const diags = map.get("Books/a.md");
        expect(diags).toBeDefined();

        const d = diags!.find((x) => x.code === "type_mismatch");
        expect(d).toBeDefined();
        expect(d!.severity).toBe(DiagnosticSeverity.Error);
        expect(d!.source).toBe("propsec");
        // "count" key is on file line 1, column 0
        expect(d!.range.start).toEqual({ line: 1, character: 0 });
    });

    it("unknown_field -> Warning severity", () => {
        const s = schema({ fields: [{ name: "title", type: "string", required: false }] });
        const f = file("Books/a.md", "---\ntitle: X\nbogus: 1\n---\n");

        const map = computeDiagnostics([f], config([s]));
        const d = map.get("Books/a.md")!.find((x) => x.code === "unknown_field");
        expect(d).toBeDefined();
        expect(d!.severity).toBe(DiagnosticSeverity.Warning);
        // bogus key is on file line 2
        expect(d!.range.start).toEqual({ line: 2, character: 0 });
    });

    it("missing_required -> Error, range = blockRange", () => {
        const s = schema({
            fields: [
                { name: "title", type: "string", required: true },
                { name: "isbn", type: "string", required: true },
            ],
        });
        const f = file("Books/a.md", "---\ntitle: X\n---\n");

        const map = computeDiagnostics([f], config([s]));
        const d = map.get("Books/a.md")!.find((x) => x.code === "missing_required");
        expect(d).toBeDefined();
        expect(d!.severity).toBe(DiagnosticSeverity.Error);
        expect(d!.range).toEqual(f.parsed.blockRange);
        expect(d!.range.start).toEqual({ line: 1, character: 0 });
    });

    it("cross-file duplicate `unique` -> a diagnostic on BOTH files", () => {
        const s = schema({
            query: "Books",
            fields: [{ name: "isbn", type: "string", required: true, unique: true }],
        });
        const a = file("Books/a.md", "---\nisbn: '123'\n---\n");
        const b = file("Books/b.md", "---\nisbn: '123'\n---\n");

        const map = computeDiagnostics([a, b], config([s]));

        const da = map.get("Books/a.md")!.find((x) => x.code === "duplicate_value");
        const db = map.get("Books/b.md")!.find((x) => x.code === "duplicate_value");
        expect(da).toBeDefined();
        expect(db).toBeDefined();
        expect(da!.severity).toBe(DiagnosticSeverity.Error);
        expect(db!.severity).toBe(DiagnosticSeverity.Error);
        // anchored on the isbn key (file line 1) in each file
        expect(da!.range.start).toEqual({ line: 1, character: 0 });
        expect(db!.range.start).toEqual({ line: 1, character: 0 });
        expect(da!.message).toContain("b");
        expect(db!.message).toContain("a");
    });

    it("files with zero violations do not appear in the map", () => {
        const s = schema({ fields: [{ name: "title", type: "string", required: true }] });
        const ok = file("Books/ok.md", "---\ntitle: Fine\n---\n");

        const map = computeDiagnostics([ok], config([s]));
        expect(map.has("Books/ok.md")).toBe(false);
        expect(map.size).toBe(0);
    });
});
