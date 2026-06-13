import { getMatchingSchemas, type PropsecConfig } from "@propsec/core";
import type { Range } from "./position.js";
import type { ParsedFrontmatter } from "./frontmatter.js";
import type { CorpusFile } from "./corpus.js";

/** True if any matched schema defines `key` (case-insensitive) as a field. */
function schemaDefinesKey(
    files: CorpusFile,
    config: PropsecConfig,
    lowerKey: string
): boolean {
    const schemas = getMatchingSchemas(files.meta, config);
    for (const schema of schemas) {
        for (const field of schema.fields) {
            if (field.name.toLowerCase() === lowerKey) return true;
        }
    }
    return false;
}

/**
 * Every corpus file that (a) matches a schema DEFINING `key` (case-insensitive) AND
 * (b) has `key` present in its frontmatter, with the key's keyRange. Corpus order.
 */
export function findFieldReferences(
    files: CorpusFile[],
    config: PropsecConfig,
    key: string
): Array<{ path: string; range: Range }> {
    const lowerKey = key.toLowerCase();
    const out: Array<{ path: string; range: Range }> = [];
    for (const file of files) {
        const fp = file.parsed.positions.get(lowerKey);
        if (!fp) continue;
        if (!schemaDefinesKey(file, config, lowerKey)) continue;
        out.push({ path: file.meta.path, range: fp.keyRange });
    }
    return out;
}

/**
 * One symbol per top-level frontmatter key (name = original-cased key if recoverable
 * from parsed.data, else the lowercased key; range = keyRange).
 */
export function documentFieldSymbols(
    parsed: ParsedFrontmatter
): Array<{ name: string; range: Range }> {
    const originalCase = new Map<string, string>();
    if (parsed.data) {
        for (const k of Object.keys(parsed.data)) originalCase.set(k.toLowerCase(), k);
    }
    const out: Array<{ name: string; range: Range }> = [];
    for (const [lowerKey, fp] of parsed.positions) {
        out.push({ name: originalCase.get(lowerKey) ?? lowerKey, range: fp.keyRange });
    }
    return out;
}
