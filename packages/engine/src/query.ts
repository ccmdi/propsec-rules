import {
    type PropertyOperator,
    type PropsecConfig,
    type SchemaMapping,
    buildLowerKeyMap,
    lookupKey,
    evaluatePropertyOperator,
    fileMatchesQuery,
} from "@propsec/core";
import type { CorpusFile } from "./corpus.js";

export interface QueryFilter {
    field: string;
    operator: PropertyOperator;
    value: string;
}

export interface Query {
    targeting?: string;
    filters: QueryFilter[];
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

// Query operator token -> PropertyOperator. Longest tokens matched first.
const OPERATOR_TOKENS: Array<[string, PropertyOperator]> = [
    [">=", "greater_or_equal"],
    ["<=", "less_or_equal"],
    ["==", "equals"],
    ["!=", "not_equals"],
    ["=", "equals"],
    [">", "greater_than"],
    ["<", "less_than"],
];

const KEYWORDS = ["where", "sort by", "limit", "select"] as const;

interface KeywordHit {
    keyword: (typeof KEYWORDS)[number];
    index: number;
    length: number;
}

/**
 * Replace every double-quoted span with same-length filler so keyword matching
 * never fires inside a quoted value. Indices stay aligned with the original.
 */
function maskQuotes(input: string): string {
    let out = "";
    let inQuote = false;
    for (const ch of input) {
        if (ch === '"') {
            inQuote = !inQuote;
            out += '"';
        } else if (inQuote) {
            out += "\0";
        } else {
            out += ch;
        }
    }
    return out;
}

/**
 * Find the first occurrence of any top-level keyword (case-insensitive),
 * matched only on word boundaries so a field/value containing "where" etc. is
 * safe. `masked` is the quote-masked view; indices map back to the original.
 */
function findFirstKeyword(masked: string, from: number): KeywordHit | undefined {
    let best: KeywordHit | undefined;
    for (const keyword of KEYWORDS) {
        const re = new RegExp(`(^|\\s)${keyword.replace(/ /g, "\\s+")}(\\s|$)`, "i");
        const slice = masked.slice(from);
        const m = re.exec(slice);
        if (!m) continue;
        // index of the keyword itself (skip a leading whitespace captured by group 1)
        const idx = from + m.index + (m[1] ? m[1].length : 0);
        const len = m[0].length - (m[1] ? m[1].length : 0) - (m[2] ? m[2].length : 0);
        if (best === undefined || idx < best.index) {
            best = { keyword, index: idx, length: len };
        }
    }
    return best;
}

/** Strip surrounding double quotes from a value token; barewords pass through. */
function unquote(token: string): string {
    const t = token.trim();
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
        return t.slice(1, -1);
    }
    return t;
}

/**
 * Split a clause into top-level `and`-separated conditions (case-insensitive),
 * ignoring `and` that appears inside a double-quoted value.
 */
function splitConditions(clause: string): string[] {
    const parts: string[] = [];
    let buf = "";
    let inQuote = false;
    let i = 0;
    while (i < clause.length) {
        const ch = clause[i];
        if (ch === '"') {
            inQuote = !inQuote;
            buf += ch;
            i++;
            continue;
        }
        if (!inQuote) {
            const rest = clause.slice(i);
            const m = /^(\s+and\s+)/i.exec(rest);
            if (m) {
                parts.push(buf);
                buf = "";
                i += m[0].length;
                continue;
            }
        }
        buf += ch;
        i++;
    }
    if (buf.trim()) parts.push(buf);
    return parts.map((p) => p.trim()).filter(Boolean);
}

