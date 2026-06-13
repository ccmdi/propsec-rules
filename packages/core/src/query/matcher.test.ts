import { describe, it, expect } from "vitest";
import {
    parseQuerySegments,
    describeQuery,
    validateQuery,
    fileMatchesQuery,
    fileMatchesPropertyFilter,
    describePropertyFilter,
} from "./matcher";
import type { FileMeta } from "./fileMeta";
import type { PropertyFilter } from "../types";

/**
 * Build a FileMeta for tests. Derives parentPath/basename from path so callers
 * only specify what matters for a given case.
 */
function makeFile(overrides: Partial<FileMeta> & { path: string }): FileMeta {
    const path = overrides.path;
    const slash = path.lastIndexOf("/");
    const parentPath = slash === -1 ? "" : path.slice(0, slash);
    const fileName = slash === -1 ? path : path.slice(slash + 1);
    const dot = fileName.lastIndexOf(".");
    const basename = dot === -1 ? fileName : fileName.slice(0, dot);
    return {
        parentPath,
        basename,
        mtime: 0,
        ctime: 0,
        frontmatter: undefined,
        tags: [],
        ...overrides,
    };
}

describe("parseQuerySegments", () => {
    describe("basic queries", () => {
        it("parses wildcard query", () => {
            const segments = parseQuerySegments("*");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "all", value: "*" });
            expect(segments[0].notConditions).toHaveLength(0);
        });

        it("parses folder query", () => {
            const segments = parseQuerySegments("Journal/");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder", value: "Journal" });
        });

        it("parses recursive folder query", () => {
            const segments = parseQuerySegments("Journal/*");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "Journal" });
        });

        it("parses tag query", () => {
            const segments = parseQuerySegments("#book");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "tag", value: "book" });
        });
    });

    describe("OR queries", () => {
        it("parses simple OR query", () => {
            const segments = parseQuerySegments("folder/* or #tag");
            expect(segments).toHaveLength(2);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "folder" });
            expect(segments[1].andConditions[0]).toEqual({ type: "tag", value: "tag" });
        });

        it("parses OR with multiple segments", () => {
            const segments = parseQuerySegments("#book or #article or #paper");
            expect(segments).toHaveLength(3);
            expect(segments[0].andConditions[0].value).toBe("book");
            expect(segments[1].andConditions[0].value).toBe("article");
            expect(segments[2].andConditions[0].value).toBe("paper");
        });

        it("is case insensitive for OR", () => {
            const segments = parseQuerySegments("folder/* OR #tag");
            expect(segments).toHaveLength(2);
        });
    });

    describe("AND queries", () => {
        it("parses simple AND query", () => {
            const segments = parseQuerySegments("folder/* and #tag");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(2);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "folder" });
            expect(segments[0].andConditions[1]).toEqual({ type: "tag", value: "tag" });
        });

        it("parses multiple AND conditions", () => {
            const segments = parseQuerySegments("folder/* and #book and #fiction");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(3);
        });

        it("is case insensitive for AND", () => {
            const segments = parseQuerySegments("folder/* AND #tag");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(2);
        });
    });

    describe("NOT queries", () => {
        it("parses simple NOT query", () => {
            const segments = parseQuerySegments("folder/* not #draft");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "folder" });
            expect(segments[0].notConditions).toHaveLength(1);
            expect(segments[0].notConditions[0]).toEqual({ type: "tag", value: "draft" });
        });

        it("parses multiple NOT conditions", () => {
            const segments = parseQuerySegments("folder/* not #draft not #archived");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(1);
            expect(segments[0].notConditions).toHaveLength(2);
            expect(segments[0].notConditions[0].value).toBe("draft");
            expect(segments[0].notConditions[1].value).toBe("archived");
        });

        it("is case insensitive for NOT", () => {
            const segments = parseQuerySegments("folder/* NOT #draft");
            expect(segments).toHaveLength(1);
            expect(segments[0].notConditions).toHaveLength(1);
        });
    });

    describe("combined AND/NOT queries", () => {
        it("parses AND with NOT", () => {
            const segments = parseQuerySegments("folder/* and #book not #draft");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(2);
            expect(segments[0].andConditions[0]).toEqual({ type: "folder_recursive", value: "folder" });
            expect(segments[0].andConditions[1]).toEqual({ type: "tag", value: "book" });
            expect(segments[0].notConditions).toHaveLength(1);
            expect(segments[0].notConditions[0]).toEqual({ type: "tag", value: "draft" });
        });

        it("parses complex query with AND, NOT, and OR", () => {
            const segments = parseQuerySegments("Library/* and #book not #draft or #article");
            expect(segments).toHaveLength(2);

            // First segment: Library/* AND #book NOT #draft
            expect(segments[0].andConditions).toHaveLength(2);
            expect(segments[0].notConditions).toHaveLength(1);

            // Second segment: #article
            expect(segments[1].andConditions).toHaveLength(1);
            expect(segments[1].andConditions[0].value).toBe("article");
            expect(segments[1].notConditions).toHaveLength(0);
        });
    });

    describe("edge cases", () => {
        it("handles empty query", () => {
            const segments = parseQuerySegments("");
            expect(segments).toHaveLength(0);
        });

        it("handles whitespace-only query", () => {
            const segments = parseQuerySegments("   ");
            expect(segments).toHaveLength(0);
        });

        it("handles extra whitespace", () => {
            const segments = parseQuerySegments("  folder/*   and   #tag  ");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions).toHaveLength(2);
        });

        it("handles nested folder paths", () => {
            const segments = parseQuerySegments("Library/Books/Fiction/*");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({
                type: "folder_recursive",
                value: "Library/Books/Fiction",
            });
        });

        it("handles nested tags", () => {
            const segments = parseQuerySegments("#book/fiction");
            expect(segments).toHaveLength(1);
            expect(segments[0].andConditions[0]).toEqual({
                type: "tag",
                value: "book/fiction",
            });
        });
    });
});

