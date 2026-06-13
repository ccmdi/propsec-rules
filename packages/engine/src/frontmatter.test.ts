import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "./frontmatter.js";

describe("parseFrontmatter", () => {
    it("worked example (LF): exact positions", () => {
        const content = "---\ntitle: Hi\ncount: 5\n---\nbody\n";
        const r = parseFrontmatter(content);

        expect(r.malformed).toBe(false);
        expect(r.errors).toEqual([]);
        expect(r.data).toEqual({ title: "Hi", count: 5 });

        expect(r.positions.get("title")!.keyRange.start).toEqual({ line: 1, character: 0 });
        expect(r.positions.get("title")!.valueRange.start).toEqual({ line: 1, character: 7 });
        expect(r.positions.get("count")!.keyRange.start).toEqual({ line: 2, character: 0 });

        expect(r.blockRange).toEqual({
            start: { line: 1, character: 0 },
            end: { line: 3, character: 0 },
        });
    });

    it("worked example (CRLF): identical positions", () => {
        const content = "---\r\ntitle: Hi\r\ncount: 5\r\n---\r\nbody\r\n";
        const r = parseFrontmatter(content);

        expect(r.malformed).toBe(false);
        expect(r.data).toEqual({ title: "Hi", count: 5 });

        expect(r.positions.get("title")!.keyRange.start).toEqual({ line: 1, character: 0 });
        expect(r.positions.get("title")!.valueRange.start).toEqual({ line: 1, character: 7 });
        expect(r.positions.get("count")!.keyRange.start).toEqual({ line: 2, character: 0 });
    });

    it("no frontmatter block", () => {
        const r = parseFrontmatter("# Just a heading\n\nsome body\n");
        expect(r.data).toBeUndefined();
        expect(r.positions.size).toBe(0);
        expect(r.blockRange).toBeNull();
        expect(r.malformed).toBe(false);
        expect(r.errors).toEqual([]);
    });

    it("text that looks like a fence but not on first line is not frontmatter", () => {
        const r = parseFrontmatter("intro\n---\ntitle: Hi\n---\n");
        expect(r.data).toBeUndefined();
        expect(r.blockRange).toBeNull();
    });

    it("empty frontmatter -> data {} (no fields), not malformed", () => {
        const r = parseFrontmatter("---\n---\nbody\n");
        expect(r.data).toEqual({});
        expect(r.positions.size).toBe(0);
        expect(r.malformed).toBe(false);
        expect(r.errors).toEqual([]);
        expect(r.blockRange).toEqual({
            start: { line: 1, character: 0 },
            end: { line: 1, character: 0 },
        });
    });

    it("malformed YAML -> malformed true, errors non-empty, data undefined", () => {
        const r = parseFrontmatter("---\nfoo: [unclosed\n---\n");
        expect(r.malformed).toBe(true);
        expect(r.errors.length).toBeGreaterThan(0);
        expect(r.data).toBeUndefined();
        expect(r.positions.size).toBe(0);
        expect(r.blockRange).not.toBeNull();
    });

    it("multi-key with nested object: top-level value range spans the block", () => {
        const content = "---\nauthor:\n  name: A\n  age: 3\ntags:\n  - x\n  - y\n---\n";
        const r = parseFrontmatter(content);

        expect(r.data).toEqual({ author: { name: "A", age: 3 }, tags: ["x", "y"] });
        // opening fence is file line 0; author key is file line 1, value at the nested map
        expect(r.positions.get("author")!.keyRange.start).toEqual({ line: 1, character: 0 });
        expect(r.positions.get("author")!.valueRange.start).toEqual({ line: 2, character: 2 });
        expect(r.positions.get("tags")!.keyRange.start).toEqual({ line: 4, character: 0 });
        // only top-level keys are recorded
        expect([...r.positions.keys()].sort()).toEqual(["author", "tags"]);
    });

    it("tags as a single string", () => {
        const r = parseFrontmatter("---\ntags: solo\n---\n");
        expect(r.data).toEqual({ tags: "solo" });
        expect(r.positions.has("tags")).toBe(true);
    });

    it("tags as an array", () => {
        const r = parseFrontmatter("---\ntags:\n  - a\n  - b\n---\n");
        expect(r.data).toEqual({ tags: ["a", "b"] });
        expect(r.positions.has("tags")).toBe(true);
    });

    it("records keys with original case lowercased in the positions map", () => {
        const r = parseFrontmatter("---\nTitle: Hi\nAuthor: A\n---\n");
        expect(r.data).toEqual({ Title: "Hi", Author: "A" });
        expect(r.positions.has("title")).toBe(true);
        expect(r.positions.has("author")).toBe(true);
    });
});
