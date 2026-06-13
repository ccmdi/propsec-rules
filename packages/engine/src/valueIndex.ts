import type { CorpusFile } from "./corpus.js";

/** Lowercased top-level field name -> distinct string-rendered scalar values seen across the corpus. */
export type ValueIndex = Map<string, string[]>;

function isScalar(v: unknown): v is string | number | boolean {
    const t = typeof v;
    return t === "string" || t === "number" || t === "boolean";
}

/**
 * Collect distinct, first-seen-ordered scalar values per top-level frontmatter key
 * across all files. Scalars are stringified via String(); array elements are
 * flattened (scalar elements only); objects/null/undefined are skipped.
 */
export function buildValueIndex(files: CorpusFile[]): ValueIndex {
    const index: ValueIndex = new Map();
    // Track membership per key to dedupe in O(1) while preserving insertion order.
    const seen = new Map<string, Set<string>>();

    const push = (key: string, value: string): void => {
        let set = seen.get(key);
        if (!set) {
            set = new Set();
            seen.set(key, set);
            index.set(key, []);
        }
        if (!set.has(value)) {
            set.add(value);
            index.get(key)!.push(value);
        }
    };

    for (const file of files) {
        const fm = file.meta.frontmatter;
        if (!fm) continue;
        for (const [rawKey, value] of Object.entries(fm)) {
            const key = rawKey.toLowerCase();
            if (isScalar(value)) {
                push(key, String(value));
            } else if (Array.isArray(value)) {
                for (const el of value) {
                    if (isScalar(el)) push(key, String(el));
                }
            }
            // objects / null / undefined are skipped
        }
    }

    return index;
}
