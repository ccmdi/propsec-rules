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
    it("parses a rule-only query", () => {
        const q = parseQuery('file.inFolder("Books")');
        expect(q.filter).toBe('file.inFolder("Books")');
        expect(q.sortBy).toBeUndefined();
        expect(q.limit).toBeUndefined();
        expect(q.select).toBeUndefined();
    });

    it("parses a full combo", () => {
        const q = parseQuery('file.inFolder("Books") && rating > 4 sort by rating desc limit 2 select title, rating');
        expect(q.filter).toBe('file.inFolder("Books") && rating > 4');
        expect(q.sortBy).toEqual({ field: "rating", dir: "desc" });
        expect(q.limit).toBe(2);
        expect(q.select).toEqual(["title", "rating"]);
    });

    it("is case-insensitive on clause keywords", () => {
        const q = parseQuery("rating > 4 SORT BY rating DESC LIMIT 1 SELECT title");
        expect(q.filter).toBe("rating > 4");
        expect(q.sortBy).toEqual({ field: "rating", dir: "desc" });
        expect(q.limit).toBe(1);
        expect(q.select).toEqual(["title"]);
    });

    it("does not treat a keyword inside a string as a clause boundary", () => {
        const q = parseQuery('title == "where the sort by limit lives"');
        expect(q.filter).toBe('title == "where the sort by limit lives"');
        expect(q.sortBy).toBeUndefined();
        expect(q.limit).toBeUndefined();
    });

    it("accepts clauses with no rule", () => {
        const q = parseQuery("sort by title");
        expect(q.filter).toBeUndefined();
        expect(q.sortBy).toEqual({ field: "title", dir: "asc" });
    });

    it("throws on a rule that does not parse", () => {
        expect(() => parseQuery("rating >")).toThrow();
        expect(() => parseQuery("Books/*")).toThrow();
    });

    it("throws on a non-integer limit", () => {
        expect(() => parseQuery("limit two")).toThrow(/integer/i);
        expect(() => parseQuery("limit 1.5")).toThrow(/integer/i);
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
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") && rating > 4'));
        const paths = r.rows.map((x) => x.path).sort();
        expect(paths).toEqual(["Books/Dune.md", "Books/Nine.md", "Books/Ten.md"]);
        expect(paths).not.toContain("Books/Hobbit.md");
    });

    it("treats 10 > 9 numerically (guards the string-compare bug)", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") && rating > 9'));
        expect(r.rows.map((x) => x.path)).toEqual(["Books/Ten.md"]);

        const r2 = executeQuery(files, cfg, parseQuery('file.inFolder("Books") && rating >= 9'));
        expect(r2.rows.map((x) => x.path).sort()).toEqual(["Books/Nine.md", "Books/Ten.md"]);
    });

    it("filters by folder (Books excludes Notes)", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books")'));
        expect(r.rows.map((x) => x.path)).not.toContain("Notes/todo.md");
        expect(r.rows).toHaveLength(4);
    });

    it("a rule on a property scans all files", () => {
        const r = executeQuery(files, cfg, parseQuery("has(title)"));
        expect(r.rows).toHaveLength(5);
    });

    it("combines conditions with &&", () => {
        const r = executeQuery(
            files,
            cfg,
            parseQuery('file.inFolder("Books") && rating >= 5 && author == "Frank Herbert"')
        );
        expect(r.rows.map((x) => x.path)).toEqual(["Books/Dune.md"]);
    });

    it("has() tests presence in frontmatter", () => {
        const r = executeQuery(files, cfg, parseQuery("!has(rating)"));
        expect(r.rows.map((x) => x.path)).toEqual(["Notes/todo.md"]);

        const r2 = executeQuery(files, cfg, parseQuery("has(rating)"));
        expect(r2.rows.map((x) => x.path)).not.toContain("Notes/todo.md");
    });

    it("contains works on tag frontmatter", () => {
        const tagged = [
            file("Books/A.md", fm({ title: "A", author: "a", tags: ["book", "scifi"] })),
            file("Books/B.md", fm({ title: "B", author: "b", tags: ["book"] })),
        ];
        const r = executeQuery(tagged, cfg, parseQuery('file.inFolder("Books") && tags.contains("scifi")'));
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
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") sort by rating asc'));
        expect(r.rows.map((x) => x.path)).toEqual([
            "Books/Five.md",
            "Books/Nine.md",
            "Books/Ten.md",
            "Books/NoRating.md",
        ]);
    });

    it("sorts numeric desc with missing still last", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") sort by rating desc'));
        expect(r.rows.map((x) => x.path)).toEqual([
            "Books/Ten.md",
            "Books/Nine.md",
            "Books/Five.md",
            "Books/NoRating.md",
        ]);
    });

    it("sorts strings asc/desc", () => {
        const asc = executeQuery(files, cfg, parseQuery('file.inFolder("Books") sort by title asc'));
        expect(asc.rows.map((x) => x.values.title)).toEqual(["Five", "Nine", "Ten", "Zeta"]);

        const desc = executeQuery(files, cfg, parseQuery('file.inFolder("Books") sort by title desc'));
        expect(desc.rows.map((x) => x.values.title)).toEqual(["Zeta", "Ten", "Nine", "Five"]);
    });

    it("sorts ISO dates chronologically, not lexically (same as numeric semantics)", () => {
        const dated = [
            file("Books/A.md", fm({ title: "A", published: "2020-01-05" })),
            file("Books/B.md", fm({ title: "B", published: "2020-01-10" })),
            file("Books/C.md", fm({ title: "C", published: "2019-12-31" })),
        ];
        const r = executeQuery(dated, cfg, parseQuery('file.inFolder("Books") sort by published asc'));
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
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") sort by rating desc limit 2'));
        expect(r.rows.map((x) => x.path)).toEqual(["Books/Ten.md", "Books/Dune.md"]);
    });

    it("select projects exactly those columns (case-insensitive lookup)", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") select Title, RATING'));
        expect(r.columns).toEqual(["Title", "RATING"]);
        const dune = r.rows.find((x) => x.path === "Books/Dune.md")!;
        expect(dune.values).toEqual({ Title: "Dune", RATING: 5 });
    });

    it("default columns = distinct properties the rule reads, then sortBy", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") && rating > 0 sort by title'));
        expect(r.columns).toEqual(["rating", "title"]);
    });

    it("default columns empty when nothing referenced", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books")'));
        expect(r.columns).toEqual([]);
        expect(r.rows[0].values).toEqual({});
    });

    it("warns on a field not defined in any schema", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") && bogus == 1'));
        expect(r.warnings).toContain('field "bogus" is not defined in any schema');
    });

    it("does NOT warn on schema-defined fields", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") && rating > 4 sort by title select author'));
        expect(r.warnings).toEqual([]);
    });

    it("warns once per unknown field even if referenced repeatedly", () => {
        const r = executeQuery(files, cfg, parseQuery('file.inFolder("Books") && bogus > 1 sort by bogus select bogus'));
        const bogusWarnings = r.warnings.filter((w) => w.includes('"bogus"'));
        expect(bogusWarnings).toHaveLength(1);
    });

    it("a rule with no folder still knows every schema field", () => {
        const r = executeQuery(files, cfg, parseQuery("rating > 4"));
        expect(r.warnings).toEqual([]);
    });
});
