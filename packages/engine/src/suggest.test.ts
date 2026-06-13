import { describe, it, expect } from "vitest";
import type { PropsecConfig, SchemaMapping, SchemaField } from "@propsec/core";
import { buildFileMeta } from "./fileMeta.js";
import { buildValueIndex, type ValueIndex } from "./valueIndex.js";
import {
    computeCompletions,
    computeHover,
    type CompletionContext,
} from "./suggest.js";
import type { Position } from "./position.js";

function schema(
    over: Partial<SchemaMapping> & Pick<SchemaMapping, "fields" | "query">
): SchemaMapping {
    return {
        id: over.query,
        name: "Schema",
        sourceTemplatePath: null,
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

function ctxFor(path: string, content: string, position: Position): CompletionContext {
    const { meta, parsed } = buildFileMeta({ path, content, mtime: 1, ctime: 1 });
    return { fileMeta: meta, parsed, text: content, position };
}

const EMPTY_INDEX: ValueIndex = new Map();

describe("computeCompletions - key context", () => {
    it("THE DIFFERENTIATOR: same cursor, different file -> different suggestions", () => {
        const book = schema({
            query: "Books/*",
            name: "Book",
            fields: [
                { name: "title", type: "string", required: true },
                { name: "author", type: "string", required: false },
                { name: "rating", type: "number", required: false },
            ],
        });
        const journal = schema({
            query: "Journal/*",
            name: "Journal",
            fields: [
                { name: "mood", type: "string", required: false },
                { name: "sleep", type: "number", required: false },
            ],
        });
        const cfg = config([book, journal]);

        // Empty frontmatter line (line 1) -> KEY context.
        const content = "---\n\n---\n";
        const keyPos: Position = { line: 1, character: 0 };

        const bookCtx = ctxFor("Books/x.md", content, keyPos);
        const journalCtx = ctxFor("Journal/y.md", content, keyPos);

        const bookLabels = computeCompletions(bookCtx, cfg, EMPTY_INDEX)
            .map((s) => s.label)
            .sort();
        const journalLabels = computeCompletions(journalCtx, cfg, EMPTY_INDEX)
            .map((s) => s.label)
            .sort();

        expect(bookLabels).toEqual(["author", "rating", "title"]);
        expect(journalLabels).toEqual(["mood", "sleep"]);
        expect(bookLabels).not.toEqual(journalLabels);
    });

    it("excludes already-present keys; detail shows type + (required)", () => {
        const s = schema({
            query: "Books/*",
            fields: [
                { name: "title", type: "string", required: true },
                { name: "author", type: "string", required: false },
            ],
        });
        // title already present; author missing.
        const content = "---\ntitle: Dune\n\n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 2, character: 0 });

        const out = computeCompletions(ctx, config([s]), EMPTY_INDEX);
        const labels = out.map((s) => s.label);
        expect(labels).toEqual(["author"]); // title excluded
    });

    it("required field detail includes type and (required); insertText is 'name: '", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "title", type: "string", required: true }],
        });
        const ctx = ctxFor("Books/x.md", "---\n\n---\n", { line: 1, character: 0 });
        const out = computeCompletions(ctx, config([s]), EMPTY_INDEX);
        const title = out.find((s) => s.label === "title")!;
        expect(title.kind).toBe("field");
        expect(title.detail).toBe("string (required)");
        expect(title.insertText).toBe("title: ");
    });

    it("recommended (warn) field shows (recommended); union types joined by ' | '", () => {
        const s = schema({
            query: "Books/*",
            fields: [
                { name: "x", type: "string", required: false, warn: true },
                { name: "x", type: "null", required: false, warn: true },
            ],
        });
        const ctx = ctxFor("Books/x.md", "---\n\n---\n", { line: 1, character: 0 });
        const out = computeCompletions(ctx, config([s]), EMPTY_INDEX);
        const x = out.find((s) => s.label === "x")!;
        expect(x.detail).toBe("string | null (recommended)");
    });

    it("documentation comes from the first variant with a description", () => {
        const s = schema({
            query: "Books/*",
            fields: [
                { name: "title", type: "string", required: true, description: "The book title" },
            ],
        });
        const ctx = ctxFor("Books/x.md", "---\n\n---\n", { line: 1, character: 0 });
        const out = computeCompletions(ctx, config([s]), EMPTY_INDEX);
        expect(out.find((s) => s.label === "title")!.documentation).toBe("The book title");
    });

    it("no matching schema -> []", () => {
        const s = schema({ query: "Books/*", fields: [{ name: "title", type: "string", required: true }] });
        const ctx = ctxFor("Notes/x.md", "---\n\n---\n", { line: 1, character: 0 });
        expect(computeCompletions(ctx, config([s]), EMPTY_INDEX)).toEqual([]);
    });
});

