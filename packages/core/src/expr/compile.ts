import type { FileMeta } from "../model";
import { ExprError, parse, type Node } from "./parse";
import { cmp, eq, show, toNumber, toTime, typeName } from "./values";

type Fn = (file: FileMeta, it: unknown, slots: unknown[]) => unknown;

export interface Expr {
    readonly source: string;
    readonly refs: ReadonlyArray<string>;
    value(file: FileMeta, it?: unknown): unknown;
    test(file: FileMeta, it?: unknown): boolean;
}

interface Build {
    scope: Map<string, number>;
    state: { slots: number; refs: Set<string> };
}

const own = Object.prototype.hasOwnProperty;
const RESERVED = ["it", "file", "note"];

export function keyOf(record: Record<string, unknown> | undefined, name: string, lower: string): string | undefined {
    if (!record) return undefined;
    if (own.call(record, name)) return name;
    for (const key in record) {
        if (key.length === name.length && own.call(record, key) && key.toLowerCase() === lower) return key;
    }
    return undefined;
}

function property(name: string, b: Build): Fn {
    const lower = name.toLowerCase();
    b.state.refs.add(name);
    return file => {
        const key = keyOf(file.frontmatter, name, lower);
        if (key === undefined) return null;
        const v = file.frontmatter![key];
        return v === undefined ? null : v;
    };
}

function presence(node: Node, b: Build): Fn {
    const named = node.kind === "id" && !b.scope.has(node.name) && RESERVED.indexOf(node.name) < 0
        ? node.name
        : node.kind === "member" && isRoot(node.object, "note", b)
            ? node.name
            : node.kind === "index" && isRoot(node.object, "note", b) && node.index.kind === "lit" && typeof node.index.value === "string"
                ? node.index.value
                : undefined;
    if (named !== undefined) {
        const lower = named.toLowerCase();
        b.state.refs.add(named);
        return file => keyOf(file.frontmatter, named, lower) !== undefined;
    }
    const value = build(node, b);
    return (f, it, s) => value(f, it, s) != null;
}

function isRoot(node: Node, name: string, b: Build): boolean {
    return node.kind === "id" && node.name === name && !b.scope.has(name);
}

const FILE_FIELDS: Record<string, (file: FileMeta) => unknown> = {
    path: f => f.path,
    name: f => f.basename,
    folder: f => f.parentPath,
    tags: f => f.tags,
    mtime: f => f.mtime,
    ctime: f => f.ctime,
};

const FILE_METHODS: Record<string, (arg: string) => (file: FileMeta) => boolean> = {
    hasTag: tag => {
        const nested = tag + "/";
        return f => {
            for (const t of f.tags) if (t === tag || t.startsWith(nested)) return true;
            return false;
        };
    },
    inFolder: folder => {
        const prefix = folder + "/";
        return f => f.path.startsWith(prefix);
    },
};

function size(v: unknown): unknown {
    if (typeof v === "string" || Array.isArray(v)) return v.length;
    return v !== null && typeof v === "object" && !(v instanceof Date) ? Object.keys(v).length : null;
}

