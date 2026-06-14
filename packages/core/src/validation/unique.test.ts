import { describe, it, expect } from "vitest";
import { normalizeValueForUnique, findDuplicateViolations, type UniqueEntry } from "./unique";
import type { SchemaMapping } from "../types";

const mapping: SchemaMapping = {
  id: "s1",
  name: "Schema",
  sourceTemplatePath: null,
  query: "Books",
  enabled: true,
  fields: [],
};

const entry = (filePath: string, basename: string, value: unknown): UniqueEntry => ({
  filePath,
  basename,
  value,
});

describe("normalizeValueForUnique", () => {
  it("returns strings unchanged", () => {
    expect(normalizeValueForUnique("hello")).toBe("hello");
  });

  it("stringifies numbers and booleans", () => {
    expect(normalizeValueForUnique(42)).toBe("42");
    expect(normalizeValueForUnique(0)).toBe("0");
    expect(normalizeValueForUnique(true)).toBe("true");
    expect(normalizeValueForUnique(false)).toBe("false");
  });

  it("serializes Date as ISO string", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(normalizeValueForUnique(d)).toBe("2026-01-02T03:04:05.000Z");
  });

  it("serializes arrays as sorted JSON (non-mutating)", () => {
    const arr = ["b", "a", "c"];
    expect(normalizeValueForUnique(arr)).toBe(JSON.stringify(["a", "b", "c"]));
    // input must not be mutated
    expect(arr).toEqual(["b", "a", "c"]);
  });

  it("two arrays with same members in different order normalize equal", () => {
    expect(normalizeValueForUnique([3, 1, 2])).toBe(normalizeValueForUnique([1, 2, 3]));
  });

  it("serializes plain objects as JSON", () => {
    expect(normalizeValueForUnique({ a: 1, b: 2 })).toBe(JSON.stringify({ a: 1, b: 2 }));
  });
});

describe("findDuplicateViolations", () => {
  it("returns [] when there are no duplicates", () => {
    const entries = [
      entry("Books/a.md", "a", "111"),
      entry("Books/b.md", "b", "222"),
      entry("Books/c.md", "c", "333"),
    ];
    expect(findDuplicateViolations(mapping, "isbn", entries)).toEqual([]);
  });

  it("two files with the same value -> 2 violations each naming the other's basename", () => {
    const entries = [
      entry("Books/a.md", "a", "123"),
      entry("Books/b.md", "b", "123"),
    ];
    const viols = findDuplicateViolations(mapping, "isbn", entries);
    expect(viols.length).toBe(2);

    const va = viols.find((v) => v.filePath === "Books/a.md")!;
    const vb = viols.find((v) => v.filePath === "Books/b.md")!;
    expect(va.type).toBe("duplicate_value");
    expect(va.field).toBe("isbn");
    expect(va.actual).toBe("123");
    expect(va.schemaMapping).toBe(mapping);
    expect(va.message).toBe('Duplicate value: "123" also in: b');
    expect(vb.message).toBe('Duplicate value: "123" also in: a');
  });

  it("three-way duplicate: each violation names the other two basenames", () => {
    const entries = [
      entry("Books/a.md", "a", "dup"),
      entry("Books/b.md", "b", "dup"),
      entry("Books/c.md", "c", "dup"),
    ];
    const viols = findDuplicateViolations(mapping, "isbn", entries);
    expect(viols.length).toBe(3);

    const va = viols.find((v) => v.filePath === "Books/a.md")!;
    expect(va.message).toBe('Duplicate value: "dup" also in: b, c');
    const vb = viols.find((v) => v.filePath === "Books/b.md")!;
    expect(vb.message).toBe('Duplicate value: "dup" also in: a, c');
    const vc = viols.find((v) => v.filePath === "Books/c.md")!;
    expect(vc.message).toBe('Duplicate value: "dup" also in: a, b');
  });

  it("null/undefined values are skipped (a missing value is never a duplicate)", () => {
    const entries = [
      entry("Books/a.md", "a", null),
      entry("Books/b.md", "b", undefined),
      entry("Books/c.md", "c", null),
    ];
    expect(findDuplicateViolations(mapping, "isbn", entries)).toEqual([]);
  });

  it("distinct values -> []", () => {
    const entries = [
      entry("Books/a.md", "a", 1),
      entry("Books/b.md", "b", 2),
    ];
    expect(findDuplicateViolations(mapping, "count", entries)).toEqual([]);
  });

  it("normalized equality across types/forms groups duplicates", () => {
    // array order-independence drives the grouping
    const entries = [
      entry("Books/a.md", "a", ["x", "y"]),
      entry("Books/b.md", "b", ["y", "x"]),
    ];
    const viols = findDuplicateViolations(mapping, "tags", entries);
    expect(viols.length).toBe(2);
    expect(viols[0].actual).toBe(JSON.stringify(["x", "y"]));
  });
});
