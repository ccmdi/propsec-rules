import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileMeta } from "@propsec/core";
import { buildFileMeta } from "./fileMeta.js";
import type { ParsedFrontmatter } from "./frontmatter.js";

export interface CorpusFile {
    meta: FileMeta;
    parsed: ParsedFrontmatter;
}

const DEFAULT_IGNORE_DIRS = new Set(["node_modules"]);

function isIgnoredDir(name: string, extraIgnores: Set<string>): boolean {
    if (name.startsWith(".")) return true; // .obsidian, .git, etc.
    if (DEFAULT_IGNORE_DIRS.has(name)) return true;
    return extraIgnores.has(name);
}

/**
 * Recursively load all `*.md` files under `rootDir` into CorpusFiles.
 * Corpus-relative paths use forward slashes. Dirs starting with `.` and
 * `node_modules` are ignored by default; pass `options.ignore` for more.
 */
export async function loadCorpus(
    rootDir: string,
    options?: { ignore?: string[] }
): Promise<CorpusFile[]> {
    const extraIgnores = new Set(options?.ignore ?? []);
    const files: CorpusFile[] = [];

    async function walk(absDir: string, relDir: string): Promise<void> {
        const entries = await readdir(absDir, { withFileTypes: true });
        for (const entry of entries) {
            const name = entry.name;
            if (entry.isDirectory()) {
                if (isIgnoredDir(name, extraIgnores)) continue;
                await walk(join(absDir, name), relDir ? `${relDir}/${name}` : name);
            } else if (entry.isFile() && name.toLowerCase().endsWith(".md")) {
                const absPath = join(absDir, name);
                const relPath = relDir ? `${relDir}/${name}` : name;
                const [content, st] = await Promise.all([
                    readFile(absPath, "utf8"),
                    stat(absPath),
                ]);
                files.push(
                    buildFileMeta({
                        path: relPath,
                        content,
                        mtime: st.mtimeMs,
                        ctime: st.birthtimeMs, // creation time, NOT ctimeMs (inode change)
                    })
                );
            }
        }
    }

    await walk(rootDir, "");
    return files;
}