function regex(pattern: unknown, flags: unknown): RegExp | null {
    if (typeof pattern !== "string") return null;
    if (flags !== undefined && (typeof flags !== "string" || !/^[imsu]*$/.test(flags))) return null;
    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

function matches(v: unknown, re: RegExp | null): boolean {
    return re !== null && v != null && typeof v !== "object" && re.test(String(v));
}

function contains(v: unknown, needle: unknown): boolean {
    if (Array.isArray(v)) return v.some(x => eq(x, needle));
    return v != null && needle != null && typeof v !== "object" && String(v).indexOf(show(needle)) >= 0;
}

function distinct(v: unknown): unknown {
    if (!Array.isArray(v)) return null;
    const seen = new Set<string>();
    return v.filter(x => {
        const key = JSON.stringify(x);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

const FUNCTIONS: Record<string, { arity: number; fn: (...args: unknown[]) => unknown }> = {
    size: { arity: 1, fn: size },
    type: { arity: 1, fn: typeName },
    string: { arity: 1, fn: v => (v == null ? null : show(v)) },
    number: {
        arity: 1,
        fn: v => {
            const n = toNumber(v);
            return n === n ? n : null;
        },
    },
    date: {
        arity: 1,
        fn: v => {
            const t = typeof v === "number" ? v : v instanceof Date ? v.getTime() : typeof v === "string" ? new Date(v).getTime() : NaN;
            return t === t ? t : null;
        },
    },
};

const METHODS: Record<string, { min: number; max: number; fn: (self: unknown, ...args: unknown[]) => unknown }> = {
    matches: { min: 1, max: 2, fn: (v, pattern, flags) => matches(v, regex(pattern, flags)) },
    contains: { min: 1, max: 1, fn: contains },
    startsWith: { min: 1, max: 1, fn: (v, p) => typeof v === "string" && typeof p === "string" && v.startsWith(p) },
    endsWith: { min: 1, max: 1, fn: (v, p) => typeof v === "string" && typeof p === "string" && v.endsWith(p) },
    lower: { min: 0, max: 0, fn: v => (typeof v === "string" ? v.toLowerCase() : null) },
    upper: { min: 0, max: 0, fn: v => (typeof v === "string" ? v.toUpperCase() : null) },
    size: { min: 0, max: 0, fn: size },
    distinct: { min: 0, max: 0, fn: distinct },
};

const QUANTIFIERS = ["exists", "all"];

function literal(node: Node | undefined): node is Node & { kind: "lit" } {
    return node !== undefined && node.kind === "lit";
}

function arithmetic(op: "+" | "-" | "*" | "/" | "%", l: Fn, r: Fn): Fn {
    return (f, it, s) => {
        const a = l(f, it, s);
        const c = r(f, it, s);
        if (typeof a === "number" && typeof c === "number") {
            switch (op) {
                case "+": return a + c;
                case "-": return a - c;
                case "*": return a * c;
                case "/": return c === 0 ? null : a / c;
                case "%": return c === 0 ? null : a % c;
            }
        }
        if (op !== "+") return null;
        if (typeof a === "string" && typeof c === "string") return a + c;
        return Array.isArray(a) && Array.isArray(c) ? a.concat(c) : null;
    };
}

function comparison(op: "<" | "<=" | ">" | ">=", l: Fn, right: Node, b: Build): Fn {
    if (literal(right) && typeof right.value === "number") {
        const n = right.value;
        switch (op) {
            case "<": return (f, it, s) => { const a = l(f, it, s); return typeof a === "number" ? a < n : cmp(a, n) < 0; };
            case "<=": return (f, it, s) => { const a = l(f, it, s); return typeof a === "number" ? a <= n : cmp(a, n) <= 0; };
            case ">": return (f, it, s) => { const a = l(f, it, s); return typeof a === "number" ? a > n : cmp(a, n) > 0; };
            case ">=": return (f, it, s) => { const a = l(f, it, s); return typeof a === "number" ? a >= n : cmp(a, n) >= 0; };
        }
    }
    const r = build(right, b);
    switch (op) {
        case "<": return (f, it, s) => cmp(l(f, it, s), r(f, it, s)) < 0;
        case "<=": return (f, it, s) => cmp(l(f, it, s), r(f, it, s)) <= 0;
        case ">": return (f, it, s) => cmp(l(f, it, s), r(f, it, s)) > 0;
        case ">=": return (f, it, s) => cmp(l(f, it, s), r(f, it, s)) >= 0;
    }
}

function membership(l: Fn, r: Fn): Fn {
    return (f, it, s) => {
        const a = l(f, it, s);
        const c = r(f, it, s);
        if (Array.isArray(c)) {
            for (let i = 0; i < c.length; i++) if (eq(c[i], a)) return true;
            return false;
        }
        return typeof a === "string" && c !== null && typeof c === "object" && own.call(c, a);
    };
}

function quantifier(node: Node & { kind: "method" }, b: Build): Fn {
    const binder = node.args[0];
    if (binder.kind !== "id") throw new ExprError(`${node.name} needs a variable name first`, binder.start);
    const slot = b.state.slots++;
    const list = build(node.object, b);
    const body = build(node.args[1], { scope: new Map(b.scope).set(binder.name, slot), state: b.state });
    const want = node.name === "exists";
    return (f, it, s) => {
        const items = list(f, it, s);
        if (!Array.isArray(items)) return false;
        for (let i = 0; i < items.length; i++) {
            s[slot] = items[i];
            if ((body(f, it, s) === true) === want) return want;
        }
        return !want;
    };
}

function method(node: Node & { kind: "method" }, b: Build): Fn {
    if (isRoot(node.object, "file", b)) {
        const make = FILE_METHODS[node.name];
        if (!make || node.args.length !== 1) throw new ExprError(`Unknown file.${node.name}()`, node.start);
        const first = node.args[0];
        if (literal(first) && typeof first.value === "string") return make(first.value);
        const arg = build(first, b);
        return (f, it, s) => {
            const v = arg(f, it, s);
            return typeof v === "string" && make(v)(f);
        };
    }
    const args = node.args.map(a => build(a, b));
    const def = METHODS[node.name];
    if (!def) throw new ExprError(`Unknown method ${node.name}`, node.start);
    if (args.length < def.min || args.length > def.max) throw new ExprError(`Wrong number of arguments for ${node.name}`, node.start);
    const self = build(node.object, b);
    if (node.name === "matches" && node.args.every(literal)) {
        const re = regex((node.args[0] as Node & { kind: "lit" }).value, node.args.length > 1 ? (node.args[1] as Node & { kind: "lit" }).value : undefined);
        if (re === null) throw new ExprError("Invalid regular expression", node.args[0].start);
        return (f, it, s) => matches(self(f, it, s), re);
    }
    const fn = def.fn;
    if (args.length === 0) return (f, it, s) => fn(self(f, it, s));
    if (args.length === 1) {
        const arg = args[0];
        return (f, it, s) => fn(self(f, it, s), arg(f, it, s));
    }
    return (f, it, s) => fn(self(f, it, s), ...args.map(a => a(f, it, s)));
}

function build(node: Node, b: Build): Fn {
    switch (node.kind) {
        case "lit": {
            const v = node.value;
            return () => v;
        }
        case "list": {
            const items = node.items.map(i => build(i, b));
            if (node.items.every(literal)) {
                const constant = node.items.map(i => (i as Node & { kind: "lit" }).value);
                return () => constant;
            }
            return (f, it, s) => items.map(i => i(f, it, s));
        }
        case "id": {
            const slot = b.scope.get(node.name);
            if (slot !== undefined) return (f, it, s) => s[slot];
            if (node.name === "it") return (f, it) => (it === undefined ? null : it);
            if (node.name === "file" || node.name === "note") throw new ExprError(`${node.name} needs a property, as in ${node.name}.x`, node.start);
            return property(node.name, b);
        }
        case "member": {
            if (isRoot(node.object, "file", b)) {
                const get = FILE_FIELDS[node.name];
                if (!get) throw new ExprError(`Unknown file.${node.name}`, node.start);
                return get;
            }
            if (isRoot(node.object, "note", b)) return property(node.name, b);
            const object = build(node.object, b);
            const name = node.name;
            return (f, it, s) => {
                const o = object(f, it, s);
                if (o === null || typeof o !== "object" || !own.call(o, name)) return null;
                const v = (o as Record<string, unknown>)[name];
                return v === undefined ? null : v;
            };
        }
        case "index": {
            if (isRoot(node.object, "note", b) && literal(node.index) && typeof node.index.value === "string") {
                return property(node.index.value, b);
            }
            const object = build(node.object, b);
            const index = build(node.index, b);
            return (f, it, s) => {
                const o = object(f, it, s);
                const i = index(f, it, s);
                if (o === null || typeof o !== "object" || (typeof i !== "string" && typeof i !== "number")) return null;
                if (!own.call(o, i)) return null;
                const v = (o as Record<string, unknown>)[i];
                return v === undefined ? null : v;
            };
        }
        case "call": {
            if (node.name === "has") {
                if (node.args.length !== 1) throw new ExprError("has takes one argument", node.start);
                return presence(node.args[0], b);
            }
            const def = FUNCTIONS[node.name];
            if (!def) throw new ExprError(`Unknown function ${node.name}`, node.start);
            if (node.args.length !== def.arity) throw new ExprError(`Wrong number of arguments for ${node.name}`, node.start);
            const arg = build(node.args[0], b);
            const fn = def.fn;
            if (literal(node.args[0])) {
                const constant = fn(node.args[0].value);
                return () => constant;
            }
            return (f, it, s) => fn(arg(f, it, s));
        }
        case "method":
            return QUANTIFIERS.indexOf(node.name) >= 0 && node.args.length === 2 ? quantifier(node, b) : method(node, b);
        case "unary": {
            const arg = build(node.arg, b);
            if (node.op === "!") return (f, it, s) => arg(f, it, s) === false;
            return (f, it, s) => {
                const v = arg(f, it, s);
                return typeof v === "number" ? -v : null;
            };
        }
        case "cond": {
            const test = build(node.test, b);
            const then = build(node.then, b);
            const otherwise = build(node.else, b);
            return (f, it, s) => (test(f, it, s) === true ? then(f, it, s) : otherwise(f, it, s));
        }
        case "binary": {
            const l = build(node.left, b);
            switch (node.op) {
                case "<": case "<=": case ">": case ">=":
                    return comparison(node.op, l, node.right, b);
            }
            const r = build(node.right, b);
            switch (node.op) {
                case "&&": return (f, it, s) => l(f, it, s) === true && r(f, it, s) === true;
                case "||": return (f, it, s) => l(f, it, s) === true || r(f, it, s) === true;
                case "==": return (f, it, s) => eq(l(f, it, s), r(f, it, s));
                case "!=": return (f, it, s) => !eq(l(f, it, s), r(f, it, s));
                case "in": return membership(l, r);
                default: return arithmetic(node.op, l, r);
            }
        }
    }
}

export function compileNode(node: Node, source: string): Expr {
    const state = { slots: 0, refs: new Set<string>() };
    const fn = build(node, { scope: new Map(), state });
    const slots: unknown[] = new Array(state.slots);
    const refs: string[] = [];
    state.refs.forEach(r => refs.push(r));
    return {
        source,
        refs,
        value: (file, it) => fn(file, it, slots),
        test: (file, it) => fn(file, it, slots) === true,
    };
}

export function compileExpr(source: string): Expr {
    return compileNode(parse(source), source);
}