function parseCondition(raw: string): QueryFilter {
    const cond = raw.trim();
    if (!cond) throw new Error("Empty condition in where clause");

    // Word operators: `<field> exists`, `<field> missing`, `<field> not exists`,
    // `<field> contains <value>`, `<field> not contains <value>`, `<field> !contains <value>`.
    // Try these before symbol operators so "contains"/"exists" aren't mis-split.
    const nullaryMatch = /^(.+?)\s+(exists|missing|!exists|not\s+exists)$/i.exec(cond);
    if (nullaryMatch) {
        const field = nullaryMatch[1].trim();
        const tok = nullaryMatch[2].toLowerCase().replace(/\s+/g, " ");
        const op: PropertyOperator = tok === "exists" ? "exists" : "not_exists";
        if (!field) throw new Error(`Condition is missing a field: "${cond}"`);
        return { field, operator: op, value: "" };
    }

    const notContainsMatch = /^(.+?)\s+(?:!contains|not\s+contains)\s+(.+)$/i.exec(cond);
    if (notContainsMatch) {
        const field = notContainsMatch[1].trim();
        if (!field) throw new Error(`Condition is missing a field: "${cond}"`);
        return { field, operator: "not_contains", value: unquote(notContainsMatch[2]) };
    }

    const containsMatch = /^(.+?)\s+contains\s+(.+)$/i.exec(cond);
    if (containsMatch) {
        const field = containsMatch[1].trim();
        if (!field) throw new Error(`Condition is missing a field: "${cond}"`);
        return { field, operator: "contains", value: unquote(containsMatch[2]) };
    }

    // Symbol operators: scan for the first top-level symbol (outside quotes).
    let inQuote = false;
    for (let i = 0; i < cond.length; i++) {
        const ch = cond[i];
        if (ch === '"') {
            inQuote = !inQuote;
            continue;
        }
        if (inQuote) continue;
        for (const [tok, op] of OPERATOR_TOKENS) {
            if (cond.startsWith(tok, i)) {
                const field = cond.slice(0, i).trim();
                const value = cond.slice(i + tok.length).trim();
                if (!field) throw new Error(`Condition is missing a field: "${cond}"`);
                if (!value) throw new Error(`Condition is missing a value: "${cond}"`);
                return { field, operator: op, value: unquote(value) };
            }
        }
    }

    throw new Error(`Condition is missing an operator: "${cond}"`);
}

/**
 * Parse a query string into a structured Query.
 * Grammar (keywords case-insensitive):
 *   [<targeting>] [where <cond> [and <cond>]*] [sort by <field> [asc|desc]] [limit <n>] [select <field>[, <field>]*]
 */
