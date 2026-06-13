import type { QueryResult } from "@propsec/engine";

/** Stringify a cell value: arrays/objects as compact JSON, null/undefined as "". */
export function formatCell(value: unknown): string {
    if (value === null || value === undefined) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
}

/**
 * Render a query result as an aligned text table:
 *   header = "path" + columns, then one line per row, columns padded to align.
 * Followed by `warning: ...` lines and a final `N rows` line.
 */
export function formatQueryTable(result: QueryResult): string {
    const headers = ["path", ...result.columns];

    const body = result.rows.map((row) => [
        row.path,
        ...result.columns.map((c) => formatCell(row.values[c])),
    ]);

    const widths = headers.map((h, i) =>
        Math.max(h.length, ...body.map((r) => r[i].length), 0)
    );

    const pad = (cells: string[]) =>
        cells.map((cell, i) => cell.padEnd(widths[i])).join("  ").trimEnd();

    const lines = [pad(headers), ...body.map(pad)];

    for (const w of result.warnings) lines.push(`warning: ${w}`);
    lines.push(`${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`);

    return lines.join("\n");
}
