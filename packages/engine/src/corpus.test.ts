import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, stat, utimes } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCorpus } from "./corpus.js";
import { CACHE_DIR, CACHE_FILE, CACHE_VERSION } from "./parseCache.js";

const cachePath = (dir: string) => join(dir, CACHE_DIR, CACHE_FILE);

/** Bump a file's mtime to `base + deltaMs` so cache invalidation is deterministic. */
async function bumpMtime(file: string, deltaMs: number): Promise<void> {
    const st = await stat(file);
    const next = new Date(st.mtimeMs + deltaMs);
    await utimes(file, next, next);
}

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

describe("loadCorpus parse cache", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "engine-cache-"));
        await writeFile(join(dir, "a.md"), "---\ntitle: A\nrating: 1\n---\nbody a\n");
        await writeFile(join(dir, "b.md"), "---\ntitle: B\ntags:\n  - x\n---\nbody b\n");
        await mkdir(join(dir, "sub"), { recursive: true });
        await writeFile(join(dir, "sub", "c.md"), "---\ntitle: C\n---\n");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("round-trips: second load deep-equals first and writes cache.json", async () => {
        const first = await loadCorpus(dir);
        expect(existsSync(cachePath(dir))).toBe(true);

        const second = await loadCorpus(dir);

        // positions must rehydrate as a real Map with identical ranges.
        const a2 = second.find((f) => f.meta.path === "a.md")!;
        expect(a2.parsed.positions).toBeInstanceOf(Map);
        const a1 = first.find((f) => f.meta.path === "a.md")!;
        expect([...a2.parsed.positions]).toEqual([...a1.parsed.positions]);
        expect(a2.parsed.positions.get("title")).toEqual(a1.parsed.positions.get("title"));

        // Whole corpus is structurally identical (Map deep-equals across loads).
        expect(second).toEqual(first);
    });

    it("matches a cache:false full parse exactly (concurrency correctness)", async () => {
        await loadCorpus(dir); // build cache
        const cached = await loadCorpus(dir); // cache hit path
        const full = await loadCorpus(dir, { cache: false }); // full parse path
        expect(cached).toEqual(full);
    });

    it("invalidates on content+mtime change for that file only", async () => {
        const before = await loadCorpus(dir);
        const bBefore = before.find((f) => f.meta.path === "b.md")!;

        await writeFile(join(dir, "b.md"), "---\ntitle: B2\nrating: 9\n---\nchanged\n");
        await bumpMtime(join(dir, "b.md"), 5000); // guarantee a different mtime

        const after = await loadCorpus(dir);
        const bAfter = after.find((f) => f.meta.path === "b.md")!;
        const aAfter = after.find((f) => f.meta.path === "a.md")!;

        expect(bAfter.meta.frontmatter).toEqual({ title: "B2", rating: 9 });
        expect(bAfter.parsed.data).toEqual({ title: "B2", rating: 9 });
        // untouched file is unchanged.
        expect(aAfter.meta.frontmatter).toEqual({ title: "A", rating: 1 });
        expect(bBefore.meta.frontmatter).toEqual({ title: "B", tags: ["x"] });
    });

    it("invalidates when size changes even if mtime is preserved", async () => {
        await loadCorpus(dir);
        const orig = await stat(join(dir, "a.md"));
        // Different content/size, then restore the original mtime to defeat mtime-only keying.
        await writeFile(join(dir, "a.md"), "---\ntitle: AAAA\nrating: 7\n---\nmuch longer body\n");
        const keep = new Date(orig.mtimeMs);
        await utimes(join(dir, "a.md"), keep, keep);

        const after = await loadCorpus(dir);
        const a = after.find((f) => f.meta.path === "a.md")!;
        expect(a.meta.frontmatter).toEqual({ title: "AAAA", rating: 7 });
    });

    it("drops deleted files from results and from the rewritten cache", async () => {
        await loadCorpus(dir);
        await rm(join(dir, "sub", "c.md"));

        const after = await loadCorpus(dir);
        expect(after.map((f) => f.meta.path).sort()).toEqual(["a.md", "b.md"]);

        const cache = JSON.parse(await readFile(cachePath(dir), "utf8")) as {
            files: Record<string, unknown>;
        };
        expect(Object.keys(cache.files).sort()).toEqual(["a.md", "b.md"]);
    });

    it("reparses on version mismatch but still returns correct results", async () => {
        await loadCorpus(dir);
        const bogus = {
            version: CACHE_VERSION + 999,
            files: {
                "a.md": { mtimeMs: 1, size: 1, file: { meta: {}, parsed: { positions: [] } } },
            },
        };
        await writeFile(cachePath(dir), JSON.stringify(bogus), "utf8");

        const after = await loadCorpus(dir);
        const a = after.find((f) => f.meta.path === "a.md")!;
        expect(a.meta.frontmatter).toEqual({ title: "A", rating: 1 });
        expect(a.parsed.positions).toBeInstanceOf(Map);
        // cache rewritten back to the current version.
        const cache = JSON.parse(await readFile(cachePath(dir), "utf8")) as { version: number };
        expect(cache.version).toBe(CACHE_VERSION);
    });

    it("reparses on corrupt cache.json without throwing", async () => {
        await mkdir(join(dir, CACHE_DIR), { recursive: true });
        await writeFile(cachePath(dir), "{ this is not valid json ", "utf8");

        const after = await loadCorpus(dir);
        expect(after.map((f) => f.meta.path).sort()).toEqual(["a.md", "b.md", "sub/c.md"]);
        const a = after.find((f) => f.meta.path === "a.md")!;
        expect(a.meta.frontmatter).toEqual({ title: "A", rating: 1 });
    });

    it("cache:false neither reads nor writes the cache file", async () => {
        const files = await loadCorpus(dir, { cache: false });
        expect(files.map((f) => f.meta.path).sort()).toEqual(["a.md", "b.md", "sub/c.md"]);
        expect(existsSync(cachePath(dir))).toBe(false);

        // Pre-existing cache must be left untouched (not read, not rewritten).
        await loadCorpus(dir); // writes a real cache
        const beforeBytes = await readFile(cachePath(dir), "utf8");
        // change a file but load with cache:false — cache file must not change.
        await writeFile(join(dir, "a.md"), "---\ntitle: Z\n---\n");
        await bumpMtime(join(dir, "a.md"), 5000);
        const reloaded = await loadCorpus(dir, { cache: false });
        expect(reloaded.find((f) => f.meta.path === "a.md")!.meta.frontmatter).toEqual({ title: "Z" });
        expect(await readFile(cachePath(dir), "utf8")).toBe(beforeBytes);
    });

    it("does not parse .propsec/ or .obsidian/ as notes", async () => {
        // Pre-seed a stray .md inside the cache dir and an obsidian dir.
        await mkdir(join(dir, CACHE_DIR), { recursive: true });
        await writeFile(join(dir, CACHE_DIR, "stray.md"), "---\ntitle: Stray\n---\n");
        await mkdir(join(dir, ".obsidian"), { recursive: true });
        await writeFile(join(dir, ".obsidian", "note.md"), "---\ntitle: Obs\n---\n");

        const files = await loadCorpus(dir);
        const paths = files.map((f) => f.meta.path);
        expect(paths.some((p) => p.includes(".propsec"))).toBe(false);
        expect(paths.some((p) => p.includes(".obsidian"))).toBe(false);
        expect(paths.sort()).toEqual(["a.md", "b.md", "sub/c.md"]);
    });
});