describe("describeQuery", () => {
    it("describes simple queries", () => {
        expect(describeQuery("*")).toBe("all files");
        expect(describeQuery("folder/")).toBe("in folder/");
        expect(describeQuery("folder/*")).toBe("in folder/ (recursive)");
        expect(describeQuery("#book")).toBe("tagged #book");
    });

    it("describes OR queries", () => {
        expect(describeQuery("folder/* or #tag")).toBe("in folder/ (recursive) or tagged #tag");
    });

    it("describes AND queries", () => {
        expect(describeQuery("folder/* and #tag")).toBe("in folder/ (recursive) and tagged #tag");
    });

    it("describes NOT queries", () => {
        const desc = describeQuery("folder/* not #draft");
        expect(desc).toContain("in folder/ (recursive)");
        expect(desc).toContain("not");
        expect(desc).toContain("tagged #draft");
    });

    it("describes combined queries", () => {
        const desc = describeQuery("Library/* and #book not #draft or #article");
        expect(desc).toContain("in Library/ (recursive)");
        expect(desc).toContain("tagged #book");
        expect(desc).toContain("not");
        expect(desc).toContain("tagged #draft");
        expect(desc).toContain("or");
        expect(desc).toContain("tagged #article");
    });

    it("describes empty query as No conditions", () => {
        expect(describeQuery("")).toBe("No conditions");
    });
});

describe("validateQuery", () => {
    it("rejects empty query", () => {
        expect(validateQuery("")).toEqual({ valid: false, error: "Query cannot be empty" });
        expect(validateQuery("   ")).toEqual({ valid: false, error: "Query cannot be empty" });
    });

    it("accepts valid queries", () => {
        expect(validateQuery("*")).toEqual({ valid: true });
        expect(validateQuery("Library/* and #book")).toEqual({ valid: true });
    });

    it("treats a leading 'not' as a literal folder term (query is trimmed first)", () => {
        // validateQuery trims before parsing, and the NOT split needs interior
        // whitespace, so a leading "not" parses as a folder condition -> valid.
        expect(validateQuery("not #draft")).toEqual({ valid: true });
    });

    it("skips empty OR branches but keeps the valid one", () => {
        // A trailing/duplicate "or" yields an empty branch which is skipped.
        const segments = parseQuerySegments("#book or ");
        expect(segments).toHaveLength(1);
        expect(segments[0].andConditions[0]).toEqual({ type: "tag", value: "book" });
        expect(validateQuery("#book or ")).toEqual({ valid: true });
    });
});

