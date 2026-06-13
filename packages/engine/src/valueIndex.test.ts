import { describe, it, expect } from "vitest";
import { buildFileMeta } from "./fileMeta.js";
import { buildValueIndex } from "./valueIndex.js";

const file = (path: string, content: string) =>
    buildFileMeta({ path, content, mtime: 1, ctime: 1 });

describe("buildValueIndex", () => {
    it("collects distinct scalar values per key", () => {
        const a = file("a.md", "---\nstatus: draft\nrating: 5\n---\n");
        const b = file("b.md", "---\nstatus: done\nrating: 5\n---\n");
        const idx = buildValueIndex([a, b]);

        expect(idx.get("status")).toEqual(["draft", "done"]);
        expect(idx.get("rating")).toEqual(["5"]); // number stringified + deduped
    });

    it("stringifies numbers and booleans", () => {
        const a = file("a.md", "---\ndone: true\ncount: 3\n---\n");
        const b = file("b.md", "---\ndone: false\ncount: 3\n---\n");
        const idx = buildValueIndex([a, b]);

        expect(idx.get("done")).toEqual(["true", "false"]);
        expect(idx.get("count")).toEqual(["3"]);
    });

    it("flattens array elements (scalar elements only)", () => {
        const a = file("a.md", "---\ntags:\n  - red\n  - blue\n---\n");
        const b = file("b.md", "---\ntags:\n  - blue\n  - green\n---\n");
        const idx = buildValueIndex([a, b]);

        expect(idx.get("tags")).toEqual(["red", "blue", "green"]);
    });

    it("skips object and null values", () => {
        const a = file(
            "a.md",
            "---\nauthor:\n  name: A\nnote: null\nplain: hi\n---\n"
        );
        const idx = buildValueIndex([a]);

        expect(idx.has("author")).toBe(false); // object skipped
        expect(idx.has("note")).toBe(false); // null skipped
        expect(idx.get("plain")).toEqual(["hi"]);
    });

    it("skips non-scalar array elements but keeps scalar siblings", () => {
        const a = file("a.md", "---\nitems:\n  - ok\n  - { nested: 1 }\n  - 2\n---\n");
        const idx = buildValueIndex([a]);
        expect(idx.get("items")).toEqual(["ok", "2"]);
    });

    it("keys are lowercased and merged case-insensitively", () => {
        const a = file("a.md", "---\nStatus: draft\n---\n");
        const b = file("b.md", "---\nstatus: done\n---\n");
        const idx = buildValueIndex([a, b]);
        expect(idx.get("status")).toEqual(["draft", "done"]);
    });

    it("preserves first-seen order and dedupes across files", () => {
        const a = file("a.md", "---\nx: one\n---\n");
        const b = file("b.md", "---\nx: two\n---\n");
        const c = file("c.md", "---\nx: one\n---\n"); // dup of first
        const d = file("d.md", "---\nx: three\n---\n");
        const idx = buildValueIndex([a, b, c, d]);
        expect(idx.get("x")).toEqual(["one", "two", "three"]);
    });

    it("ignores files without frontmatter", () => {
        const a = file("a.md", "no frontmatter here\n");
        const b = file("b.md", "---\nx: 1\n---\n");
        const idx = buildValueIndex([a, b]);
        expect(idx.get("x")).toEqual(["1"]);
    });
});
