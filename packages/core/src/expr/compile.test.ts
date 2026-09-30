import { describe, it, expect } from "vitest";
import { compileExpr } from "./compile";
import { ExprError } from "./parse";
import type { FileMeta } from "../model";

const note = (frontmatter: Record<string, unknown> | undefined, over: Partial<FileMeta> = {}): FileMeta => ({
    path: "Books/Old/Dune.md",
    parentPath: "Books/Old",
    basename: "Dune",
    mtime: Date.parse("2026-03-01"),
    ctime: Date.parse("2025-01-01"),
    frontmatter,
    tags: ["book/scifi", "owned"],
    ...over,
});

const test = (src: string, fm: Record<string, unknown> | undefined = {}, it?: unknown) => compileExpr(src).test(note(fm), it);
const value = (src: string, fm: Record<string, unknown> | undefined = {}, it?: unknown) => compileExpr(src).value(note(fm), it);

describe("expression language", () => {
    it("reads frontmatter case-insensitively, missing values are null", () => {
        expect(value("Rating", { rating: 4 })).toBe(4);
        expect(value("rating", {})).toBeNull();
        expect(value("rating", undefined)).toBeNull();
        expect(value('note["date created"]', { "date created": "2026-01-01" })).toBe("2026-01-01");
        expect(test("has(rating)", { rating: null })).toBe(true);
        expect(test("has(rating)", {})).toBe(false);
    });

    it("compares within a kind and never across kinds", () => {
        expect(test("rating > 3", { rating: 4 })).toBe(true);
        expect(test('rating > 3', { rating: "4" })).toBe(true);
        expect(test('due >= "2026-01-01"', { due: "2026-02-01" })).toBe(true);
        expect(test('title < "M"', { title: "Dune" })).toBe(true);
        expect(test('title < 5', { title: "Dune" })).toBe(false);
        expect(test('title > 5', { title: "Dune" })).toBe(false);
        expect(test("missing < 5")).toBe(false);
    });

    it("treats numbers as one numeric type, so arithmetic never needs 1.0", () => {
        expect(value("it + 1", {}, 4.5)).toBe(5.5);
        expect(test("rating * 2 > 7", { rating: 4 })).toBe(true);
        expect(value("1 / 0")).toBeNull();
    });

    it("quantifies over lists", () => {
        const fm = { tags: ["obj/x", "b"] };
        expect(test('tags.exists(t, t.matches("^obj/"))', fm)).toBe(true);
        expect(test('tags.all(t, t in ["obj/x", "b"])', fm)).toBe(true);
        expect(test('tags.all(t, t.startsWith("obj"))', fm)).toBe(false);
        expect(test('"b" in tags && size(tags) == 2', fm)).toBe(true);
        expect(test("size(tags.distinct()) == size(tags)", { tags: ["a", "a"] })).toBe(false);
    });

    it("exposes the file and its folder and tags", () => {
        expect(test('file.inFolder("Books")')).toBe(true);
        expect(test('file.folder == "Books"')).toBe(false);
        expect(test('file.hasTag("book")')).toBe(true);
        expect(test('file.hasTag("boo")')).toBe(false);
        expect(test('file.name.matches("^dune$", "i")')).toBe(true);
        expect(test('file.mtime >= date("2026-01-01")')).toBe(true);
    });

    it("rejects unknown names and bad regexes at compile time", () => {
        expect(() => compileExpr("file.size")).toThrow(ExprError);
        expect(() => compileExpr("nope(1)")).toThrow(ExprError);
        expect(() => compileExpr('it.matches("[")')).toThrow(ExprError);
        expect(() => compileExpr("rating >")).toThrow(ExprError);
    });

    it("reports the frontmatter names an expression reads", () => {
        expect([...compileExpr('rating > 3 && note["date created"] != null && tags.exists(t, t == it)').refs].sort()).toEqual(["date created", "rating", "tags"]);
    });
});
