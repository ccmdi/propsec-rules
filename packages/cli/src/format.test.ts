import { describe, it, expect } from "vitest";
import type { SchemaMapping, ViolationType } from "@propsec/core";
import type { LocatedViolation } from "@propsec/engine";
import { formatViolations, summarize, summaryLine } from "./format.js";

const SCHEMA: SchemaMapping = {
    id: "s",
    name: "S",
    sourceTemplatePath: null,
    query: "*",
    enabled: true,
    fields: [],
};

function v(
    overrides: Partial<LocatedViolation> & {
        filePath: string;
        type: ViolationType;
        line: number;
        char: number;
    }
): LocatedViolation {
    const { line, char, ...rest } = overrides;
    return {
        filePath: rest.filePath,
        schemaMapping: SCHEMA,
        field: rest.field ?? "f",
        type: rest.type,
        message: rest.message ?? "msg",
        range: {
            start: { line, character: char },
            end: { line, character: char },
        },
    };
}

describe("formatViolations", () => {
    it("converts 0-based engine range to 1-based line:col", () => {
        const out = formatViolations(
            [v({ filePath: "a.md", type: "type_mismatch", line: 1, char: 0, message: "boom" })],
            { color: false, rootDir: "/root" }
        );
        // engine line 1 char 0 -> printed 2:1
        expect(out).toContain("2:1");
        expect(out).toContain("a.md");
        expect(out).toContain("boom");
    });

    it("labels errors and warnings via isWarningViolation", () => {
        const out = formatViolations(
            [
                v({ filePath: "a.md", type: "type_mismatch", line: 0, char: 0 }),
                v({ filePath: "a.md", type: "unknown_field", line: 1, char: 0 }),
            ],
            { color: false, rootDir: "/root" }
        );
        expect(out).toMatch(/error/);
        expect(out).toMatch(/warning/);
        // type_mismatch is an error, unknown_field is a warning
        const errorLine = out.split("\n").find((l) => l.includes("1:1"));
        const warnLine = out.split("\n").find((l) => l.includes("2:1"));
        expect(errorLine).toContain("error");
        expect(warnLine).toContain("warning");
    });

    it("groups by file and sorts by range within a file", () => {
        const out = formatViolations(
            [
                v({ filePath: "a.md", type: "type_mismatch", line: 5, char: 2, message: "second" }),
                v({ filePath: "a.md", type: "type_mismatch", line: 1, char: 0, message: "first" }),
            ],
            { color: false, rootDir: "/root" }
        );
        expect(out.indexOf("first")).toBeLessThan(out.indexOf("second"));
        // only one file header for a.md
        expect(out.split("a.md").length - 1).toBe(1);
    });

    it("emits NO ANSI escape codes when color is false", () => {
        const out = formatViolations(
            [
                v({ filePath: "a.md", type: "type_mismatch", line: 0, char: 0 }),
                v({ filePath: "b.md", type: "unknown_field", line: 0, char: 0 }),
            ],
            { color: false, rootDir: "/root" }
        );
        expect(out).not.toContain("\x1b[");
    });

    it("emits ANSI escape codes when color is true", () => {
        const out = formatViolations(
            [v({ filePath: "a.md", type: "type_mismatch", line: 0, char: 0 })],
            { color: true, rootDir: "/root" }
        );
        expect(out).toContain("\x1b[");
    });

    it("returns empty string for no violations", () => {
        expect(formatViolations([], { color: true, rootDir: "/root" })).toBe("");
    });
});

describe("summarize", () => {
    it("counts errors, warnings, and distinct files", () => {
        const result = summarize([
            v({ filePath: "a.md", type: "type_mismatch", line: 0, char: 0 }),
            v({ filePath: "a.md", type: "unknown_field", line: 1, char: 0 }),
            v({ filePath: "b.md", type: "missing_required", line: 0, char: 0 }),
        ]);
        expect(result).toEqual({ errors: 2, warnings: 1, files: 2 });
    });

    it("is all zeros for no violations", () => {
        expect(summarize([])).toEqual({ errors: 0, warnings: 0, files: 0 });
    });
});

describe("summaryLine", () => {
    it("renders a one-line summary with pluralization", () => {
        const line = summaryLine([
            v({ filePath: "a.md", type: "type_mismatch", line: 0, char: 0 }),
            v({ filePath: "a.md", type: "missing_required", line: 1, char: 0 }),
            v({ filePath: "a.md", type: "unknown_field", line: 2, char: 0 }),
            v({ filePath: "b.md", type: "type_mismatch", line: 0, char: 0 }),
        ]);
        expect(line).toBe("3 errors, 1 warning in 2 files");
    });

    it("uses singular forms for a count of one", () => {
        const line = summaryLine([
            v({ filePath: "a.md", type: "type_mismatch", line: 0, char: 0 }),
        ]);
        expect(line).toBe("1 error, 0 warnings in 1 file");
    });
});
