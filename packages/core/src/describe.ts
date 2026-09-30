import { parse, type Node } from "./expr/parse";

type Lit = Node & { kind: "lit" };

const isLit = (node: Node): node is Lit => node.kind === "lit";
const isId = (node: Node, name?: string): boolean => node.kind === "id" && (name === undefined || node.name === name);
const isFile = (node: Node, member: string): boolean =>
    node.kind === "member" && node.name === member && isId(node.object, "file");

function literal(value: Lit["value"]): string {
    if (value === null) return "empty";
    if (value === "") return "empty";
    return String(value);
}

function isDated(node: Node): boolean {
    return isFile(node, "mtime") || isFile(node, "ctime") || (node.kind === "call" && node.name === "date");
}

const NUMBER_WORDS: Record<string, string> = { "<": "is less than", "<=": "is at most", ">": "is more than", ">=": "is at least" };
const DATE_WORDS: Record<string, string> = { "<": "before", "<=": "on or before", ">": "after", ">=": "on or after" };

function term(node: Node, source: string, binder: string | null): string {
    if (isLit(node)) return literal(node.value);
    if (node.kind === "id") return node.name === "it" ? "the value" : node.name === binder ? "it" : node.name;
    if (isFile(node, "mtime")) return "modified";
    if (isFile(node, "ctime")) return "created";
    if (node.kind === "member" && isId(node.object, "file")) return `file ${node.name}`;
    if (node.kind === "member" && isId(node.object, "note")) return node.name;
    if (node.kind === "index" && isId(node.object, "note") && isLit(node.index)) return String(node.index.value);
    if (node.kind === "call" && node.name === "date" && node.args.length === 1 && isLit(node.args[0])) return literal(node.args[0].value);
    if (node.kind === "call" && node.name === "size" && node.args.length === 1) return `size of ${term(node.args[0], source, binder)}`;
    if (node.kind === "method" && node.name === "size" && node.args.length === 0) return `size of ${term(node.object, source, binder)}`;
    if (node.kind === "method" && node.name === "distinct" && node.args.length === 0) return `distinct ${term(node.object, source, binder)}`;
    if (node.kind === "list" && node.items.every(isLit)) return node.items.map(i => literal((i as Lit).value)).join(", ");
    return source.slice(node.start, node.end);
}

function phrase(node: Node, source: string, binder: string | null): string {
    const t = (n: Node) => term(n, source, binder);
    const p = (n: Node, within: "&&" | "||" | "!") => {
        const text = phrase(n, source, binder);
        const mixed = n.kind === "binary" && (n.op === "&&" || n.op === "||") && (within === "!" || n.op !== within);
        return mixed ? `(${text})` : text;
    };

    switch (node.kind) {
        case "binary": {
            if (node.op === "&&" || node.op === "||") {
                return `${p(node.left, node.op)} ${node.op === "&&" ? "and" : "or"} ${p(node.right, node.op)}`;
            }
            if (node.op === "==" && isFile(node.left, "folder") && isLit(node.right)) return `directly in ${literal(node.right.value)}`;
            if ((node.op === "==" || node.op === "!=") && isLit(node.right) && node.right.value === null) {
                return `${t(node.left)} is ${node.op === "==" ? "empty" : "set"}`;
            }
            if (node.op === "==") return `${t(node.left)} is ${t(node.right)}`;
            if (node.op === "!=") return `${t(node.left)} is not ${t(node.right)}`;
            if (node.op === "in") {
                if (node.right.kind === "list") return `${t(node.left)} is ${node.right.items.map(i => t(i)).join(" or ")}`;
                return `${t(node.right)} includes ${t(node.left)}`;
            }
            const words = isDated(node.left) || isDated(node.right) ? DATE_WORDS : NUMBER_WORDS;
            if (node.op in words) return `${t(node.left)} ${words[node.op]} ${t(node.right)}`;
            return source.slice(node.start, node.end);
        }
        case "unary": {
            if (node.op !== "!") return source.slice(node.start, node.end);
            const arg = node.arg;
            if (arg.kind === "call" && arg.name === "has" && arg.args.length === 1) return `without ${t(arg.args[0])}`;
            if (arg.kind === "method" && isId(arg.object, "file") && arg.name === "inFolder" && isLit(arg.args[0])) return `not in ${literal(arg.args[0].value)}`;
            if (arg.kind === "method" && isId(arg.object, "file") && arg.name === "hasTag" && isLit(arg.args[0])) return `not tagged #${literal(arg.args[0].value)}`;
            return `not ${p(arg, "!")}`;
        }
        case "call":
            if (node.name === "has" && node.args.length === 1) return `has ${t(node.args[0])}`;
            return source.slice(node.start, node.end);
        case "method": {
            const [first] = node.args;
            if (isId(node.object, "file") && first && isLit(first)) {
                if (node.name === "inFolder") return `in ${literal(first.value)}`;
                if (node.name === "hasTag") return `tagged #${literal(first.value)}`;
            }
            if ((node.name === "exists" || node.name === "all") && node.args.length === 2 && node.args[0].kind === "id") {
                const body = phrase(node.args[1], source, (node.args[0] as Node & { kind: "id" }).name);
                return `${node.name === "exists" ? "some item of" : "every item of"} ${t(node.object)}: ${body}`;
            }
            const self = t(node.object);
            if (node.name === "matches" && first && isLit(first)) return `${self} matches "${literal(first.value)}"`;
            if (node.name === "contains" && first) return `${self} contains ${t(first)}`;
            if (node.name === "startsWith" && first) return `${self} starts with ${t(first)}`;
            if (node.name === "endsWith" && first) return `${self} ends with ${t(first)}`;
            return source.slice(node.start, node.end);
        }
        default:
            return t(node);
    }
}

/**
 * Plain-language reading of a rule, e.g. `file.inFolder("Books") && !has(draft)`
 * reads "in Books and without draft". Parts it cannot phrase are kept as written;
 * a rule that does not parse is returned unchanged.
 */
export function describeRule(source: string): string {
    if (source.trim() === "") return "";
    try {
        return phrase(parse(source), source, null);
    } catch {
        return source;
    }
}
