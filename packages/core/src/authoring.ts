import { compileExpr, vocabulary, type ValueKind } from "./expr/compile";
import { ExprError, parse, type Node } from "./expr/parse";
import type { FieldType } from "./model";

export type RuleSlot = "where" | "when" | "must" | "exclude";

export interface Completion {
    label: string;
    detail: string;
    insert: string;
    kind: "helper" | "property" | "function" | "method" | "file" | "value";
}

export interface CompletionResult {
    from: number;
    to: number;
    items: Completion[];
}

export interface RuleContext {
    slot: RuleSlot;
    type?: FieldType;
    properties: string[];
}

export interface RuleCheck {
    error: { message: string; at: number } | null;
    warnings: string[];
}

const helper = (label: string, insert: string, detail = ""): Completion => ({ label, insert, detail, kind: "helper" });

const WHERE_HELPERS = [
    helper("in folder", 'file.inFolder("${Folder}")', "Notes in a folder or any folder below it"),
    helper("directly in folder", 'file.folder == "${Folder}"', "Notes in exactly this folder"),
    helper("has tag", 'file.hasTag("${tag}")', "Notes with a tag or a nested tag under it"),
    helper("file name matches", 'file.name.matches("${^Project-}")', "Notes whose name matches a pattern"),
    helper("has property", "has(${status})", "Notes where a property is present"),
    helper("property equals", '${status} == "done"', "Notes where a property has a value"),
    helper("modified after", 'file.mtime >= date("${2026-01-01}")', "Notes changed on or after a date"),
    helper("not in folder", '!file.inFolder("${Archive}")', "Leave out a folder"),
];

const WHEN_HELPERS = [
    helper("another property equals", '${status} == "done"', "Apply only when a property has a value"),
    helper("another property is one of", '${status} in ["done", "reading"]', "Apply only for some values"),
    helper("another property is present", "has(${status})", "Apply only when a property exists"),
    helper("in folder", 'file.inFolder("${Folder}")', "Apply only to notes in a folder"),
];

const ANY_HELPERS = [helper("compared to another property", "it >= ${start}", "Check this value against another property")];

const TYPE_HELPERS: Record<string, Completion[]> = {
    string: [
        helper("at most N characters", "size(it) <= ${120}"),
        helper("at least N characters", "size(it) >= ${1}"),
        helper("matches a pattern", 'it.matches("${^[A-Z]}")'),
        helper("one of these values", 'it in ["${a}", "b"]'),
        helper("starts with", 'it.startsWith("${prefix}")'),
    ],
    number: [
        helper("between", "it >= ${1} && it <= 5"),
        helper("at least", "it >= ${0}"),
        helper("at most", "it <= ${10}"),
        helper("whole number", "it % 1 == 0"),
    ],
    date: [
        helper("on or after", 'it >= "${2026-01-01}"'),
        helper("on or before", 'it <= "${2026-12-31}"'),
    ],
    array: [
        helper("at least N items", "size(it) >= ${1}"),
        helper("at most N items", "size(it) <= ${5}"),
        helper("contains a value", '"${value}" in it'),
        helper("has an item matching", 'it.exists(x, x.matches("${^prefix/}"))'),
        helper("every item is one of", 'it.all(x, x in ["${a}", "b"])'),
        helper("no duplicates", "size(it.distinct()) == size(it)"),
    ],
    boolean: [helper("must be true", "it == true")],
};

const KIND_OF_TYPE: Record<string, ValueKind> = { string: "string", date: "string", array: "list" };

export function helpersFor(context: RuleContext): Completion[] {
    if (context.slot === "where" || context.slot === "exclude") return WHERE_HELPERS;
    if (context.slot === "when") return WHEN_HELPERS;
    return [...(TYPE_HELPERS[context.type ?? ""] ?? []), ...ANY_HELPERS];
}

export function expandSnippet(insert: string): { text: string; select: [number, number] } {
    const start = insert.indexOf("${");
    if (start < 0) return { text: insert, select: [insert.length, insert.length] };
    const end = insert.indexOf("}", start);
    const inner = insert.slice(start + 2, end);
    return { text: insert.slice(0, start) + inner + insert.slice(end + 1), select: [start, start + inner.length] };
}

