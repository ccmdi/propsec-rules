export type BinaryOp =
    | "||" | "&&"
    | "==" | "!=" | "<" | "<=" | ">" | ">=" | "in"
    | "+" | "-" | "*" | "/" | "%";

interface Span {
    start: number;
    end: number;
}

export type Node = Span & (
    | { kind: "lit"; value: string | number | boolean | null }
    | { kind: "id"; name: string }
    | { kind: "list"; items: Node[] }
    | { kind: "unary"; op: "!" | "-"; arg: Node }
    | { kind: "binary"; op: BinaryOp; left: Node; right: Node }
    | { kind: "cond"; test: Node; then: Node; else: Node }
    | { kind: "member"; object: Node; name: string }
    | { kind: "index"; object: Node; index: Node }
    | { kind: "call"; name: string; args: Node[] }
    | { kind: "method"; object: Node; name: string; args: Node[] }
);

export class ExprError extends Error {
    constructor(message: string, readonly pos: number) {
        super(message);
        this.name = "ExprError";
    }
}

type TokenKind = "num" | "str" | "id" | "op" | "end";

interface Token extends Span {
    kind: TokenKind;
    text: string;
    value?: string | number;
}

const PUNCT = ["||", "&&", "==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "/", "%", "!", "?", ":", ".", ",", "(", ")", "[", "]"];
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\", '"': '"', "'": "'", "/": "/", b: "\b", f: "\f" };

function isDigit(c: number): boolean {
    return c >= 48 && c <= 57;
}

function isIdentStart(c: number): boolean {
    return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13) {
            i++;
            continue;
        }
        const start = i;
        if (isDigit(c)) {
            while (i < src.length && isDigit(src.charCodeAt(i))) i++;
            if (src[i] === "." && isDigit(src.charCodeAt(i + 1))) {
                i++;
                while (i < src.length && isDigit(src.charCodeAt(i))) i++;
            }
            const exponent = /^[eE][+-]?\d+/.exec(src.slice(i, i + 8));
            if (exponent) i += exponent[0].length;
            const text = src.slice(start, i);
            tokens.push({ kind: "num", text, value: Number(text), start, end: i });
            continue;
        }
        if (isIdentStart(c)) {
            while (i < src.length && (isIdentStart(src.charCodeAt(i)) || isDigit(src.charCodeAt(i)))) i++;
            tokens.push({ kind: "id", text: src.slice(start, i), start, end: i });
            continue;
        }
        if (c === 34 || c === 39) {
            const quote = src[i++];
            let value = "";
            while (i < src.length && src[i] !== quote) {
                if (src[i] !== "\\") {
                    value += src[i++];
                    continue;
                }
                const e = src[i + 1];
                if (e === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
                    value += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
                    i += 6;
                } else if (e in ESCAPES) {
                    value += ESCAPES[e];
                    i += 2;
                } else {
                    throw new ExprError(`Unknown escape \\${e ?? ""}`, i);
                }
            }
            if (i >= src.length) throw new ExprError("Unterminated string", start);
            i++;
            tokens.push({ kind: "str", text: src.slice(start, i), value, start, end: i });
            continue;
        }
        const punct = PUNCT.find(p => src.startsWith(p, i));
        if (!punct) throw new ExprError(`Unexpected character ${src[i]}`, i);
        i += punct.length;
        tokens.push({ kind: "op", text: punct, start, end: i });
    }
    tokens.push({ kind: "end", text: "", start: src.length, end: src.length });
    return tokens;
}

const LEVELS: BinaryOp[][] = [
    ["||"],
    ["&&"],
    ["==", "!=", "<", "<=", ">", ">=", "in"],
    ["+", "-"],
    ["*", "/", "%"],
];

export function parse(src: string): Node {
    const tokens = tokenize(src);
    let p = 0;

    const peek = (): Token => tokens[p];
    const isOp = (text: string): boolean => {
        const t = tokens[p];
        return t.text === text && (t.kind === "op" || (text === "in" && t.kind === "id"));
    };
    const eat = (text: string): boolean => {
        if (!isOp(text)) return false;
        p++;
        return true;
    };
    const expect = (text: string): Token => {
        if (!isOp(text)) throw new ExprError(`Expected ${text}`, peek().start);
        return tokens[p++];
    };

    function ternary(): Node {
        const test = binary(0);
        if (!eat("?")) return test;
        const then = ternary();
        expect(":");
        const otherwise = ternary();
        return { kind: "cond", test, then, else: otherwise, start: test.start, end: otherwise.end };
    }

    function binary(level: number): Node {
        if (level === LEVELS.length) return unary();
        let left = binary(level + 1);
        for (;;) {
            const op = LEVELS[level].find(isOp);
            if (!op) return left;
            p++;
            const right = binary(level + 1);
            left = { kind: "binary", op, left, right, start: left.start, end: right.end };
        }
    }

    function unary(): Node {
        const t = peek();
        if (eat("!") || eat("-")) {
            const arg = unary();
            if (t.text === "-" && arg.kind === "lit" && typeof arg.value === "number") {
                return { kind: "lit", value: -arg.value, start: t.start, end: arg.end };
            }
            return { kind: "unary", op: t.text as "!" | "-", arg, start: t.start, end: arg.end };
        }
        return postfix();
    }

    function args(close: string): { items: Node[]; end: number } {
        const items: Node[] = [];
        if (!isOp(close)) {
            do items.push(ternary());
            while (eat(","));
        }
        return { items, end: expect(close).end };
    }

    function postfix(): Node {
        let node = primary();
        for (;;) {
            if (eat(".")) {
                const name = peek();
                if (name.kind !== "id") throw new ExprError("Expected a name after .", name.start);
                p++;
                if (eat("(")) {
                    const a = args(")");
                    node = { kind: "method", object: node, name: name.text, args: a.items, start: node.start, end: a.end };
                } else {
                    node = { kind: "member", object: node, name: name.text, start: node.start, end: name.end };
                }
            } else if (eat("[")) {
                const index = ternary();
                node = { kind: "index", object: node, index, start: node.start, end: expect("]").end };
            } else {
                return node;
            }
        }
    }

    function primary(): Node {
        const t = peek();
        if (t.kind === "num" || t.kind === "str") {
            p++;
            return { kind: "lit", value: t.value!, start: t.start, end: t.end };
        }
        if (t.kind === "id") {
            p++;
            if (t.text === "true" || t.text === "false") return { kind: "lit", value: t.text === "true", start: t.start, end: t.end };
            if (t.text === "null") return { kind: "lit", value: null, start: t.start, end: t.end };
            if (t.text === "in") throw new ExprError("Unexpected in", t.start);
            if (eat("(")) {
                const a = args(")");
                return { kind: "call", name: t.text, args: a.items, start: t.start, end: a.end };
            }
            return { kind: "id", name: t.text, start: t.start, end: t.end };
        }
        if (eat("(")) {
            const inner = ternary();
            expect(")");
            return inner;
        }
        if (eat("[")) {
            const a = args("]");
            return { kind: "list", items: a.items, start: t.start, end: a.end };
        }
        throw new ExprError(t.kind === "end" ? "Unexpected end of expression" : `Unexpected ${t.text}`, t.start);
    }

    const root = ternary();
    if (peek().kind !== "end") throw new ExprError(`Unexpected ${peek().text}`, peek().start);
    return root;
}

export function conjuncts(node: Node): Node[] {
    return node.kind === "binary" && node.op === "&&"
        ? [...conjuncts(node.left), ...conjuncts(node.right)]
        : [node];
}