describe("fileMatchesQuery", () => {
    describe("condition types", () => {
        it("matches all files with wildcard", () => {
            expect(fileMatchesQuery(makeFile({ path: "anywhere/Note.md" }), "*")).toBe(true);
            expect(fileMatchesQuery(makeFile({ path: "Root.md" }), "*")).toBe(true);
        });

        it("matches direct folder membership only (non-recursive)", () => {
            const direct = makeFile({ path: "Journal/Note.md" });
            const nested = makeFile({ path: "Journal/Sub/Note.md" });
            const root = makeFile({ path: "Note.md" });
            expect(fileMatchesQuery(direct, "Journal")).toBe(true);
            expect(fileMatchesQuery(nested, "Journal")).toBe(false);
            expect(fileMatchesQuery(root, "Journal")).toBe(false);
        });

        it("matches root-level files with empty folder term semantics", () => {
            // A root file has parentPath "" so it only matches a folder term of "".
            const root = makeFile({ path: "Note.md" });
            expect(root.parentPath).toBe("");
        });

        it("matches folder and subfolders recursively", () => {
            const direct = makeFile({ path: "Library/Dune.md" });
            const nested = makeFile({ path: "Library/SciFi/Dune.md" });
            const deeper = makeFile({ path: "Library/SciFi/Classics/Dune.md" });
            const outside = makeFile({ path: "Other/Dune.md" });
            expect(fileMatchesQuery(direct, "Library/*")).toBe(true);
            expect(fileMatchesQuery(nested, "Library/*")).toBe(true);
            expect(fileMatchesQuery(deeper, "Library/*")).toBe(true);
            expect(fileMatchesQuery(outside, "Library/*")).toBe(false);
        });

        it("does not treat a sibling prefix folder as a recursive match", () => {
            // "Library/*" must not match "LibraryArchive/..."
            const sibling = makeFile({ path: "LibraryArchive/Dune.md" });
            expect(fileMatchesQuery(sibling, "Library/*")).toBe(false);
        });

        it("matches recursive folder with backslashes in file path", () => {
            const file = makeFile({ path: "Library\\SciFi\\Dune.md", parentPath: "Library\\SciFi" });
            expect(fileMatchesQuery(file, "Library/*")).toBe(true);
        });

        it("matches an exact tag", () => {
            const file = makeFile({ path: "Note.md", tags: ["book"] });
            expect(fileMatchesQuery(file, "#book")).toBe(true);
        });

        it("does not match a different tag", () => {
            const file = makeFile({ path: "Note.md", tags: ["article"] });
            expect(fileMatchesQuery(file, "#book")).toBe(false);
        });

        it("matches a nested tag against its parent (exact-or-nested rule)", () => {
            const file = makeFile({ path: "Note.md", tags: ["book/fiction"] });
            expect(fileMatchesQuery(file, "#book")).toBe(true);
            expect(fileMatchesQuery(file, "#book/fiction")).toBe(true);
        });

        it("does not match a parent tag query against a non-nested similar tag", () => {
            // "#book" should not match tag "books" (startsWith requires "book/")
            const file = makeFile({ path: "Note.md", tags: ["books"] });
            expect(fileMatchesQuery(file, "#book")).toBe(false);
        });
    });

    describe("AND/OR/NOT logic", () => {
        it("AND requires all conditions", () => {
            const inLibWithBook = makeFile({ path: "Library/Dune.md", tags: ["book"] });
            const inLibNoBook = makeFile({ path: "Library/Dune.md", tags: [] });
            const bookOutside = makeFile({ path: "Other/Dune.md", tags: ["book"] });
            expect(fileMatchesQuery(inLibWithBook, "Library/* and #book")).toBe(true);
            expect(fileMatchesQuery(inLibNoBook, "Library/* and #book")).toBe(false);
            expect(fileMatchesQuery(bookOutside, "Library/* and #book")).toBe(false);
        });

        it("OR matches if any segment matches", () => {
            const inLib = makeFile({ path: "Library/Dune.md", tags: [] });
            const tagged = makeFile({ path: "Other/Note.md", tags: ["book"] });
            const neither = makeFile({ path: "Other/Note.md", tags: ["article"] });
            expect(fileMatchesQuery(inLib, "Library/* or #book")).toBe(true);
            expect(fileMatchesQuery(tagged, "Library/* or #book")).toBe(true);
            expect(fileMatchesQuery(neither, "Library/* or #book")).toBe(false);
        });

        it("NOT excludes matching files", () => {
            const draft = makeFile({ path: "Library/Dune.md", tags: ["draft"] });
            const notDraft = makeFile({ path: "Library/Dune.md", tags: [] });
            expect(fileMatchesQuery(draft, "Library/* not #draft")).toBe(false);
            expect(fileMatchesQuery(notDraft, "Library/* not #draft")).toBe(true);
        });

        it("respects NOT > AND > OR precedence in a combined query", () => {
            // "Library/* and #book not #draft or #article"
            const q = "Library/* and #book not #draft or #article";
            // Segment 1: in Library AND #book AND NOT #draft
            const libBook = makeFile({ path: "Library/Dune.md", tags: ["book"] });
            const libBookDraft = makeFile({ path: "Library/Dune.md", tags: ["book", "draft"] });
            // Segment 2: #article (independent OR branch, not excluded by #draft)
            const articleDraft = makeFile({ path: "Other/Note.md", tags: ["article", "draft"] });

            expect(fileMatchesQuery(libBook, q)).toBe(true);
            expect(fileMatchesQuery(libBookDraft, q)).toBe(false);
            expect(fileMatchesQuery(articleDraft, q)).toBe(true);
        });

        it("returns false for an empty query (no segments)", () => {
            expect(fileMatchesQuery(makeFile({ path: "Note.md" }), "")).toBe(false);
        });
    });
});

