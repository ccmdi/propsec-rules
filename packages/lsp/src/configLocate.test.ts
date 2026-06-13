import { describe, it, expect } from "vitest";
import { findFieldRange } from "./configLocate.js";

// Two schemas. `rating` exists in both; `mood` only in journal. Line/char of fields
// is fixed by this exact formatting (2-space indent), asserted below.
const CONFIG = `{
  "schemaMappings": [
    {
      "id": "book",
      "name": "Book",
      "query": "Books/*",
      "fields": [
        { "name": "title", "type": "string", "required": true },
        { "name": "rating", "type": "number", "required": false }
      ]
    },
    {
      "id": "journal",
      "name": "Journal",
      "query": "Journal/*",
      "fields": [
        { "name": "mood", "type": "string", "required": false }
      ]
    }
  ],
  "customTypes": []
}
`;

describe("findFieldRange", () => {
    it("finds a field in the schema selected by id", () => {
        const r = findFieldRange(CONFIG, "book", "title");
        expect(r).not.toBeNull();
        // `{ "name": "title" ... }` is on line index 7 (0-based), 8 spaces indent.
        expect(r!.start).toEqual({ line: 7, character: 8 });
        // The object node spans to the closing brace on the same line.
        expect(r!.end.line).toBe(7);
        expect(r!.end.character).toBeGreaterThan(r!.start.character);
    });

    it("locates a field only in the matching schema (mood is journal-only)", () => {
        const r = findFieldRange(CONFIG, "journal", "mood");
        expect(r).not.toBeNull();
        expect(r!.start).toEqual({ line: 16, character: 8 });
    });

    it("returns null when the field exists but not under the given schema id", () => {
        // `mood` is journal-only; asking under `book` -> null.
        expect(findFieldRange(CONFIG, "book", "mood")).toBeNull();
    });

    it("returns null for an unknown schema id", () => {
        expect(findFieldRange(CONFIG, "nope", "title")).toBeNull();
    });

    it("returns null for a missing field", () => {
        expect(findFieldRange(CONFIG, "book", "author")).toBeNull();
    });

    it("matches the field name case-insensitively", () => {
        const r = findFieldRange(CONFIG, "book", "TITLE");
        expect(r).not.toBeNull();
        expect(r!.start).toEqual({ line: 7, character: 8 });
    });

    it("returns null on malformed JSON with no parse tree", () => {
        expect(findFieldRange("not json at all", "book", "title")).toBeNull();
    });
});
