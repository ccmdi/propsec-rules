import { describe, it, expect } from "vitest";
import type { PropsecConfig, SchemaMapping } from "@propsec/core";
import { buildFileMeta } from "./fileMeta.js";
import { validateCorpus, type LocatedViolation } from "./validate.js";

function schema(over: Partial<SchemaMapping> & Pick<SchemaMapping, "fields">): SchemaMapping {
    return {
        id: "s1",
        name: "Schema",
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

const file = (path: string, content: string) =>
    buildFileMeta({ path, content, mtime: 1, ctime: 1 });

function find(viols: LocatedViolation[], type: string, field?: string) {
    return viols.find((v) => v.type === type && (field === undefined || v.field === field));
}

describe("validateCorpus", () => {
    it("type_mismatch: range anchored on the key", () => {
        const s = schema({ fields: [{ name: "count", type: "number", required: true }] });
        const f = file("Books/a.md", "---\ncount: notanumber\n---\n");
        const viols = validateCorpus([f], config([s]));

        const v = find(viols, "type_mismatch", "count");
        expect(v).toBeDefined();
        // "count" key is on file line 1, column 0
        expect(v!.range.start).toEqual({ line: 1, character: 0 });
    });

    it("unknown_field: dropped when it's an obsidian-native prop + allowObsidianProperties", () => {
        const s = schema({ fields: [{ name: "title", type: "string", required: false }] });
        const f = file("Books/a.md", "---\ntitle: X\naliases:\n  - Y\n---\n");

        const dropped = validateCorpus([f], config([s], { allowObsidianProperties: true }));
        expect(find(dropped, "unknown_field", "aliases")).toBeUndefined();

        const kept = validateCorpus([f], config([s], { allowObsidianProperties: false }));
        const v = find(kept, "unknown_field", "aliases");
        expect(v).toBeDefined();
        // aliases key is on file line 2
        expect(v!.range.start).toEqual({ line: 2, character: 0 });
    });

    it("non-obsidian unknown_field is always reported with key range", () => {
        const s = schema({ fields: [{ name: "title", type: "string", required: false }] });
        const f = file("Books/a.md", "---\ntitle: X\nbogus: 1\n---\n");
        const viols = validateCorpus([f], config([s]));
        const v = find(viols, "unknown_field", "bogus");
        expect(v).toBeDefined();
        expect(v!.range.start).toEqual({ line: 2, character: 0 });
    });

    it("missing_required: range = blockRange", () => {
        const s = schema({
            fields: [
                { name: "title", type: "string", required: true },
                { name: "isbn", type: "string", required: true },
            ],
        });
        const f = file("Books/a.md", "---\ntitle: X\n---\n");
        const viols = validateCorpus([f], config([s]));

        const v = find(viols, "missing_required", "isbn");
        expect(v).toBeDefined();
        expect(v!.range).toEqual(f.parsed.blockRange);
        expect(v!.range.start).toEqual({ line: 1, character: 0 });
    });

    it("cross-file duplicate unique: both files get duplicate_value", () => {
        const s = schema({
            query: "Books",
            fields: [{ name: "isbn", type: "string", required: true, unique: true }],
        });
        const a = file("Books/a.md", "---\nisbn: '123'\n---\n");
        const b = file("Books/b.md", "---\nisbn: '123'\n---\n");
        const c = file("Books/c.md", "---\nisbn: '999'\n---\n");

        const viols = validateCorpus([a, b, c], config([s]));
        const dups = viols.filter((v) => v.type === "duplicate_value");

        expect(dups.length).toBe(2);
        const paths = dups.map((d) => d.filePath).sort();
        expect(paths).toEqual(["Books/a.md", "Books/b.md"]);
        // each names the other in its message
        const va = dups.find((d) => d.filePath === "Books/a.md")!;
        expect(va.message).toContain("b");
        expect(va.actual).toBe("123");
        // anchored on the isbn key (file line 1)
        expect(va.range.start).toEqual({ line: 1, character: 0 });
        // the unique value with no duplicate is not flagged
        expect(dups.find((d) => d.filePath === "Books/c.md")).toBeUndefined();
    });

    it("malformed file: emits malformed_frontmatter on blockRange", () => {
        const s = schema({ fields: [{ name: "title", type: "string", required: true }] });
        const f = file("Books/a.md", "---\nfoo: [unclosed\n---\n");
        const viols = validateCorpus([f], config([s]));

        const v = find(viols, "malformed_frontmatter", "frontmatter");
        expect(v).toBeDefined();
        expect(v!.range).toEqual(f.parsed.blockRange);
    });

    it("nested array-index path (tags[0]) falls back to top-level key range", () => {
        const s = schema({
            fields: [{ name: "tags", type: "array", required: false, arrayElementType: "number" }],
        });
        // element is a string but array element type is number -> field "tags[0]"
        const f = file("Books/a.md", "---\ntags:\n  - notanumber\n---\n");
        const viols = validateCorpus([f], config([s], { allowObsidianProperties: false }));

        const v = viols.find((x) => x.field === "tags[0]");
        expect(v).toBeDefined();
        expect(v!.type).toBe("type_mismatch");
        // falls back to the top-level "tags" key range (file line 1)
        expect(v!.range.start).toEqual({ line: 1, character: 0 });
    });

    it("nested dotted path (author.bogus) falls back to top-level key range", () => {
        const customTypes = [
            {
                id: "ct1",
                name: "person",
                fields: [{ name: "name", type: "string", required: true }],
            },
        ];
        const s = schema({ fields: [{ name: "author", type: "person", required: true }] });
        // author is a valid person but has an unknown nested field -> field "author.bogus"
        const f = file("Books/a.md", "---\nauthor:\n  name: A\n  bogus: 1\n---\n");
        const viols = validateCorpus([f], config([s], { customTypes }));

        const v = viols.find((x) => x.field === "author.bogus");
        expect(v).toBeDefined();
        // falls back to the top-level "author" key range (file line 1)
        expect(v!.range.start).toEqual({ line: 1, character: 0 });
    });

    it("files not matching a schema produce no schema violations", () => {
        const s = schema({ query: "Books", fields: [{ name: "title", type: "string", required: true }] });
        const f = file("Notes/a.md", "---\nx: 1\n---\n");
        const viols = validateCorpus([f], config([s]));
        // not in Books/, so no missing_required; unknown_field also requires a matched schema
        expect(viols.filter((v) => v.type !== "malformed_frontmatter")).toEqual([]);
    });
});
