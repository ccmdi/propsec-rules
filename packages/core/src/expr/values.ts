const NUMERIC = /^-?\d+(\.\d+)?$/;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/;

function isDigits(s: string, from: number, to: number): boolean {
    for (let i = from; i < to; i++) {
        const c = s.charCodeAt(i);
        if (c < 48 || c > 57) return false;
    }
    return true;
}

function isPlainDate(s: string): boolean {
    return s.length === 10 && s.charCodeAt(4) === 45 && s.charCodeAt(7) === 45
        && isDigits(s, 0, 4) && isDigits(s, 5, 7) && isDigits(s, 8, 10);
}

export function toNumber(v: unknown): number {
    if (typeof v === "number") return v;
    if (typeof v !== "string") return NaN;
    const t = v.trim();
    return NUMERIC.test(t) ? Number(t) : NaN;
}

export function toTime(v: unknown): number {
    if (v instanceof Date) return v.getTime();
    if (typeof v !== "string" || !DATE_PREFIX.test(v)) return NaN;
    return new Date(v).getTime();
}

function order(a: number | string, b: number | string): number {
    return a < b ? -1 : a > b ? 1 : a === b ? 0 : NaN;
}

export function cmp(a: unknown, b: unknown): number {
    if (typeof a === "number" && typeof b === "number") return order(a, b);
    if (typeof a === "string" && typeof b === "string" && isPlainDate(a) && isPlainDate(b)) return order(a, b);
    const na = toNumber(a);
    const nb = toNumber(b);
    if (na === na || nb === nb) return na === na && nb === nb ? order(na, nb) : NaN;
    const ta = toTime(a);
    const tb = toTime(b);
    if (ta === ta || tb === tb) return ta === ta && tb === tb ? order(ta, tb) : NaN;
    return typeof a === "string" && typeof b === "string" ? order(a, b) : NaN;
}

function deepEq(a: object, b: object): boolean {
    if (a instanceof Date || b instanceof Date) return toTime(a) === toTime(b);
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((x, i) => eq(x, b[i]));
    }
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return false;
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    return ka.every(k => k in rb && eq(ra[k], rb[k]));
}

export function eq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;
    const ta = typeof a;
    const tb = typeof b;
    if (ta === tb) return ta === "object" && deepEq(a as object, b as object);
    if (ta === "boolean" || tb === "boolean") return String(a) === String(b);
    if (ta === "number" || tb === "number") return toNumber(a) === toNumber(b);
    return a instanceof Date || b instanceof Date ? toTime(a) === toTime(b) : false;
}

export function typeName(v: unknown): string {
    if (v == null) return "null";
    if (Array.isArray(v)) return "list";
    if (v instanceof Date) return "date";
    const t = typeof v;
    return t === "object" ? "map" : t;
}

export function show(v: unknown): string {
    if (v === undefined) return "null";
    if (typeof v === "string") return v;
    if (v instanceof Date) return v.toISOString();
    return typeof v === "object" ? JSON.stringify(v) : String(v);
}
