import { parseDocument, LineCounter, isMap, type Node } from "yaml";
import type { Position, Range } from "./position.js";

export interface FieldPositions {
    keyRange: Range;
    valueRange: Range;
}

export interface ParsedFrontmatter {
    data: Record<string, unknown> | undefined; // undefined if no frontmatter block
    positions: Map<string, FieldPositions>;     // key = lowercased top-level key
    blockRange: Range | null;                    // range of the YAML region (between the fences)
    malformed: boolean;                          // block exists but YAML failed to parse
    errors: string[];                            // yaml parse error messages
}

const EMPTY: ParsedFrontmatter = {
    data: undefined,
    positions: new Map(),
    blockRange: null,
    malformed: false,
    errors: [],
};

/**
 * Parse a markdown file's leading YAML frontmatter, preserving file-absolute
 * 0-based positions for every top-level key/value.
 *
 * A frontmatter block is `---` as the VERY FIRST line, YAML, then a closing
 * `---` line. Anything else is not frontmatter.
 */
export function parseFrontmatter(content: string): ParsedFrontmatter {
    // Opening fence must be the very first line.
    if (!/^---(\r\n|\n|\r|$)/.test(content)) {
        return { ...EMPTY, positions: new Map() };
    }

    const lines = content.split(/\r\n|\n|\r/);
    if (lines[0] !== "---") {
        return { ...EMPTY, positions: new Map() };
    }

    // Find the closing fence.
    let closeIdx = -1;
    for (let i = 1; i < lines.length; i++) {
        if (lines[i] === "---") {
            closeIdx = i;
            break;
        }
    }
    if (closeIdx === -1) {
        return { ...EMPTY, positions: new Map() };
    }

    const blockStartLine = 1;            // line after the opening fence
    const yamlLines = lines.slice(1, closeIdx);
    const eol = content.includes("\r\n") ? "\r\n" : content.includes("\r") ? "\r" : "\n";
    const yamlText = yamlLines.length ? yamlLines.join(eol) + eol : "";

    const blockRange: Range = {
        start: { line: blockStartLine, character: 0 },
        end: { line: closeIdx, character: 0 },
    };

    const lineCounter = new LineCounter();
    const doc = parseDocument(yamlText, { lineCounter });

    // Convert a yaml-local character offset (into yamlText) to a file-absolute 0-based Position.
    const toPosition = (offset: number): Position => {
        const lp = lineCounter.linePos(offset); // 1-based { line, col }
        return { line: lp.line - 1 + blockStartLine, character: lp.col - 1 };
    };
    const rangeOf = (node: { range?: [number, number, number] | null }): Range => {
        const r = node.range;
        if (!r) return { start: blockRange.start, end: blockRange.start };
        // range = [start, value-end, node-end]; value-end excludes trailing space.
        return { start: toPosition(r[0]), end: toPosition(r[1]) };
    };

    if (doc.errors.length > 0) {
        return {
            data: undefined,
            positions: new Map(),
            blockRange,
            malformed: true,
            errors: doc.errors.map((e) => e.message),
        };
    }

    const positions = new Map<string, FieldPositions>();
    const contents = doc.contents;
    if (isMap(contents)) {
        for (const item of contents.items) {
            const keyNode = item.key as Node | null;
            const valueNode = item.value as Node | null;
            if (!keyNode) continue;
            const keyStr = String((keyNode as { value?: unknown }).value ?? "");
            positions.set(keyStr.toLowerCase(), {
                keyRange: rangeOf(keyNode),
                valueRange: valueNode ? rangeOf(valueNode) : rangeOf(keyNode),
            });
        }
    }

    // Empty frontmatter (`---\n---`) -> yaml yields null contents. Normalize to {}
    // so downstream validateFrontmatter treats it as "no fields present".
    const js = doc.toJS();
    const data =
        js && typeof js === "object" && !Array.isArray(js)
            ? (js as Record<string, unknown>)
            : {};

    return { data, positions, blockRange, malformed: false, errors: [] };
}
