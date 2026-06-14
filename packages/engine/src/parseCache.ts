import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CorpusFile } from "./corpus.js";
import type { FieldPositions } from "./frontmatter.js";

/**
 * Persisted, mtime+size-keyed parse cache. The expensive work in loadCorpus is the
 * position-preserving YAML parse; this lets unchanged files skip read+parse on a
 * later load. Validation is cheap and stays recomputed downstream, so ONLY parse
 * results (CorpusFile) are cached. Best-effort: any read/write error is swallowed
 * and the caller proceeds with a full parse.
 */

/** Bump to invalidate every cached entry (e.g. when CorpusFile/ParsedFrontmatter shape changes). */
export const CACHE_VERSION = 1;

export const CACHE_DIR = ".propsec";
export const CACHE_FILE = "cache.json";

/** CorpusFile with `parsed.positions` (a Map) flattened to entries for JSON. */
interface SerializedCorpusFile {
    meta: CorpusFile["meta"];
    parsed: Omit<CorpusFile["parsed"], "positions"> & {
        positions: Array<[string, FieldPositions]>;
    };
}

export interface CacheEntry {
    mtimeMs: number;
    size: number;
    file: SerializedCorpusFile;
}

export interface ParseCache {
    version: number;
    files: Record<string, CacheEntry>;
}

function serialize(file: CorpusFile): SerializedCorpusFile {
    const { positions, ...rest } = file.parsed;
    return { meta: file.meta, parsed: { ...rest, positions: [...positions] } };
}

function rehydrate(s: SerializedCorpusFile): CorpusFile {
    const { positions, ...rest } = s.parsed;
    return { meta: s.meta, parsed: { ...rest, positions: new Map(positions) } };
}

/** A cached entry is reusable only when both mtime and size match the current file. */
export function entryMatches(entry: CacheEntry, mtimeMs: number, size: number): boolean {
    return entry.mtimeMs === mtimeMs && entry.size === size;
}

export function rehydrateEntry(entry: CacheEntry): CorpusFile {
    return rehydrate(entry.file);
}

export function makeEntry(file: CorpusFile, mtimeMs: number, size: number): CacheEntry {
    return { mtimeMs, size, file: serialize(file) };
}

/** Load and validate the cache. Returns null on missing/corrupt/version-mismatch. */
export async function readCache(rootDir: string): Promise<ParseCache | null> {
    try {
        const raw = await readFile(join(rootDir, CACHE_DIR, CACHE_FILE), "utf8");
        const parsed = JSON.parse(raw) as unknown;
        if (
            !parsed ||
            typeof parsed !== "object" ||
            (parsed as ParseCache).version !== CACHE_VERSION ||
            typeof (parsed as ParseCache).files !== "object" ||
            (parsed as ParseCache).files === null
        ) {
            return null;
        }
        return parsed as ParseCache;
    } catch {
        return null; // missing or unreadable: behave as no cache
    }
}

/**
 * Atomically write the cache (temp file + rename). On Windows `rename` fails if the
 * destination exists, so we unlink the stale file first and fall back to a direct
 * write. Entirely best-effort: any failure is swallowed.
 */
export async function writeCache(rootDir: string, cache: ParseCache): Promise<void> {
    const dir = join(rootDir, CACHE_DIR);
    const dest = join(dir, CACHE_FILE);
    const tmp = join(dir, `cache.${process.pid}.${Date.now()}.tmp`);
    try {
        await mkdir(dir, { recursive: true });
        await writeFile(tmp, JSON.stringify(cache), "utf8");
        try {
            await rename(tmp, dest);
        } catch {
            // Windows: rename over an existing file can fail (EEXIST/EPERM).
            await unlink(dest).catch(() => {});
            try {
                await rename(tmp, dest);
            } catch {
                await writeFile(dest, JSON.stringify(cache), "utf8");
                await unlink(tmp).catch(() => {});
            }
        }
    } catch {
        await unlink(tmp).catch(() => {}); // leave no stray temp behind
    }
}
