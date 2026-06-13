import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PropsecConfig } from "@propsec/core";
import { CorpusStore } from "./corpusStore.js";

function emptyConfig(): PropsecConfig {
    return { schemaMappings: [], customTypes: [], warnOnUnknownFields: true, allowObsidianProperties: true };
}

describe("CorpusStore path helpers", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "propsec-store-"));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it("uriToRelPath / relPathToUri round-trip a simple path", () => {
        const store = new CorpusStore(root, emptyConfig());
        const uri = store.relPathToUri("Books/Dune.md");
        expect(store.uriToRelPath(uri)).toBe("Books/Dune.md");
    });

    it("round-trips a path containing a space", () => {
        const store = new CorpusStore(root, emptyConfig());
        const rel = "Books/Brave New World.md";
        const uri = store.relPathToUri(rel);
        // URI form percent-encodes the spaces...
        expect(uri).toContain("%20");
        // ...but the round-trip decodes back to the original forward-slash relpath.
        expect(store.uriToRelPath(uri)).toBe(rel);
    });

    it("uriToRelPath yields forward slashes for a nested file URI", () => {
        const store = new CorpusStore(root, emptyConfig());
        const uri = store.relPathToUri("a/b/c.md");
        const rel = store.uriToRelPath(uri);
        expect(rel).toBe("a/b/c.md");
        expect(rel.includes("\\")).toBe(false);
    });
});

describe("CorpusStore overlay behavior", () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), "propsec-store-"));
    });
    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    function getByPath(store: CorpusStore, relPath: string) {
        return store.snapshot().find((f) => f.meta.path === relPath);
    }

    it("snapshot returns disk content before any overlay", async () => {
        await mkdir(join(root, "Books"), { recursive: true });
        await writeFile(join(root, "Books", "a.md"), "---\ntitle: Disk\n---\n", "utf8");

        const store = new CorpusStore(root, emptyConfig());
        await store.reload();

        const f = getByPath(store, "Books/a.md");
        expect(f).toBeDefined();
        expect(f!.meta.frontmatter?.title).toBe("Disk");
    });

    it("overlay precedence: snapshot returns overlay content over disk for same path", async () => {
        await mkdir(join(root, "Books"), { recursive: true });
        await writeFile(join(root, "Books", "a.md"), "---\ntitle: Disk\n---\n", "utf8");

        const store = new CorpusStore(root, emptyConfig());
        await store.reload();

        store.overlay("Books/a.md", "---\ntitle: Live\n---\n");
        expect(getByPath(store, "Books/a.md")!.meta.frontmatter?.title).toBe("Live");
    });

    it("removeOverlay reverts to disk content", async () => {
        await mkdir(join(root, "Books"), { recursive: true });
        await writeFile(join(root, "Books", "a.md"), "---\ntitle: Disk\n---\n", "utf8");

        const store = new CorpusStore(root, emptyConfig());
        await store.reload();
        store.overlay("Books/a.md", "---\ntitle: Live\n---\n");
        expect(getByPath(store, "Books/a.md")!.meta.frontmatter?.title).toBe("Live");

        store.removeOverlay("Books/a.md");
        expect(getByPath(store, "Books/a.md")!.meta.frontmatter?.title).toBe("Disk");
    });

    it("overlay-only (new unsaved) file appears in snapshot", async () => {
        const store = new CorpusStore(root, emptyConfig());
        await store.reload(); // disk is empty

        store.overlay("Notes/new.md", "---\ntitle: Unsaved\n---\n");
        const f = getByPath(store, "Notes/new.md");
        expect(f).toBeDefined();
        expect(f!.meta.frontmatter?.title).toBe("Unsaved");
    });

    it("reload does not drop active overlays", async () => {
        await mkdir(join(root, "Books"), { recursive: true });
        await writeFile(join(root, "Books", "a.md"), "---\ntitle: Disk\n---\n", "utf8");

        const store = new CorpusStore(root, emptyConfig());
        await store.reload();
        store.overlay("Books/a.md", "---\ntitle: Live\n---\n");

        await store.reload();
        expect(getByPath(store, "Books/a.md")!.meta.frontmatter?.title).toBe("Live");
    });
});