describe("computeCompletions - value context", () => {
    it("boolean field -> true/false", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "done", type: "boolean", required: false }],
        });
        const content = "---\ndone: \n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 6 });
        const out = computeCompletions(ctx, config([s]), EMPTY_INDEX);
        expect(out.map((s) => s.label)).toEqual(["true", "false"]);
        expect(out.every((s) => s.kind === "value")).toBe(true);
    });

    it("nullable field -> null", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "x", type: "null", required: false }],
        });
        const content = "---\nx: \n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 3 });
        const out = computeCompletions(ctx, config([s]), EMPTY_INDEX);
        expect(out.map((s) => s.label)).toContain("null");
    });

    it("corpus-derived values come from the valueIndex for that key", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "status", type: "string", required: false }],
        });
        // Build a corpus index that has status values.
        const corpus = [
            buildFileMeta({ path: "Books/a.md", content: "---\nstatus: draft\n---\n", mtime: 1, ctime: 1 }),
            buildFileMeta({ path: "Books/b.md", content: "---\nstatus: done\n---\n", mtime: 1, ctime: 1 }),
        ];
        const idx = buildValueIndex(corpus);

        const content = "---\nstatus: \n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 8 });
        const out = computeCompletions(ctx, config([s]), idx);
        expect(out.map((s) => s.label)).toEqual(["draft", "done"]);
        expect(out[0].insertText).toBe("draft");
    });

    it("offers corpus values even when key not in schema", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "title", type: "string", required: false }],
        });
        const idx: ValueIndex = new Map([["mood", ["happy", "sad"]]]);
        const content = "---\nmood: \n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 6 });
        const out = computeCompletions(ctx, config([s]), idx);
        expect(out.map((s) => s.label)).toEqual(["happy", "sad"]);
    });

    it("boolean + corpus values deduped by label", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "done", type: "boolean", required: false }],
        });
        const idx: ValueIndex = new Map([["done", ["true", "maybe"]]]);
        const content = "---\ndone: \n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 6 });
        const out = computeCompletions(ctx, config([s]), idx);
        // true (from boolean) not duplicated by corpus "true"; "maybe" appended.
        expect(out.map((s) => s.label)).toEqual(["true", "false", "maybe"]);
    });

    it("no schema field and no corpus values -> []", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "title", type: "string", required: false }],
        });
        const content = "---\nunknownkey: \n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 12 });
        expect(computeCompletions(ctx, config([s]), EMPTY_INDEX)).toEqual([]);
    });
});

describe("computeCompletions - guards", () => {
    it("position outside frontmatter (body) -> []", () => {
        const s = schema({ query: "Books/*", fields: [{ name: "title", type: "string", required: true }] });
        const content = "---\ntitle: X\n---\nbody text here\n";
        // line 3 is the body.
        const ctx = ctxFor("Books/x.md", content, { line: 3, character: 2 });
        expect(computeCompletions(ctx, config([s]), EMPTY_INDEX)).toEqual([]);
    });

    it("position on the closing fence line -> []", () => {
        const s = schema({ query: "Books/*", fields: [{ name: "title", type: "string", required: true }] });
        const content = "---\ntitle: X\n---\n";
        // closing fence is line 2 (== blockRange.end.line) -> excluded.
        const ctx = ctxFor("Books/x.md", content, { line: 2, character: 0 });
        expect(computeCompletions(ctx, config([s]), EMPTY_INDEX)).toEqual([]);
    });

    it("no frontmatter block at all -> []", () => {
        const s = schema({ query: "Books/*", fields: [{ name: "title", type: "string", required: true }] });
        const content = "just a body\n";
        const ctx = ctxFor("Books/x.md", content, { line: 0, character: 0 });
        expect(computeCompletions(ctx, config([s]), EMPTY_INDEX)).toEqual([]);
    });

    it("nested/indented line -> []", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "author", type: "object", required: false }],
        });
        const content = "---\nauthor:\n  name: A\n---\n";
        // line 2 is indented "  name: A".
        const ctx = ctxFor("Books/x.md", content, { line: 2, character: 8 });
        expect(computeCompletions(ctx, config([s]), EMPTY_INDEX)).toEqual([]);
    });

    it("list item line (- ) -> []", () => {
        const s = schema({
            query: "Books/*",
            fields: [{ name: "tags", type: "array", required: false }],
        });
        const content = "---\ntags:\n- one\n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 2, character: 5 });
        expect(computeCompletions(ctx, config([s]), EMPTY_INDEX)).toEqual([]);
    });
});