export function parseQuery(input: string): Query {
    const text = input ?? "";
    const masked = maskQuotes(text);

    // Locate each top-level keyword in order; everything before the first is targeting.
    // Keyword detection runs over the quote-masked view so a keyword inside a
    // quoted value isn't treated as a clause boundary.
    const hits: KeywordHit[] = [];
    let cursor = 0;
    while (cursor <= text.length) {
        const hit = findFirstKeyword(masked, cursor);
        if (!hit) break;
        hits.push(hit);
        cursor = hit.index + hit.length;
    }

    const query: Query = { filters: [] };

    const firstIndex = hits.length > 0 ? hits[0].index : text.length;
    const targeting = text.slice(0, firstIndex).trim();
    if (targeting) query.targeting = targeting;

    // Slice the segment that belongs to each keyword (its text up to the next keyword).
    for (let h = 0; h < hits.length; h++) {
        const hit = hits[h];
        const segStart = hit.index + hit.length;
        const segEnd = h + 1 < hits.length ? hits[h + 1].index : text.length;
        const segment = text.slice(segStart, segEnd).trim();

        switch (hit.keyword) {
            case "where": {
                if (!segment) throw new Error("`where` requires at least one condition");
                const conds = splitConditions(segment);
                if (conds.length === 0) throw new Error("`where` requires at least one condition");
                for (const c of conds) query.filters.push(parseCondition(c));
                break;
            }
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
    if (!frontmatter) return undefined;
    const map = buildLowerKeyMap(frontmatter);
    const key = lookupKey(map, field);
    return key === undefined ? undefined : frontmatter[key];
}

function keyExists(frontmatter: Record<string, unknown> | undefined, field: string): boolean {
    if (!frontmatter) return false;
    const map = buildLowerKeyMap(frontmatter);
    return lookupKey(map, field) !== undefined;
}

/**
 * Evaluate a single filter against a file's frontmatter, mirroring how
 * query/matcher.ts treats missing properties.
 */
function filterPasses(frontmatter: Record<string, unknown> | undefined, filter: QueryFilter): boolean {
    const { operator, value } = filter;
    const exists = keyExists(frontmatter, filter.field);

    if (operator === "exists") return exists;
    if (operator === "not_exists") return !exists;

    if (!exists) {
        // Missing prop matches the negative operators (as in matcher.ts evaluateCondition).
        return operator === "not_equals" || operator === "not_contains";
    }

    const propValue = getValue(frontmatter, filter.field);
    return evaluatePropertyOperator(propValue, operator, value);
}

/** Distinct schema-defined field names across the given schemas. */
function schemaFieldSet(schemas: SchemaMapping[]): Set<string> {
    const set = new Set<string>();
    for (const s of schemas) {
        for (const f of s.fields) set.add(f.name.toLowerCase());
    }
    return set;
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

/**
 * Execute a parsed Query against an in-memory corpus.
 */
export function executeQuery(files: CorpusFile[], config: PropsecConfig, query: Query): QueryResult {
    const warnings: string[] = [];

    // 1. Targeting candidates.
    const candidates = query.targeting
        ? files.filter((f) => fileMatchesQuery(f.meta, query.targeting!))
        : files;

    // 2. Filters (ANDed).
    let matched = candidates.filter((f) =>
        query.filters.every((flt) => filterPasses(f.meta.frontmatter, flt))
    );

    // 3. Typed field validation -> warnings.
    const scoped = scopeSchemas(files, config, query.targeting);
    const fieldSet = schemaFieldSet(scoped);

    const referenced = referencedFields(query);
    const seenWarn = new Set<string>();
    for (const field of referenced) {
        if (!fieldSet.has(field.toLowerCase()) && !seenWarn.has(field.toLowerCase())) {
            seenWarn.add(field.toLowerCase());
            warnings.push(`field "${field}" is not defined in any schema in scope`);
        }
    }

    // 4. Sort.
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

    // 5. Limit.
    if (query.limit !== undefined) {
        matched = matched.slice(0, query.limit);
    }

    // 6. Columns / projection.
    const columns = query.select ?? distinctReferencedColumns(query);

    const rows: QueryRow[] = matched.map((f) => {
        const values: Record<string, unknown> = {};
        for (const col of columns) {
            values[col] = getValue(f.meta.frontmatter, col);
        }
        return { path: f.meta.path, values };
    });

    return { rows, warnings, columns };
}

/** Fields referenced anywhere in the query (filters + sortBy + select). */
function referencedFields(query: Query): string[] {
    const out: string[] = [];
    for (const f of query.filters) out.push(f.field);
    if (query.sortBy) out.push(query.sortBy.field);
    if (query.select) out.push(...query.select);
    return out;
}

/** Distinct fields referenced across filters + sortBy, in first-seen order. */
function distinctReferencedColumns(query: Query): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (f: string) => {
        const k = f.toLowerCase();
        if (!seen.has(k)) {
            seen.add(k);
            out.push(f);
        }
    };
    for (const f of query.filters) push(f.field);
    if (query.sortBy) push(query.sortBy.field);
    return out;
}

/**
 * Schemas whose targeting overlaps the query targeting. With no targeting,
 * all configured schemas are in scope. With targeting, a schema is in scope
 * when any file the targeting selects also matches that schema's own query
 * (overlap by the targeting DSL, ignoring property filters/exclusions so the
 * scope is about WHICH schema applies, not per-file validity).
 */
function scopeSchemas(
    files: CorpusFile[],
    config: PropsecConfig,
    targeting: string | undefined
): SchemaMapping[] {
    if (!targeting) return config.schemaMappings;

    const candidates = files.filter((f) => fileMatchesQuery(f.meta, targeting));
    return config.schemaMappings.filter(
        (s) => s.query && candidates.some((f) => fileMatchesQuery(f.meta, s.query))
    );
}
