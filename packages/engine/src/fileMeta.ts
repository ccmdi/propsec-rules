import type { FileMeta } from "@propsec/core";
import { parseFrontmatter, type ParsedFrontmatter } from "./frontmatter.js";

export interface BuildFileMetaInput {
    path: string;    // corpus-relative path, forward slashes
    content: string;
    mtime: number;
    ctime: number;
}

function normalizeTags(raw: unknown): string[] {
    if (raw === null || raw === undefined) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    const seen = new Set<string>();
    for (const t of list) {
        if (t === null || t === undefined) continue;
        const tag = String(t).replace(/^#/, "");
        if (tag) seen.add(tag);
    }
    // TODO: inline body tags (needs body parse)
    return [...seen];
}

/**
 * Build an Obsidian-free FileMeta plus the parsed frontmatter from raw file content.
 * `path` must be corpus-relative with forward slashes.
 */
export function buildFileMeta(input: BuildFileMetaInput): { meta: FileMeta; parsed: ParsedFrontmatter } {
    const parsed = parseFrontmatter(input.content);
    const data = parsed.data;

    const slash = input.path.lastIndexOf("/");
    const parentPath = slash === -1 ? "" : input.path.slice(0, slash);
    const fileName = slash === -1 ? input.path : input.path.slice(slash + 1);
    const dot = fileName.lastIndexOf(".");
    const basename = dot <= 0 ? fileName : fileName.slice(0, dot);

    const meta: FileMeta = {
        path: input.path,
        parentPath,
        basename,
        mtime: input.mtime,
        ctime: input.ctime,
        frontmatter: data,
        tags: normalizeTags(data?.tags),
    };

    return { meta, parsed };
}