describe("fileMatchesPropertyFilter", () => {
    describe("fileNamePattern", () => {
        it("matches basename against regex (case-insensitive)", () => {
            const file = makeFile({ path: "Books/Dune.md" });
            expect(fileMatchesPropertyFilter(file, { fileNamePattern: "^dune$" })).toBe(true);
            expect(fileMatchesPropertyFilter(file, { fileNamePattern: "^foundation$" })).toBe(false);
        });

        it("treats an invalid regex as no match", () => {
            const file = makeFile({ path: "Books/Dune.md" });
            expect(fileMatchesPropertyFilter(file, { fileNamePattern: "[" })).toBe(false);
        });
    });

    describe("date filters", () => {
        const day = (iso: string) => new Date(iso).getTime();

        it("filters by modifiedAfter / modifiedBefore", () => {
            const file = makeFile({ path: "n.md", mtime: day("2024-06-15") });
            expect(fileMatchesPropertyFilter(file, { modifiedAfter: "2024-01-01" })).toBe(true);
            expect(fileMatchesPropertyFilter(file, { modifiedAfter: "2024-12-01" })).toBe(false);
            expect(fileMatchesPropertyFilter(file, { modifiedBefore: "2024-12-01" })).toBe(true);
            expect(fileMatchesPropertyFilter(file, { modifiedBefore: "2024-01-01" })).toBe(false);
        });

        it("filters by createdAfter / createdBefore", () => {
            const file = makeFile({ path: "n.md", ctime: day("2024-06-15") });
            expect(fileMatchesPropertyFilter(file, { createdAfter: "2024-01-01" })).toBe(true);
            expect(fileMatchesPropertyFilter(file, { createdAfter: "2024-12-01" })).toBe(false);
            expect(fileMatchesPropertyFilter(file, { createdBefore: "2024-12-01" })).toBe(true);
            expect(fileMatchesPropertyFilter(file, { createdBefore: "2024-01-01" })).toBe(false);
        });
    });

    describe("hasProperty / notHasProperty", () => {
        it("hasProperty requires the key (case-insensitive)", () => {
            const file = makeFile({ path: "n.md", frontmatter: { Author: "X" } });
            expect(fileMatchesPropertyFilter(file, { hasProperty: "author" })).toBe(true);
            expect(fileMatchesPropertyFilter(file, { hasProperty: "isbn" })).toBe(false);
        });

        it("hasProperty fails when there is no frontmatter", () => {
            const file = makeFile({ path: "n.md", frontmatter: undefined });
            expect(fileMatchesPropertyFilter(file, { hasProperty: "author" })).toBe(false);
        });

        it("notHasProperty passes when key absent and fails when present", () => {
            const withKey = makeFile({ path: "n.md", frontmatter: { status: "draft" } });
            const withoutKey = makeFile({ path: "n.md", frontmatter: { author: "X" } });
            const noFm = makeFile({ path: "n.md", frontmatter: undefined });
            expect(fileMatchesPropertyFilter(withKey, { notHasProperty: "status" })).toBe(false);
            expect(fileMatchesPropertyFilter(withoutKey, { notHasProperty: "status" })).toBe(true);
            expect(fileMatchesPropertyFilter(noFm, { notHasProperty: "status" })).toBe(true);
        });
    });

    describe("conditions (AND logic)", () => {
        it("matches equals against a present property", () => {
            const file = makeFile({ path: "n.md", frontmatter: { type: "book" } });
            const filter: PropertyFilter = {
                conditions: [{ property: "type", operator: "equals", value: "book" }],
            };
            expect(fileMatchesPropertyFilter(file, filter)).toBe(true);
        });

        it("fails equals against an absent property", () => {
            const file = makeFile({ path: "n.md", frontmatter: { other: 1 } });
            const filter: PropertyFilter = {
                conditions: [{ property: "type", operator: "equals", value: "book" }],
            };
            expect(fileMatchesPropertyFilter(file, filter)).toBe(false);
        });

        it("requires ALL conditions to pass (AND)", () => {
            const file = makeFile({ path: "n.md", frontmatter: { type: "book", status: "published" } });
            const pass: PropertyFilter = {
                conditions: [
                    { property: "type", operator: "equals", value: "book" },
                    { property: "status", operator: "equals", value: "published" },
                ],
            };
            const fail: PropertyFilter = {
                conditions: [
                    { property: "type", operator: "equals", value: "book" },
                    { property: "status", operator: "equals", value: "draft" },
                ],
            };
            expect(fileMatchesPropertyFilter(file, pass)).toBe(true);
            expect(fileMatchesPropertyFilter(file, fail)).toBe(false);
        });

        describe("missing-property semantics", () => {
            it("not_equals matches when property is absent", () => {
                const file = makeFile({ path: "n.md", frontmatter: { other: 1 } });
                const filter: PropertyFilter = {
                    conditions: [{ property: "type", operator: "not_equals", value: "book" }],
                };
                expect(fileMatchesPropertyFilter(file, filter)).toBe(true);
            });

            it("not_contains matches when property is absent", () => {
                const file = makeFile({ path: "n.md", frontmatter: { other: 1 } });
                const filter: PropertyFilter = {
                    conditions: [{ property: "tags", operator: "not_contains", value: "draft" }],
                };
                expect(fileMatchesPropertyFilter(file, filter)).toBe(true);
            });

            it("not_equals/not_contains match when there is no frontmatter at all", () => {
                const file = makeFile({ path: "n.md", frontmatter: undefined });
                expect(fileMatchesPropertyFilter(file, {
                    conditions: [{ property: "type", operator: "not_equals", value: "book" }],
                })).toBe(true);
                expect(fileMatchesPropertyFilter(file, {
                    conditions: [{ property: "tags", operator: "not_contains", value: "draft" }],
                })).toBe(true);
            });

            it("equals does NOT match when property is absent", () => {
                const file = makeFile({ path: "n.md", frontmatter: { other: 1 } });
                const filter: PropertyFilter = {
                    conditions: [{ property: "type", operator: "equals", value: "book" }],
                };
                expect(fileMatchesPropertyFilter(file, filter)).toBe(false);
            });
        });

        describe("exists / not_exists", () => {
            it("exists matches only when the key is present", () => {
                const present = makeFile({ path: "n.md", frontmatter: { rating: 5 } });
                const absent = makeFile({ path: "n.md", frontmatter: { other: 1 } });
                const noFm = makeFile({ path: "n.md", frontmatter: undefined });
                const filter: PropertyFilter = {
                    conditions: [{ property: "rating", operator: "exists", value: "" }],
                };
                expect(fileMatchesPropertyFilter(present, filter)).toBe(true);
                expect(fileMatchesPropertyFilter(absent, filter)).toBe(false);
                expect(fileMatchesPropertyFilter(noFm, filter)).toBe(false);
            });

            it("not_exists matches when key absent or no frontmatter", () => {
                const present = makeFile({ path: "n.md", frontmatter: { rating: 5 } });
                const absent = makeFile({ path: "n.md", frontmatter: { other: 1 } });
                const noFm = makeFile({ path: "n.md", frontmatter: undefined });
                const filter: PropertyFilter = {
                    conditions: [{ property: "rating", operator: "not_exists", value: "" }],
                };
                expect(fileMatchesPropertyFilter(present, filter)).toBe(false);
                expect(fileMatchesPropertyFilter(absent, filter)).toBe(true);
                expect(fileMatchesPropertyFilter(noFm, filter)).toBe(true);
            });
        });
    });

    it("returns true for an empty filter", () => {
        const file = makeFile({ path: "n.md", frontmatter: { a: 1 } });
        expect(fileMatchesPropertyFilter(file, {})).toBe(true);
    });
});

describe("describePropertyFilter", () => {
    it("describes an empty filter as empty string", () => {
        expect(describePropertyFilter({})).toBe("");
    });

    it("describes date and property parts", () => {
        const desc = describePropertyFilter({
            modifiedAfter: "2024-01-01",
            hasProperty: "author",
            notHasProperty: "draft",
            conditions: [{ property: "type", operator: "equals", value: "book" }],
        });
        expect(desc).toContain("modified after 2024-01-01");
        expect(desc).toContain('has "author"');
        expect(desc).toContain('no "draft"');
        expect(desc).toContain("type = book");
    });
});
