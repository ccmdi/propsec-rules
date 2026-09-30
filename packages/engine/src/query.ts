import { type Program, compileExpr, keyOf } from "@propsec/core";
import type { CorpusFile } from "./corpus.js";

export interface Query {
    filter?: string;
    sortBy?: { field: string; dir: "asc" | "desc" };
    limit?: number;
    select?: string[];
}

export interface QueryRow {
    path: string;
    values: Record<string, unknown>;
}

export interface QueryResult {
    rows: QueryRow[];
    warnings: string[];
    columns: string[];
}

const KEYWORDS = ["sort by", "limit", "select"] as const;

interface KeywordHit {
    keyword: (typeof KEYWORDS)[number];
    index: number;
    length: number;
}

/**
 * Replace every quoted span with same-length filler so keyword matching
 * never fires inside a string. Indices stay aligned with the original.
 */
function maskQuotes(input: string): string {
    let out = "";
    let quote: string | null = null;
    for (const ch of input) {
        if (quote === null && (ch === '"' || ch === "'")) {
            quote = ch;
            out += ch;
        } else if (ch === quote) {
            quote = null;
            out += ch;
        } else {
            out += quote === null ? ch : "\0";
        }
    }
    return out;
}

/**
 * Find the first occurrence of any clause keyword (case-insensitive),
 * matched only on word boundaries. `masked` is the quote-masked view.
 */
function findFirstKeyword(masked: string, from: number): KeywordHit | undefined {
    let best: KeywordHit | undefined;
    for (const keyword of KEYWORDS) {
        const re = new RegExp(`(^|\\s)${keyword.replace(/ /g, "\\s+")}(\\s|$)`, "i");
        const m = re.exec(masked.slice(from));
        if (!m) continue;
        const idx = from + m.index + (m[1] ? m[1].length : 0);
        const len = m[0].length - (m[1] ? m[1].length : 0) - (m[2] ? m[2].length : 0);
        if (best === undefined || idx < best.index) {
            best = { keyword, index: idx, length: len };
        }
    }
    return best;
}

/** Strip surrounding double quotes from a field token; barewords pass through. */
function unquote(token: string): string {
    const t = token.trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        return t.slice(1, -1);
    }
    return t;
}

/**
 * Parse a query string into a structured Query.
 * Grammar (keywords case-insensitive):
 *   [<rule>] [sort by <field> [asc|desc]] [limit <n>] [select <field>[, <field>]*]
 * The rule is an expression, e.g. `file.inFolder("Books") && rating > 4`.
 */
export function parseQuery(input: string): Query {
    const text = input ?? "";
    const masked = maskQuotes(text);

    const hits: KeywordHit[] = [];
    let cursor = 0;
    while (cursor <= text.length) {
        const hit = findFirstKeyword(masked, cursor);
        if (!hit) break;
        hits.push(hit);
        cursor = hit.index + hit.length;
    }

    const query: Query = {};

    const firstIndex = hits.length > 0 ? hits[0].index : text.length;
    const filter = text.slice(0, firstIndex).trim();
    if (filter) {
        compileExpr(filter);
        query.filter = filter;
    }

    for (let h = 0; h < hits.length; h++) {
        const hit = hits[h];
        const segStart = hit.index + hit.length;
        const segEnd = h + 1 < hits.length ? hits[h + 1].index : text.length;
        const segment = text.slice(segStart, segEnd).trim();

        switch (hit.keyword) {
            case "sort by": {
                if (!segment) throw new Error("`sort by` requires a field");
                const m = /^(.+?)(?:\s+(asc|desc))?$/i.exec(segment);
                if (!m || !m[1].trim()) throw new Error("`sort by` requires a field");
                const field = unquote(m[1].trim());
                const dir = (m[2]?.toLowerCase() as "asc" | "desc" | undefined) ?? "asc";
                query.sortBy = { field, dir };
                break;
            }
            case "limit": {
                if (!/^\d+$/.test(segment)) {
                    throw new Error(`\`limit\` requires a non-negative integer, got: "${segment}"`);
                }
                query.limit = parseInt(segment, 10);
                break;
            }
            case "select": {
                const fields = segment
                    .split(",")
                    .map((f) => unquote(f.trim()))
                    .filter(Boolean);
                if (fields.length === 0) throw new Error("`select` requires at least one field");
                query.select = fields;
                break;
            }
        }
    }

    return query;
}

/** Read a frontmatter value by case-insensitive key; undefined if absent. */
function getValue(frontmatter: Record<string, unknown> | undefined, field: string): unknown {
    const key = keyOf(frontmatter, field, field.toLowerCase());
    return key === undefined ? undefined : frontmatter![key];
}

function isNumericLike(v: unknown): v is number {
    return typeof v === "number" && !Number.isNaN(v);
}

function asDate(v: unknown): number | null {
    if (typeof v !== "string") return null;
    // Require an ISO-ish date so plain strings aren't accidentally dates.
    if (!/^\d{4}-\d{2}(-\d{2})?([Tt].*)?$/.test(v.trim())) return null;
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
}

/**
 * Typed comparator: numeric if both numbers, else date if both ISO dates,
 * else string. Missing values (undefined/null) sort last regardless of dir.
 */
function compareValues(a: unknown, b: unknown): number {
    const aMissing = a === undefined || a === null;
    const bMissing = b === undefined || b === null;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    if (isNumericLike(a) && isNumericLike(b)) return a - b;

    const da = asDate(a);
    const db = asDate(b);
    if (da !== null && db !== null) return da - db;

    const sa = String(a);
    const sb = String(b);
    return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function distinctCaseless(fields: string[]): string[] {
    const seen = new Set<string>();
    return fields.filter((f) => {
        const k = f.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/**
 * Execute a parsed Query against an in-memory corpus.
 */
export function executeQuery(files: CorpusFile[], program: Program, query: Query): QueryResult {
    const rule = query.filter ? compileExpr(query.filter) : null;
    let matched = rule ? files.filter((f) => rule.test(f.meta)) : files;

    const defined = new Set<string>();
    for (const s of program.schemas) for (const f of s.schema.fields) defined.add(f.name.toLowerCase());

    const read = distinctCaseless([...(rule?.refs ?? []), ...(query.sortBy ? [query.sortBy.field] : [])]);
    const warnings = distinctCaseless([...read, ...(query.select ?? [])])
        .filter((field) => !defined.has(field.toLowerCase()))
        .map((field) => `field "${field}" is not defined in any schema`);

    if (query.sortBy) {
        const { field, dir } = query.sortBy;
        const factor = dir === "desc" ? -1 : 1;
        matched = [...matched].sort((fa, fb) => {
            const va = getValue(fa.meta.frontmatter, field);
            const vb = getValue(fb.meta.frontmatter, field);
            const aMissing = va === undefined || va === null;
            const bMissing = vb === undefined || vb === null;
            // Missing always sorts last, independent of direction.
            if (aMissing || bMissing) return compareValues(va, vb);
            return factor * compareValues(va, vb);
        });
    }

    if (query.limit !== undefined) {
        matched = matched.slice(0, query.limit);
    }

    const columns = query.select ?? read;

    const rows: QueryRow[] = matched.map((f) => {
        const values: Record<string, unknown> = {};
        for (const col of columns) {
            values[col] = getValue(f.meta.frontmatter, col);
        }
        return { path: f.meta.path, values };
    });

    return { rows, warnings, columns };
}
