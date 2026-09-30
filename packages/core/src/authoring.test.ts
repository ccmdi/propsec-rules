import { describe, it, expect } from "vitest";
import { checkRule, completeRule, expandSnippet, helpersFor } from "./authoring";
import { compileExpr } from "./expr/compile";

const labels = (source: string, context: Parameters<typeof completeRule>[2], cursor = source.length) =>
    completeRule(source, cursor, context).items.map(i => i.label);

describe("rule authoring", () => {
    it("every helper inserts a rule that compiles", () => {
        const contexts = [
            { slot: "where" as const, properties: [] },
            { slot: "when" as const, properties: [] },
            ...["string", "number", "date", "array", "boolean", "object"].map(type => ({ slot: "must" as const, type, properties: [] })),
        ];
        for (const context of contexts) {
            for (const h of helpersFor(context)) expect(() => compileExpr(expandSnippet(h.insert).text), h.insert).not.toThrow();
        }
    });

    it("selects the placeholder of an inserted helper", () => {
        expect(expandSnippet("size(it) <= ${120}")).toEqual({ text: "size(it) <= 120", select: [12, 15] });
        expect(expandSnippet("it % 1 == 0")).toEqual({ text: "it % 1 == 0", select: [11, 11] });
    });

    it("offers type helpers first in an empty must box, then values", () => {
        const items = labels("", { slot: "must", type: "array", properties: ["tags"] });
        expect(items.slice(0, 2)).toEqual(["at least N items", "at most N items"]);
        expect(items).toContain("it");
        expect(items).toContain("tags");
    });

    it("finds helpers by words and properties by prefix", () => {
        expect(labels("dup", { slot: "must", type: "array", properties: [] })).toContain("no duplicates");
        expect(labels("rating >= 1 && ra", { slot: "where", properties: ["rating", "title"] })[0]).toBe("rating");
    });

    it("stays quiet mid-rule unless asked", () => {
        expect(labels("rating > ", { slot: "where", properties: ["rating"] })).toEqual([]);
        expect(completeRule("rating > ", 9, { slot: "where", properties: ["rating"] }, true).items.map(i => i.label)).toContain("rating");
        expect(labels("rating > 3 && ", { slot: "where", properties: [] })[0]).toBe("in folder");
    });

    it("completes file members and type-appropriate methods", () => {
        expect(labels("file.in", { slot: "where", properties: [] })).toEqual(["inFolder"]);
        const listMethods = labels("it.", { slot: "must", type: "array", properties: [] });
        expect(listMethods).toContain("exists");
        expect(listMethods).not.toContain("startsWith");
        expect(labels('it.matches("fi', { slot: "must", type: "string", properties: [] })).toEqual([]);
    });

    it("quotes property names that are not identifiers", () => {
        const item = completeRule("", 0, { slot: "where", properties: ["date created"] }).items.find(i => i.label === "date created");
        expect(item?.insert).toBe('note["date created"]');
    });

    it("reports errors with a position and flags surprising rules", () => {
        expect(checkRule("rating >", null).error).toEqual({ message: "Unexpected end of expression", at: 8 });
        expect(checkRule("!archived", null).warnings[0]).toContain("archived != true");
        expect(checkRule("ratng > 3", ["rating"]).warnings).toEqual(['"ratng" is not a property any note uses yet.']);
        expect(checkRule("", null)).toEqual({ error: null, warnings: [] });
    });
});
