import { describe, it, expect } from "vitest";
import {
    isFileGloballyExcluded,
    fileMatchesMapping,
    getMatchingSchemas,
    type PropsecConfig,
} from "./harness";
import type { FileMeta } from "../model";
import type { SchemaMapping } from "../legacy/types";

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

function makeMapping(overrides: Partial<SchemaMapping> & { id: string; query: string }): SchemaMapping {
    return {
        name: overrides.id,
        sourceTemplatePath: null,
        enabled: true,
        fields: [],
        ...overrides,
    };
}

function makeConfig(overrides: Partial<PropsecConfig> & { schemaMappings: SchemaMapping[] }): PropsecConfig {
    return {
        customTypes: [],
        ...overrides,
    };
}

describe("isFileGloballyExcluded", () => {
    it("returns false when no globalExclusions configured", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["archived"] });
        const config = makeConfig({ schemaMappings: [] });
        expect(isFileGloballyExcluded(file, config)).toBe(false);
    });

    it("returns true when the file matches the exclusion query", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["archived"] });
        const config = makeConfig({ schemaMappings: [], globalExclusions: "#archived" });
        expect(isFileGloballyExcluded(file, config)).toBe(true);
    });

    it("returns false when the file does not match the exclusion query", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["book"] });
        const config = makeConfig({ schemaMappings: [], globalExclusions: "#archived" });
        expect(isFileGloballyExcluded(file, config)).toBe(false);
    });
});

describe("fileMatchesMapping", () => {
    it("returns false when mapping disabled", () => {
        const file = makeFile({ path: "Library/Dune.md" });
        const mapping = makeMapping({ id: "s1", query: "Library/*", enabled: false });
        const config = makeConfig({ schemaMappings: [mapping] });
        expect(fileMatchesMapping(file, mapping, config)).toBe(false);
    });

    it("returns false when mapping query is empty", () => {
        const file = makeFile({ path: "Library/Dune.md" });
        const mapping = makeMapping({ id: "s1", query: "" });
        const config = makeConfig({ schemaMappings: [mapping] });
        expect(fileMatchesMapping(file, mapping, config)).toBe(false);
    });

    it("returns false when globally excluded even if query matches", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["archived"] });
        const mapping = makeMapping({ id: "s1", query: "Library/*" });
        const config = makeConfig({ schemaMappings: [mapping], globalExclusions: "#archived" });
        expect(fileMatchesMapping(file, mapping, config)).toBe(false);
    });

    it("returns true when query matches and not excluded", () => {
        const file = makeFile({ path: "Library/Dune.md" });
        const mapping = makeMapping({ id: "s1", query: "Library/*" });
        const config = makeConfig({ schemaMappings: [mapping] });
        expect(fileMatchesMapping(file, mapping, config)).toBe(true);
    });

    it("applies propertyFilter as an additional narrowing gate", () => {
        const book = makeFile({ path: "Library/Dune.md", frontmatter: { type: "book" } });
        const article = makeFile({ path: "Library/Note.md", frontmatter: { type: "article" } });
        const mapping = makeMapping({
            id: "s1",
            query: "Library/*",
            propertyFilter: { conditions: [{ property: "type", operator: "equals", value: "book" }] },
        });
        const config = makeConfig({ schemaMappings: [mapping] });
        expect(fileMatchesMapping(book, mapping, config)).toBe(true);
        expect(fileMatchesMapping(article, mapping, config)).toBe(false);
    });
});

describe("getMatchingSchemas", () => {
    it("accumulates all matching schemas (multiple matches)", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["book"] });
        const byFolder = makeMapping({ id: "folder", query: "Library/*" });
        const byTag = makeMapping({ id: "tag", query: "#book" });
        const unrelated = makeMapping({ id: "other", query: "Journal/*" });
        const config = makeConfig({ schemaMappings: [byFolder, byTag, unrelated] });

        const result = getMatchingSchemas(file, config);
        expect(result.map(m => m.id)).toEqual(["folder", "tag"]);
    });

    it("preserves schemaMappings order in the result", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["book"] });
        const byTag = makeMapping({ id: "tag", query: "#book" });
        const byFolder = makeMapping({ id: "folder", query: "Library/*" });
        const config = makeConfig({ schemaMappings: [byTag, byFolder] });

        const result = getMatchingSchemas(file, config);
        expect(result.map(m => m.id)).toEqual(["tag", "folder"]);
    });

    it("skips disabled and empty-query schemas", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["book"] });
        const enabled = makeMapping({ id: "ok", query: "Library/*" });
        const disabled = makeMapping({ id: "off", query: "Library/*", enabled: false });
        const empty = makeMapping({ id: "empty", query: "" });
        const config = makeConfig({ schemaMappings: [enabled, disabled, empty] });

        const result = getMatchingSchemas(file, config);
        expect(result.map(m => m.id)).toEqual(["ok"]);
    });

    it("removes matches that are globally excluded", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["book", "archived"] });
        const byFolder = makeMapping({ id: "folder", query: "Library/*" });
        const byTag = makeMapping({ id: "tag", query: "#book" });
        const config = makeConfig({
            schemaMappings: [byFolder, byTag],
            globalExclusions: "#archived",
        });

        expect(getMatchingSchemas(file, config)).toEqual([]);
    });

    it("narrows accumulation via propertyFilter", () => {
        const file = makeFile({ path: "Library/Dune.md", tags: ["book"], frontmatter: { type: "book" } });
        // matches: folder query + tag query, but the filtered schema requires type=article
        const byFolder = makeMapping({ id: "folder", query: "Library/*" });
        const articlesOnly = makeMapping({
            id: "articles",
            query: "#book",
            propertyFilter: { conditions: [{ property: "type", operator: "equals", value: "article" }] },
        });
        const config = makeConfig({ schemaMappings: [byFolder, articlesOnly] });

        const result = getMatchingSchemas(file, config);
        expect(result.map(m => m.id)).toEqual(["folder"]);
    });

    it("returns empty array when nothing matches", () => {
        const file = makeFile({ path: "Other/Note.md", tags: [] });
        const config = makeConfig({
            schemaMappings: [makeMapping({ id: "s1", query: "Library/*" })],
        });
        expect(getMatchingSchemas(file, config)).toEqual([]);
    });
});
