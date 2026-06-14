import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileMeta } from "@propsec/core";
import { buildFileMeta } from "./fileMeta.js";
import type { ParsedFrontmatter } from "./frontmatter.js";
import {
    CACHE_VERSION,
    entryMatches,
    makeEntry,
    readCache,
    rehydrateEntry,
    writeCache,
    type CacheEntry,
    type ParseCache,
} from "./parseCache.js";

export interface CorpusFile {
    meta: FileMeta;
    parsed: ParsedFrontmatter;
}

const DEFAULT_IGNORE_DIRS = new Set(["node_modules"]);

// Cap concurrent fs ops to avoid EMFILE on Windows when scanning large vaults.
const FS_CONCURRENCY = 48;

function isIgnoredDir(name: string, extraIgnores: Set<string>): boolean {
    if (name.startsWith(".")) return true; // .obsidian, .propsec, .git, etc.
    if (DEFAULT_IGNORE_DIRS.has(name)) return true;
    return extraIgnores.has(name);
}

/** Run `worker` over `items` with at most `limit` in flight. Order-independent. */
async function mapWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    let next = 0;
    const runners: Promise<void>[] = [];
    const run = async (): Promise<void> => {
        while (next < items.length) {
            const i = next++;
            await worker(items[i]);
        }
    };
    for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(run());
    await Promise.all(runners);
}

interface FoundFile {
    absPath: string;
    relPath: string;
}

/**
 * Recursively load all `*.md` files under `rootDir` into CorpusFiles.
 * Corpus-relative paths use forward slashes. Dirs starting with `.` (`.obsidian`,
 * `.propsec`, `.git`) and `node_modules` are ignored by default; pass
 * `options.ignore` for more.
 *
 * Parse results are cached to `<rootDir>/.propsec/cache.json`, keyed by file
 * mtime+size, so unchanged files skip read+parse on a later call. `options.cache`
 * (default true) disables both reading and writing the cache.
 */
export async function loadCorpus(
    rootDir: string,
    options?: { ignore?: string[]; cache?: boolean }
): Promise<CorpusFile[]> {
    const extraIgnores = new Set(options?.ignore ?? []);
    const useCache = options?.cache !== false;

    // 1. Enumerate current .md files (readdir tree walk; reuses existing logic).
    const found: FoundFile[] = [];
    async function walk(absDir: string, relDir: string): Promise<void> {
        const entries = await readdir(absDir, { withFileTypes: true });
        for (const entry of entries) {
            const name = entry.name;
            if (entry.isDirectory()) {
                if (isIgnoredDir(name, extraIgnores)) continue;
                await walk(join(absDir, name), relDir ? `${relDir}/${name}` : name);
            } else if (entry.isFile() && name.toLowerCase().endsWith(".md")) {
                found.push({
                    absPath: join(absDir, name),
                    relPath: relDir ? `${relDir}/${name}` : name,
                });
            }
        }
    }
    await walk(rootDir, "");

    // 2. stat each file (bounded concurrency) for mtime + size.
    const stats = new Map<string, { mtimeMs: number; size: number; birthtimeMs: number }>();
    await mapWithConcurrency(found, FS_CONCURRENCY, async (f) => {
        const st = await stat(f.absPath);
        stats.set(f.relPath, { mtimeMs: st.mtimeMs, size: st.size, birthtimeMs: st.birthtimeMs });
    });

    // 3. Load the existing cache (best-effort; null on missing/corrupt/version mismatch).
    const oldCache = useCache ? await readCache(rootDir) : null;

    // 4. Partition into reuse (cache hit) vs reparse.
    const result = new Map<string, CorpusFile>();
    const newFiles: Record<string, CacheEntry> = {};
    const toParse: FoundFile[] = [];

    for (const f of found) {
        const st = stats.get(f.relPath)!;
        const entry = oldCache?.files[f.relPath];
        if (entry && entryMatches(entry, st.mtimeMs, st.size)) {
            result.set(f.relPath, rehydrateEntry(entry));
            newFiles[f.relPath] = entry; // carry forward unchanged
        } else {
            toParse.push(f);
        }
    }

    // 5. (Re)parse the misses with bounded concurrency (read + buildFileMeta).
    await mapWithConcurrency(toParse, FS_CONCURRENCY, async (f) => {
        const st = stats.get(f.relPath)!;
        const content = await readFile(f.absPath, "utf8");
        const file = buildFileMeta({
            path: f.relPath,
            content,
            mtime: st.mtimeMs,
            ctime: st.birthtimeMs, // creation time, NOT ctimeMs (inode change)
        });
        result.set(f.relPath, file);
        newFiles[f.relPath] = makeEntry(file, st.mtimeMs, st.size);
    });

    // 6. Assemble sorted by path for stable order.
    const files = [...result.values()].sort((a, b) => (a.meta.path < b.meta.path ? -1 : a.meta.path > b.meta.path ? 1 : 0));

    // 7. Persist the cache (only currently-existing files; drops deleted entries).
    if (useCache) {
        const next: ParseCache = { version: CACHE_VERSION, files: newFiles };
        await writeCache(rootDir, next);
    }

    return files;
}
