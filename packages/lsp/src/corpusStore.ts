import { relative, resolve } from "node:path";
import { URI } from "vscode-uri";
import type { PropsecConfig } from "@propsec/core";
import { buildFileMeta, loadCorpus, type CorpusFile } from "@propsec/engine";

/** Normalize OS path separators to forward slashes (engine/targeting convention). */
function toForwardSlash(p: string): string {
    return p.replace(/\\/g, "/");
}

/**
 * In-memory corpus with an open-document overlay.
 *
 * `diskCorpus` is the last `loadCorpus` snapshot. Overlays hold the live text of
 * open documents and take precedence in `snapshot()` without mutating the disk map.
 * This is the only stateful piece of the server.
 */
export class CorpusStore {
    readonly rootDir: string;
    config: PropsecConfig | null;

    private diskCorpus = new Map<string, CorpusFile>();
    private overlays = new Map<string, CorpusFile>();

    constructor(rootDir: string, config: PropsecConfig | null) {
        this.rootDir = rootDir;
        this.config = config;
    }

    /** Convert an LSP document URI to a corpus-relative, forward-slash path. */
    uriToRelPath(uri: string): string {
        const fsPath = URI.parse(uri).fsPath;
        return toForwardSlash(relative(this.rootDir, fsPath));
    }

    /** Convert a corpus-relative path back to an LSP document URI. */
    relPathToUri(relPath: string): string {
        return URI.file(resolve(this.rootDir, relPath)).toString();
    }

    /** Re-run loadCorpus from disk, replacing the disk snapshot (overlays untouched). */
    async reload(): Promise<void> {
        const files = await loadCorpus(this.rootDir);
        this.diskCorpus = new Map(files.map((f) => [f.meta.path, f]));
    }

    /**
     * Store the live text of an open document as an overlay (keyed by relPath).
     * Open docs have no reliable disk mtime/ctime; we pass 0 — the engine only
     * uses these for date-based property filters, not for diagnostics positions.
     */
    overlay(relPath: string, content: string, mtime = 0, ctime = 0): void {
        this.overlays.set(relPath, buildFileMeta({ path: relPath, content, mtime, ctime }));
    }

    /** Drop an overlay (on didClose), reverting to the disk version if present. */
    removeOverlay(relPath: string): void {
        this.overlays.delete(relPath);
    }

    /**
     * Current corpus: overlay version wins over disk for the same path; overlay-only
     * (new, unsaved) files are included too.
     */
    snapshot(): CorpusFile[] {
        const merged = new Map<string, CorpusFile>(this.diskCorpus);
        for (const [relPath, file] of this.overlays) merged.set(relPath, file);
        return [...merged.values()];
    }
}
