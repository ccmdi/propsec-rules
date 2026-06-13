/**
 * Obsidian-free abstraction of a file for schema targeting.
 * Paths use forward slashes and are corpus-relative.
 */
export interface FileMeta {
    path: string;        // corpus-relative path, forward slashes, includes extension (e.g. "Books/Dune.md")
    parentPath: string;  // directory portion, forward slashes, "" for root
    basename: string;    // filename without extension (e.g. "Dune")
    mtime: number;       // ms since epoch
    ctime: number;       // ms since epoch
    frontmatter: Record<string, unknown> | undefined;
    tags: string[];      // normalized tags WITHOUT leading '#', deduped (frontmatter tags now; inline body tags later)
}
