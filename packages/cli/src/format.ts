import { isWarningViolation } from "@propsec/core";
import type { LocatedViolation } from "@propsec/engine";

export interface FormatOptions {
    color: boolean;
    rootDir: string;
}

export interface Summary {
    errors: number;
    warnings: number;
    files: number;
}

// Self-contained ANSI helpers; no external color dependency.
const ANSI = {
    red: "\x1b[31m",
    yellow: "\x1b[33m",
    dim: "\x1b[2m",
    reset: "\x1b[0m",
} as const;

function paint(text: string, code: string, color: boolean): string {
    return color ? `${code}${text}${ANSI.reset}` : text;
}

function compareRange(a: LocatedViolation, b: LocatedViolation): number {
    const al = a.range.start.line;
    const bl = b.range.start.line;
    if (al !== bl) return al - bl;
    return a.range.start.character - b.range.start.character;
}

/**
 * Format violations grouped by file. Locations are 1-based (converted from the
 * engine's 0-based ranges). Honors `color` strictly; `color:false` emits no ANSI.
 */
export function formatViolations(violations: LocatedViolation[], opts: FormatOptions): string {
    if (violations.length === 0) return "";

    const byFile = new Map<string, LocatedViolation[]>();
    for (const v of violations) {
        const list = byFile.get(v.filePath);
        if (list) list.push(v);
        else byFile.set(v.filePath, [v]);
    }

    const blocks: string[] = [];
    for (const [filePath, list] of byFile) {
        list.sort(compareRange);

        const header = paint(filePath, ANSI.dim, opts.color);
        const lines = [header];

        for (const v of list) {
            const line = v.range.start.line + 1;
            const col = v.range.start.character + 1;
            const isWarn = isWarningViolation(v);
            const level = isWarn ? "warning" : "error";

            const loc = paint(`${line}:${col}`, ANSI.dim, opts.color);
            const levelStr = paint(level, isWarn ? ANSI.yellow : ANSI.red, opts.color);
            lines.push(`  ${loc}  ${levelStr}  ${v.message}`);
        }

        blocks.push(lines.join("\n"));
    }

    return blocks.join("\n\n");
}

/**
 * Tally violations into error/warning/file counts.
 */
export function summarize(violations: LocatedViolation[]): Summary {
    let errors = 0;
    let warnings = 0;
    const files = new Set<string>();

    for (const v of violations) {
        files.add(v.filePath);
        if (isWarningViolation(v)) warnings++;
        else errors++;
    }

    return { errors, warnings, files: files.size };
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * One-line human summary, e.g. "8 errors, 2 warnings in 4 files".
 */
export function summaryLine(violations: LocatedViolation[]): string {
    const { errors, warnings, files } = summarize(violations);
    return `${plural(errors, "error")}, ${plural(warnings, "warning")} in ${plural(files, "file")}`;
}
