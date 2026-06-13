import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpus } from "./corpus.js";

let root: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "engine-corpus-"));

    await writeFile(join(root, "top.md"), "---\ntitle: Top\n---\nbody\n");
    await writeFile(join(root, "notes.txt"), "not markdown\n");

    await mkdir(join(root, "Books"), { recursive: true });
    await writeFile(join(root, "Books", "dune.md"), "---\ntitle: Dune\ntags:\n  - scifi\n---\n");

    await mkdir(join(root, "Books", "SciFi"), { recursive: true });
    await writeFile(join(root, "Books", "SciFi", "deep.md"), "---\ntitle: Deep\n---\n");

    // must be ignored
    await mkdir(join(root, ".obsidian", "plugins"), { recursive: true });
    await writeFile(join(root, ".obsidian", "ignored.md"), "---\ntitle: Nope\n---\n");
    await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
    await writeFile(join(root, "node_modules", "pkg", "readme.md"), "# nope\n");
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describe("loadCorpus", () => {
    it("finds only .md files, with correct relative forward-slash paths", async () => {
        const files = await loadCorpus(root);
        const paths = files.map((f) => f.meta.path).sort();
        expect(paths).toEqual(["Books/SciFi/deep.md", "Books/dune.md", "top.md"]);
    });

    it("ignores dot dirs (.obsidian) and node_modules", async () => {
        const files = await loadCorpus(root);
        const paths = files.map((f) => f.meta.path);
        expect(paths.some((p) => p.includes(".obsidian"))).toBe(false);
        expect(paths.some((p) => p.includes("node_modules"))).toBe(false);
    });

    it("populates meta + parsed for each file", async () => {
        const files = await loadCorpus(root);
        const dune = files.find((f) => f.meta.path === "Books/dune.md")!;
        expect(dune.meta.parentPath).toBe("Books");
        expect(dune.meta.basename).toBe("dune");
        expect(dune.meta.frontmatter).toEqual({ title: "Dune", tags: ["scifi"] });
        expect(dune.meta.tags).toEqual(["scifi"]);
        expect(dune.parsed.positions.has("title")).toBe(true);
        expect(typeof dune.meta.mtime).toBe("number");
        expect(typeof dune.meta.ctime).toBe("number");
    });

    it("honors extra ignores", async () => {
        const files = await loadCorpus(root, { ignore: ["Books"] });
        const paths = files.map((f) => f.meta.path).sort();
        expect(paths).toEqual(["top.md"]);
    });
});
