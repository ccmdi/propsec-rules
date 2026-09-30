import { describe, it, expect } from "vitest";
import { compile, migrate, type Program, type PropsecConfig, SchemaMapping } from "@propsec/core";
import { buildFileMeta } from "./fileMeta.js";
import type { CorpusFile } from "./corpus.js";
import { keyAtPosition, type CompletionContext } from "./suggest.js";
import { findFieldReferences, documentFieldSymbols } from "./nav.js";
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

function config(schemas: SchemaMapping[]): Program {
    return compile(migrate({
            schemaMappings: schemas,
            customTypes: [],
            warnOnUnknownFields: true,
            allowObsidianProperties: true,
    }));
}

function corpusFile(path: string, content: string): CorpusFile {
    const { meta, parsed } = buildFileMeta({ path, content, mtime: 1, ctime: 1 });
    return { meta, parsed };
}

function ctxFor(path: string, content: string, position: Position): CompletionContext {
    const { meta, parsed } = buildFileMeta({ path, content, mtime: 1, ctime: 1 });
    return { fileMeta: meta, parsed, text: content, position };
}

describe("keyAtPosition", () => {
    const content = '---\ntitle: "Dune"\nrating: 5\n---\n\nbody\n';

    it("returns key + range when the cursor is on a key", () => {
        const hk = keyAtPosition(ctxFor("Books/a.md", content, { line: 1, character: 2 }));
        expect(hk).not.toBeNull();
        expect(hk!.key).toBe("title");
        expect(hk!.range.start).toEqual({ line: 1, character: 0 });
        expect(hk!.range.end).toEqual({ line: 1, character: 5 });
    });

    it("returns null off any key (body region)", () => {
        const hk = keyAtPosition(ctxFor("Books/a.md", content, { line: 5, character: 0 }));
        expect(hk).toBeNull();
    });

    it("returns null on a blank frontmatter line", () => {
        const c = "---\n\ntitle: x\n---\n";
        const hk = keyAtPosition(ctxFor("Books/a.md", c, { line: 1, character: 0 }));
        expect(hk).toBeNull();
    });
});

describe("findFieldReferences", () => {
    const book = schema({
        query: "Books/*",
        name: "Book",
        fields: [
            { name: "title", type: "string", required: true },
            { name: "rating", type: "number", required: false },
        ],
    });

    it("returns both notes that match a defining schema and have the key", () => {
        const cfg = config([book]);
        const files = [
            corpusFile("Books/a.md", '---\ntitle: "A"\n---\n'),
            corpusFile("Books/b.md", '---\ntitle: "B"\n---\n'),
        ];
        const refs = findFieldReferences(files, cfg, "title");
        expect(refs.map((r) => r.path)).toEqual(["Books/a.md", "Books/b.md"]);
        expect(refs[0].range.start).toEqual({ line: 1, character: 0 });
    });

    it("excludes a note where no schema defines the key", () => {
        const cfg = config([book]);
        const files = [
            corpusFile("Books/a.md", '---\ntitle: "A"\n---\n'),
            // Journal note: no schema matches it at all -> excluded even though it has `title`.
            corpusFile("Journal/j.md", '---\ntitle: "J"\n---\n'),
        ];
        const refs = findFieldReferences(files, cfg, "title");
        expect(refs.map((r) => r.path)).toEqual(["Books/a.md"]);
    });

    it("excludes a note that matches the schema but lacks the key", () => {
        const cfg = config([book]);
        const files = [
            corpusFile("Books/a.md", '---\ntitle: "A"\n---\n'),
            // Matches Book schema but has only `rating`, not `title`.
            corpusFile("Books/c.md", "---\nrating: 5\n---\n"),
        ];
        const refs = findFieldReferences(files, cfg, "title");
        expect(refs.map((r) => r.path)).toEqual(["Books/a.md"]);
    });

    it("is case-insensitive on the key name", () => {
        const cfg = config([book]);
        const files = [corpusFile("Books/a.md", '---\nTitle: "A"\n---\n')];
        const refs = findFieldReferences(files, cfg, "TITLE");
        expect(refs.map((r) => r.path)).toEqual(["Books/a.md"]);
    });
});

describe("documentFieldSymbols", () => {
    it("returns one symbol per top-level key with original casing and keyRange", () => {
        const { parsed } = buildFileMeta({
            path: "Books/a.md",
            content: '---\nTitle: "Dune"\nrating: 5\n---\n',
            mtime: 1,
            ctime: 1,
        });
        const syms = documentFieldSymbols(parsed);
        expect(syms.map((s) => s.name).sort()).toEqual(["Title", "rating"]);

        const title = syms.find((s) => s.name === "Title")!;
        expect(title.range.start).toEqual({ line: 1, character: 0 });
        expect(title.range.end).toEqual({ line: 1, character: 5 });
        const rating = syms.find((s) => s.name === "rating")!;
        expect(rating.range.start).toEqual({ line: 2, character: 0 });
    });

    it("returns [] when there is no frontmatter", () => {
        const { parsed } = buildFileMeta({
            path: "Books/a.md",
            content: "no frontmatter here\n",
            mtime: 1,
            ctime: 1,
        });
        expect(documentFieldSymbols(parsed)).toEqual([]);
    });
});