function insideString(text: string): boolean {
    let quote: string | null = null;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (quote !== null && ch === "\\") i++;
        else if (quote === null && (ch === '"' || ch === "'")) quote = ch;
        else if (ch === quote) quote = null;
    }
    return quote !== null;
}

function rank(items: Completion[], prefix: string): Completion[] {
    const p = prefix.toLowerCase();
    if (!p) return items;
    const starts = items.filter(c => c.label.toLowerCase().startsWith(p));
    const within = items.filter(c => !c.label.toLowerCase().startsWith(p) && c.label.toLowerCase().indexOf(p) >= 0);
    return [...starts, ...within];
}

export function completeRule(source: string, cursor: number, context: RuleContext, explicit = false): CompletionResult {
    const before = source.slice(0, cursor);
    const prefix = /[A-Za-z_][A-Za-z0-9_]*$/.exec(before)?.[0] ?? "";
    const from = cursor - prefix.length;
    const empty: CompletionResult = { from, to: cursor, items: [] };
    if (insideString(before)) return empty;

    const words = vocabulary();
    const lead = before.slice(0, from);

    if (lead.endsWith(".")) {
        const object = /([A-Za-z_][A-Za-z0-9_]*)\s*\.$/.exec(lead)?.[1];
        if (object === "file") {
            return { from, to: cursor, items: rank(words.filter(w => w.kind === "file").map(w => ({ label: w.name, detail: w.doc, insert: w.insert, kind: "file" as const })), prefix) };
        }
        const kind = object === "it" ? KIND_OF_TYPE[context.type ?? ""] : undefined;
        const methods = words.filter(w => w.kind === "method" && (!kind || w.on === "any" || w.on === kind));
        return { from, to: cursor, items: rank(methods.map(w => ({ label: w.name, detail: w.doc, insert: w.insert, kind: "method" as const })), prefix) };
    }

    const atStart = /(^|&&|\|\||[(!?:])\s*$/.test(lead);
    if (!prefix && !atStart && !explicit) return empty;
    const helpers = atStart ? helpersFor(context) : [];
    const values: Completion[] = [
        ...(context.slot === "must" ? [{ label: "it", detail: "This field's value", insert: "it", kind: "value" as const }] : []),
        { label: "file", detail: "The note's file: path, name, folder, tags, dates", insert: "file.", kind: "value" },
        ...context.properties.map(name => ({
            label: name,
            detail: "Property",
            insert: /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `note[${JSON.stringify(name)}]`,
            kind: "property" as const,
        })),
        ...words.filter(w => w.kind === "function").map(w => ({ label: w.name, detail: w.doc, insert: w.insert, kind: "function" as const })),
    ];
    const items = prefix ? [...rank(values, prefix), ...rank(helpers, prefix)] : [...helpers, ...values];
    return { from, to: cursor, items };
}

function negatedProperties(node: Node, out: string[]): void {
    if (node.kind === "unary" && node.op === "!") {
        const arg = node.arg;
        if (arg.kind === "id" && arg.name !== "file" && arg.name !== "note") out.push(arg.name);
        if (arg.kind === "member" && arg.object.kind === "id" && arg.object.name === "note") out.push(arg.name);
    }
    for (const key of Object.keys(node) as (keyof Node)[]) {
        const child = node[key] as unknown;
        if (Array.isArray(child)) child.forEach(c => c && typeof c === "object" && "kind" in c && negatedProperties(c as Node, out));
        else if (child && typeof child === "object" && "kind" in child) negatedProperties(child as Node, out);
    }
}

export function checkRule(source: string, known: string[] | null): RuleCheck {
    if (source.trim() === "") return { error: null, warnings: [] };
    try {
        const expr = compileExpr(source);
        const warnings: string[] = [];
        const negated: string[] = [];
        negatedProperties(parse(source), negated);
        for (const name of negated) {
            warnings.push(`!${name} is only true when ${name} is exactly false. To mean "not true", write ${name} != true.`);
        }
        if (known) {
            const lower = new Set(known.map(k => k.toLowerCase()));
            for (const ref of expr.refs) {
                if (!lower.has(ref.toLowerCase())) warnings.push(`"${ref}" is not a property any note uses yet.`);
            }
        }
        return { error: null, warnings };
    } catch (e) {
        return {
            error: { message: e instanceof Error ? e.message : String(e), at: e instanceof ExprError ? e.pos : 0 },
            warnings: [],
        };
    }
}
