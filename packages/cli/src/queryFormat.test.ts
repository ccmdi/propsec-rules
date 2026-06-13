import { describe, it, expect } from "vitest";
import type { QueryResult } from "@propsec/engine";
import { formatCell, formatQueryTable } from "./queryFormat.js";

describe("formatCell", () => {
    it("renders primitives as strings", () => {
        expect(formatCell("x")).toBe("x");
        expect(formatCell(5)).toBe("5");
        expect(formatCell(true)).toBe("true");
    });

    it("renders null/undefined as empty", () => {
        expect(formatCell(null)).toBe("");
        expect(formatCell(undefined)).toBe("");
    });

    it("renders arrays/objects as compact JSON", () => {
        expect(formatCell(["a", "b"])).toBe('["a","b"]');
        expect(formatCell({ k: 1 })).toBe('{"k":1}');
    });
});

describe("formatQueryTable", () => {
    it("aligns columns, lists warnings, ends with a row count", () => {
        const result: QueryResult = {
            columns: ["title", "rating"],
            rows: [
                { path: "Books/Dune.md", values: { title: "Dune", rating: 5 } },
                { path: "Books/A.md", values: { title: "A", rating: 10 } },
            ],
            warnings: ['field "bogus" is not defined in any schema in scope'],
        };

        const out = formatQueryTable(result);
        const lines = out.split("\n");

        expect(lines[0]).toMatch(/^path\s+title\s+rating$/);
        expect(lines[1]).toContain("Books/Dune.md");
        expect(lines[1]).toContain("Dune");
        expect(out).toContain('warning: field "bogus" is not defined in any schema in scope');
        expect(lines[lines.length - 1]).toBe("2 rows");

        // header columns are padded to a consistent width across rows
        const titleColStart = lines[0].indexOf("title");
        expect(lines[1].slice(titleColStart, titleColStart + 4)).toBe("Dune");
    });

    it("uses singular 'row' for a single result", () => {
        const result: QueryResult = {
            columns: [],
            rows: [{ path: "a.md", values: {} }],
            warnings: [],
        };
        expect(formatQueryTable(result).split("\n").pop()).toBe("1 row");
    });

    it("handles zero rows", () => {
        const result: QueryResult = { columns: ["title"], rows: [], warnings: [] };
        const out = formatQueryTable(result);
        expect(out.split("\n")[0]).toMatch(/^path\s+title$/);
        expect(out.split("\n").pop()).toBe("0 rows");
    });
});