describe("computeHover", () => {
    it("hovering a key returns markdown with type, constraint, schema name, and description", () => {
        const s = schema({
            query: "Books/*",
            name: "Book",
            fields: [
                {
                    name: "title",
                    type: "string",
                    required: true,
                    description: "The book title",
                    stringConstraints: { minLength: 1, maxLength: 200 },
                },
            ],
        });
        const content = "---\ntitle: Dune\n---\n";
        // Hover on the "title" key (line 1, char 0-5).
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 2 });
        const hover = computeHover(ctx, config([s]));
        expect(hover).not.toBeNull();
        const md = hover!.contents;
        expect(md).toContain("`title`: string");
        expect(md).toContain("_(required)_");
        expect(md).toContain("The book title"); // description
        expect(md).toContain("minLength: 1"); // a constraint
        expect(md).toContain("maxLength: 200");
        expect(md).toContain("from schema: **Book**");
        // range equals the key's keyRange.
        expect(hover!.range).toEqual(ctx.parsed.positions.get("title")!.keyRange);
        expect(hover!.range!.start).toEqual({ line: 1, character: 0 });
    });

    it("optional + unique flags render", () => {
        const s = schema({
            query: "Books/*",
            name: "Book",
            fields: [{ name: "isbn", type: "string", required: false, unique: true }],
        });
        const content = "---\nisbn: '123'\n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 1 });
        const hover = computeHover(ctx, config([s]));
        expect(hover!.contents).toContain("(optional)");
        expect(hover!.contents).toContain("· unique");
    });

    it("number constraints render as bullets", () => {
        const s = schema({
            query: "Books/*",
            name: "Book",
            fields: [
                { name: "rating", type: "number", required: false, numberConstraints: { min: 0, max: 5 } },
            ],
        });
        const content = "---\nrating: 3\n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 2 });
        const hover = computeHover(ctx, config([s]));
        expect(hover!.contents).toContain("- min: 0");
        expect(hover!.contents).toContain("- max: 5");
    });

    it("key present but not in any matched schema -> not-defined hover", () => {
        const s = schema({
            query: "Books/*",
            name: "Book",
            fields: [{ name: "title", type: "string", required: true }],
        });
        const content = "---\nbogus: 1\n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 2 });
        const hover = computeHover(ctx, config([s]));
        expect(hover).not.toBeNull();
        expect(hover!.contents).toContain("not defined in the matching schema");
        expect(hover!.range).toEqual(ctx.parsed.positions.get("bogus")!.keyRange);
    });

    it("hovering a non-key / body position -> null", () => {
        const s = schema({
            query: "Books/*",
            name: "Book",
            fields: [{ name: "title", type: "string", required: true }],
        });
        const content = "---\ntitle: Dune\n---\nbody\n";
        // line 3 is the body, not a key.
        const ctx = ctxFor("Books/x.md", content, { line: 3, character: 1 });
        expect(computeHover(ctx, config([s]))).toBeNull();
    });

    it("hovering the value on a key line falls back to the key (per spec line fallback)", () => {
        const s = schema({
            query: "Books/*",
            name: "Book",
            fields: [{ name: "title", type: "string", required: true }],
        });
        const content = "---\ntitle: Dune\n---\n";
        // "title" key occupies chars 0-5; value "Dune" starts at char 7. Hover at char 8 = value.
        // Spec: line fallback resolves to the top-level key on the line.
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 8 });
        const hover = computeHover(ctx, config([s]));
        expect(hover).not.toBeNull();
        expect(hover!.contents).toContain("`title`: string");
        expect(hover!.range).toEqual(ctx.parsed.positions.get("title")!.keyRange);
    });

    it("multiple schemas defining the key list both", () => {
        const s1 = schema({
            query: "Books/*",
            name: "Book",
            fields: [{ name: "title", type: "string", required: true }],
        });
        const s2 = schema({
            query: "*",
            name: "Common",
            fields: [{ name: "title", type: "string", required: false }],
        });
        const content = "---\ntitle: Dune\n---\n";
        const ctx = ctxFor("Books/x.md", content, { line: 1, character: 2 });
        const hover = computeHover(ctx, config([s1, s2]));
        expect(hover!.contents).toContain("**Book**");
        expect(hover!.contents).toContain("**Common**");
    });
});
