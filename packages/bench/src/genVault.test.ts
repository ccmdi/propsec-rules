import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    loadCorpus,
    validateCorpus,
    parseFrontmatter,
    type CorpusFile,
} from "@propsec/engine";
import { getMatchingSchemas } from "@propsec/core";
import { generateVault, bookSchemaConfig } from "./genVault.js";

async function walkMd(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walkMd(full)));
        else if (entry.name.endsWith(".md")) out.push(full);
    }
    return out;
}

describe("generateVault", () => {
    let dir: string;
    let corpus: CorpusFile[];
    const config = bookSchemaConfig();

    beforeAll(async () => {
        dir = await mkdtemp(join(tmpdir(), "bench-gen-"));
        // High dup/violation rates so the injection is reliably observable at count=20.
        await generateVault(dir, { count: 20, dupRate: 0.5, violationRate: 0.5 });
        corpus = await loadCorpus(dir);
    });

    afterAll(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("writes exactly 20 markdown files", async () => {
        const files = await walkMd(join(dir, "Books"));
        expect(files.length).toBe(20);
    });

    it("loads 20 corpus files", () => {
        expect(corpus.length).toBe(20);
    });

    it("every file has parseable, non-malformed frontmatter", async () => {
        const files = await walkMd(join(dir, "Books"));
        for (const f of files) {
            const text = await readFile(f, "utf8");
            const parsed = parseFrontmatter(text);
            expect(parsed.malformed).toBe(false);
            expect(parsed.data).toBeDefined();
        }
    });

    it("the config matches generated files (Book schema applies)", () => {
        const matched = corpus.filter(
            (f) => getMatchingSchemas(f.meta, config).length > 0
        );
        expect(matched.length).toBe(20);
        expect(getMatchingSchemas(corpus[0].meta, config)[0].name).toBe("Book");
    });

    it("dupRate > 0 yields at least one duplicate isbn across files", () => {
        const seen = new Set<string>();
        let dupes = 0;
        for (const f of corpus) {
            const isbn = f.meta.frontmatter?.isbn;
            if (typeof isbn !== "string") continue;
            if (seen.has(isbn)) dupes++;
            else seen.add(isbn);
        }
        expect(dupes).toBeGreaterThanOrEqual(1);
    });

    it("validateCorpus reports a duplicate_value violation from the unique isbn", () => {
        const violations = validateCorpus(corpus, config);
        const dupViolations = violations.filter((v) => v.type === "duplicate_value");
        expect(dupViolations.length).toBeGreaterThanOrEqual(1);
    });

    it("violationRate > 0 yields at least one validation violation", () => {
        const violations = validateCorpus(corpus, config);
        // Beyond duplicates, expect at least one schema violation (type/required/max).
        const schemaViolations = violations.filter(
            (v) => v.type !== "duplicate_value"
        );
        expect(schemaViolations.length).toBeGreaterThanOrEqual(1);
    });

    it("is deterministic: same seed -> identical files", async () => {
        const dir2 = await mkdtemp(join(tmpdir(), "bench-gen2-"));
        try {
            await generateVault(dir2, { count: 20, dupRate: 0.5, violationRate: 0.5 });
            const a = await walkMd(join(dir, "Books"));
            const b = await walkMd(join(dir2, "Books"));
            expect(b.length).toBe(a.length);
            // Compare one representative file's bytes.
            const nameA = a.map((p) => p.slice(dir.length)).sort()[0];
            const ca = await readFile(join(dir, nameA), "utf8");
            const cb = await readFile(join(dir2, nameA), "utf8");
            expect(cb).toBe(ca);
        } finally {
            await rm(dir2, { recursive: true, force: true });
        }
    });
});
