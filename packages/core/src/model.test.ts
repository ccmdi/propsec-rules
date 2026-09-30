import { describe, it, expect } from "vitest";
import { formatTypeDisplay, groupFieldsByName, type Field } from "./model";

describe("groupFieldsByName", () => {
    it("groups variants by name, keeping order", () => {
        const fields: Field[] = [
            { name: "value", type: "string", required: true },
            { name: "count", type: "number", required: false },
            { name: "value", type: "null", required: false },
        ];
        const groups = groupFieldsByName(fields);
        expect([...groups.keys()]).toEqual(["value", "count"]);
        expect(groups.get("value")!.map(v => v.type)).toEqual(["string", "null"]);
        expect(groupFieldsByName([]).size).toBe(0);
    });
});

describe("formatTypeDisplay", () => {
    const f = (over: Partial<Field>): Field => ({ name: "x", type: "string", required: false, ...over });

    it("formats arrays, objects and plain types", () => {
        expect(formatTypeDisplay(f({ type: "string" }))).toBe("string");
        expect(formatTypeDisplay(f({ type: "array", arrayElementType: "person" }))).toBe("person[]");
        expect(formatTypeDisplay(f({ type: "array" }))).toBe("array");
        expect(formatTypeDisplay(f({ type: "object", objectKeyType: "string", objectValueType: "number" }))).toBe("{ string: number }");
        expect(formatTypeDisplay(f({ type: "object", objectValueType: "number" }))).toBe("{ string: number }");
        expect(formatTypeDisplay(f({ type: "object" }))).toBe("object");
        expect(formatTypeDisplay(f({ type: "person" }))).toBe("person");
    });
});
