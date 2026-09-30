import { describe, it, expect } from "vitest";
import { compile, migrate, type Program, type PropsecConfig, SchemaMapping } from "@propsec/core";
import { buildFileMeta } from "./fileMeta.js";
import type { CorpusFile } from "./corpus.js";
import { parseQuery, executeQuery } from "./query.js";

function schema(over: Partial<SchemaMapping> & Pick<SchemaMapping, "fields">): SchemaMapping {
    return {
        id: "book",
        name: "Book",
        sourceTemplatePath: null,
        query: "Books/*",
        enabled: true,
        ...over,
    };
}

function config(schemas: SchemaMapping[], over?: Partial<PropsecConfig>): Program {
    return compile(migrate({
            schemaMappings: schemas,
            customTypes: [],
            warnOnUnknownFields: true,
            allowObsidianProperties: true,
            ...over,
    }));
}

const file = (path: string, content: string): CorpusFile =>
    buildFileMeta({ path, content, mtime: 1, ctime: 1 });

const fm = (obj: Record<string, unknown>): string => {
    const body = Object.entries(obj)
        .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`)
        .join("\n");
    return `---\n${body}\n---\nbody\n`;
};

const BOOK_SCHEMA = schema({
    query: "Books/* or #book",
    fields: [
        { name: "title", type: "string", required: true },
        { name: "author", type: "string", required: true },
        { name: "rating", type: "number", required: false },
        { name: "tags", type: "array", required: false },
    ],
});

describe("parseQuery", () => {
    it("parses targeting-only", () => {
        const q = parseQuery("Books/*");
        expect(q.targeting).toBe("Books/*");
        expect(q.filters).toEqual([]);
        expect(q.sortBy).toBeUndefined();
        expect(q.limit).toBeUndefined();
        expect(q.select).toBeUndefined();
    });

    it("parses targeting with or/and DSL", () => {
        const q = parseQuery("Books/* or #book where rating > 4");
        expect(q.targeting).toBe("Books/* or #book");
        expect(q.filters).toEqual([{ field: "rating", operator: "greater_than", value: "4" }]);
    });

    it("parses where-only (no targeting)", () => {
        const q = parseQuery("where rating >= 3");
        expect(q.targeting).toBeUndefined();
        expect(q.filters).toEqual([{ field: "rating", operator: "greater_or_equal", value: "3" }]);
    });

    it("parses a full combo", () => {
        const q = parseQuery(
            "Books/* where rating > 4 and author = Herbert sort by rating desc limit 2 select title, rating"
        );
        expect(q.targeting).toBe("Books/*");
        expect(q.filters).toEqual([
            { field: "rating", operator: "greater_than", value: "4" },
            { field: "author", operator: "equals", value: "Herbert" },
        ]);
        expect(q.sortBy).toEqual({ field: "rating", dir: "desc" });
        expect(q.limit).toBe(2);
        expect(q.select).toEqual(["title", "rating"]);
    });

    it("is case-insensitive on keywords", () => {
        const q = parseQuery("Books/* WHERE rating > 4 SORT BY rating DESC LIMIT 1 SELECT title");
        expect(q.filters[0]).toEqual({ field: "rating", operator: "greater_than", value: "4" });
        expect(q.sortBy).toEqual({ field: "rating", dir: "desc" });
        expect(q.limit).toBe(1);
        expect(q.select).toEqual(["title"]);
    });

    it("handles quoted values with spaces", () => {
        const q = parseQuery('where author = "Frank Herbert"');
        expect(q.filters).toEqual([{ field: "author", operator: "equals", value: "Frank Herbert" }]);
    });

    it("does not treat a keyword inside a quoted value as a clause boundary", () => {
        const q = parseQuery('where title = "where the sort by limit lives"');
        expect(q.filters).toEqual([
            { field: "title", operator: "equals", value: "where the sort by limit lives" },
        ]);
        expect(q.sortBy).toBeUndefined();
        expect(q.limit).toBeUndefined();
    });

    it("maps every operator token to the right PropertyOperator", () => {
        const cases: Array<[string, string]> = [
            ["where a = 1", "equals"],
            ["where a == 1", "equals"],
            ["where a != 1", "not_equals"],
            ["where a > 1", "greater_than"],
            ["where a < 1", "less_than"],
            ["where a >= 1", "greater_or_equal"],
            ["where a <= 1", "less_or_equal"],
            ["where a contains x", "contains"],
            ["where a !contains x", "not_contains"],
            ["where a not contains x", "not_contains"],
        ];
        for (const [input, op] of cases) {
            expect(parseQuery(input).filters[0].operator).toBe(op);
        }
    });

    it("parses exists / missing / !exists / not exists (nullary)", () => {
        expect(parseQuery("where isbn exists").filters[0]).toEqual({
            field: "isbn",
            operator: "exists",
            value: "",
        });
        expect(parseQuery("where isbn missing").filters[0]).toEqual({
            field: "isbn",
            operator: "not_exists",
            value: "",
        });
        expect(parseQuery("where isbn !exists").filters[0].operator).toBe("not_exists");
        expect(parseQuery("where isbn not exists").filters[0].operator).toBe("not_exists");
    });

    it("defaults sort dir to asc", () => {
        expect(parseQuery("sort by title").sortBy).toEqual({ field: "title", dir: "asc" });
    });

    it("throws on a condition missing an operator", () => {
        expect(() => parseQuery("where rating")).toThrow(/operator/i);
    });

    it("throws on a condition missing a value", () => {
        expect(() => parseQuery("where rating >")).toThrow(/value/i);
    });

    it("throws on a non-integer limit", () => {
        expect(() => parseQuery("limit two")).toThrow(/integer/i);
        expect(() => parseQuery("limit 1.5")).toThrow(/integer/i);
    });

    it("throws on empty where", () => {
        expect(() => parseQuery("Books/* where")).toThrow(/where/i);
    });
});

describe("executeQuery — filtering", () => {
    const files = [
        file("Books/Dune.md", fm({ title: "Dune", author: "Frank Herbert", rating: 5 })),
        file("Books/Hobbit.md", fm({ title: "The Hobbit", author: "Tolkien", rating: 4 })),
        file("Books/Ten.md", fm({ title: "Ten", author: "X", rating: 10 })),
        file("Books/Nine.md", fm({ title: "Nine", author: "Y", rating: 9 })),
        file("Notes/todo.md", fm({ title: "todo" })),
    ];
    const cfg = config([BOOK_SCHEMA]);

    it("does NUMERIC comparison, not string (rating > 4 excludes 4, includes 5)", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* where rating > 4"));
        const paths = r.rows.map((x) => x.path).sort();
        expect(paths).toEqual(["Books/Dune.md", "Books/Nine.md", "Books/Ten.md"]);
        expect(paths).not.toContain("Books/Hobbit.md");
    });

    it("treats 10 > 9 numerically (guards the string-compare bug)", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* where rating > 9"));
        expect(r.rows.map((x) => x.path)).toEqual(["Books/Ten.md"]);

        const r2 = executeQuery(files, cfg, parseQuery("Books/* where rating >= 9"));
        expect(r2.rows.map((x) => x.path).sort()).toEqual(["Books/Nine.md", "Books/Ten.md"]);
    });

    it("scopes by targeting (Books/* excludes Notes/)", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/*"));
        expect(r.rows.map((x) => x.path)).not.toContain("Notes/todo.md");
        expect(r.rows).toHaveLength(4);
    });

    it("no targeting scans all files", () => {
        const r = executeQuery(files, cfg, parseQuery("where title exists"));
        expect(r.rows).toHaveLength(5);
    });

    it("ANDs multiple filters", () => {
        const r = executeQuery(
            files,
            cfg,
            parseQuery("Books/* where rating >= 5 and author = Frank Herbert")
        );
        expect(r.rows.map((x) => x.path)).toEqual(["Books/Dune.md"]);
    });

    it("exists / missing against frontmatter", () => {
        const r = executeQuery(files, cfg, parseQuery("where rating missing"));
        expect(r.rows.map((x) => x.path)).toEqual(["Notes/todo.md"]);

        const r2 = executeQuery(files, cfg, parseQuery("where rating exists"));
        expect(r2.rows.map((x) => x.path)).not.toContain("Notes/todo.md");
    });

    it("contains works on array frontmatter", () => {
        const tagged = [
            file("Books/A.md", fm({ title: "A", author: "a", tags: ["book", "scifi"] })),
            file("Books/B.md", fm({ title: "B", author: "b", tags: ["book"] })),
        ];
        const r = executeQuery(tagged, cfg, parseQuery("Books/* where tags contains scifi"));
        expect(r.rows.map((x) => x.path)).toEqual(["Books/A.md"]);
    });
});

describe("executeQuery — sorting", () => {
    const files = [
        file("Books/Ten.md", fm({ title: "Ten", rating: 10 })),
        file("Books/Five.md", fm({ title: "Five", rating: 5 })),
        file("Books/Nine.md", fm({ title: "Nine", rating: 9 })),
        file("Books/NoRating.md", fm({ title: "Zeta" })),
    ];
    const cfg = config([BOOK_SCHEMA]);

    it("sorts numeric asc with missing last", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* sort by rating asc"));
        expect(r.rows.map((x) => x.path)).toEqual([
            "Books/Five.md",
            "Books/Nine.md",
            "Books/Ten.md",
            "Books/NoRating.md",
        ]);
    });

    it("sorts numeric desc with missing still last", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* sort by rating desc"));
        expect(r.rows.map((x) => x.path)).toEqual([
            "Books/Ten.md",
            "Books/Nine.md",
            "Books/Five.md",
            "Books/NoRating.md",
        ]);
    });

    it("sorts strings asc/desc", () => {
        const asc = executeQuery(files, cfg, parseQuery("Books/* sort by title asc"));
        expect(asc.rows.map((x) => x.values.title)).toEqual(["Five", "Nine", "Ten", "Zeta"]);

        const desc = executeQuery(files, cfg, parseQuery("Books/* sort by title desc"));
        expect(desc.rows.map((x) => x.values.title)).toEqual(["Zeta", "Ten", "Nine", "Five"]);
    });

    it("sorts ISO dates chronologically, not lexically (same as numeric semantics)", () => {
        const dated = [
            file("Books/A.md", fm({ title: "A", published: "2020-01-05" })),
            file("Books/B.md", fm({ title: "B", published: "2020-01-10" })),
            file("Books/C.md", fm({ title: "C", published: "2019-12-31" })),
        ];
        const r = executeQuery(dated, cfg, parseQuery("Books/* sort by published asc"));
        expect(r.rows.map((x) => x.path)).toEqual(["Books/C.md", "Books/A.md", "Books/B.md"]);
    });
});

describe("executeQuery — limit, projection, warnings", () => {
    const files = [
        file("Books/Dune.md", fm({ title: "Dune", author: "Frank Herbert", rating: 5 })),
        file("Books/Hobbit.md", fm({ title: "The Hobbit", author: "Tolkien", rating: 4 })),
        file("Books/Ten.md", fm({ title: "Ten", author: "X", rating: 10 })),
    ];
    const cfg = config([BOOK_SCHEMA]);

    it("applies limit after sort", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* sort by rating desc limit 2"));
        expect(r.rows.map((x) => x.path)).toEqual(["Books/Ten.md", "Books/Dune.md"]);
    });

    it("select projects exactly those columns (case-insensitive lookup)", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* select Title, RATING"));
        expect(r.columns).toEqual(["Title", "RATING"]);
        const dune = r.rows.find((x) => x.path === "Books/Dune.md")!;
        expect(dune.values).toEqual({ Title: "Dune", RATING: 5 });
    });

    it("default columns = distinct referenced fields (filters + sortBy)", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* where rating > 0 sort by title"));
        expect(r.columns).toEqual(["rating", "title"]);
    });

    it("default columns empty when nothing referenced", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/*"));
        expect(r.columns).toEqual([]);
        expect(r.rows[0].values).toEqual({});
    });

    it("warns on a field not defined in any schema in scope", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* where bogus = 1"));
        expect(r.warnings).toContain('field "bogus" is not defined in any schema in scope');
    });

    it("does NOT warn on schema-defined fields", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* where rating > 4 sort by title select author"));
        expect(r.warnings).toEqual([]);
    });

    it("warns once per unknown field even if referenced repeatedly", () => {
        const r = executeQuery(files, cfg, parseQuery("Books/* where bogus > 1 sort by bogus select bogus"));
        const bogusWarnings = r.warnings.filter((w) => w.includes('"bogus"'));
        expect(bogusWarnings).toHaveLength(1);
    });

    it("no-targeting scope uses all schema fields", () => {
        const r = executeQuery(files, cfg, parseQuery("where rating > 4"));
        expect(r.warnings).toEqual([]);
    });
});
