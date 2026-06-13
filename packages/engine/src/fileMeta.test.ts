import { describe, it, expect } from "vitest";
import { buildFileMeta } from "./fileMeta.js";

const mk = (path: string, content: string) =>
    buildFileMeta({ path, content, mtime: 100, ctime: 50 });

describe("buildFileMeta", () => {
    it("derives parentPath/basename for a root file", () => {
        const { meta } = mk("Dune.md", "---\ntitle: X\n---\n");
        expect(meta.parentPath).toBe("");
        expect(meta.basename).toBe("Dune");
        expect(meta.path).toBe("Dune.md");
        expect(meta.mtime).toBe(100);
        expect(meta.ctime).toBe(50);
    });

    it("derives parentPath/basename for a nested file", () => {
        const { meta } = mk("Books/SciFi/Dune.md", "---\ntitle: X\n---\n");
        expect(meta.parentPath).toBe("Books/SciFi");
        expect(meta.basename).toBe("Dune");
    });

    it("normalizes tags: single string", () => {
        const { meta } = mk("a.md", "---\ntags: novel\n---\n");
        expect(meta.tags).toEqual(["novel"]);
    });

    it("normalizes tags: array", () => {
        const { meta } = mk("a.md", "---\ntags:\n  - novel\n  - scifi\n---\n");
        expect(meta.tags).toEqual(["novel", "scifi"]);
    });

    it("strips leading # from tags", () => {
        const { meta } = mk("a.md", "---\ntags:\n  - '#novel'\n  - '#scifi'\n---\n");
        expect(meta.tags).toEqual(["novel", "scifi"]);
    });

    it("dedupes tags (after # strip)", () => {
        const { meta } = mk("a.md", "---\ntags:\n  - novel\n  - '#novel'\n  - scifi\n---\n");
        expect(meta.tags).toEqual(["novel", "scifi"]);
    });

    it("no-frontmatter file: undefined frontmatter, empty tags", () => {
        const { meta, parsed } = mk("a.md", "# heading\nbody\n");
        expect(meta.frontmatter).toBeUndefined();
        expect(meta.tags).toEqual([]);
        expect(parsed.data).toBeUndefined();
    });

    it("frontmatter without tags: empty tags array", () => {
        const { meta } = mk("a.md", "---\ntitle: X\n---\n");
        expect(meta.tags).toEqual([]);
        expect(meta.frontmatter).toEqual({ title: "X" });
    });

    it("exposes the parsed frontmatter alongside meta", () => {
        const { parsed } = mk("a.md", "---\ntitle: Hi\n---\n");
        expect(parsed.positions.has("title")).toBe(true);
    });
});
