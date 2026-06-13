import { describe, it, expect } from "vitest";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver";
import type { CompletionSuggestion, HoverInfo } from "@propsec/engine";
import { suggestionToCompletionItem, hoverInfoToHover } from "./completion.js";

describe("suggestionToCompletionItem", () => {
    it("maps a 'field' suggestion to CompletionItemKind.Field with detail + insertText", () => {
        const s: CompletionSuggestion = {
            label: "title",
            kind: "field",
            detail: "string (required)",
            insertText: "title: ",
        };
        const item = suggestionToCompletionItem(s);
        expect(item.label).toBe("title");
        expect(item.kind).toBe(CompletionItemKind.Field);
        expect(item.detail).toBe("string (required)");
        expect(item.insertText).toBe("title: ");
        expect(item.documentation).toBeUndefined();
    });

    it("maps a 'value' suggestion to CompletionItemKind.Value", () => {
        const s: CompletionSuggestion = { label: "draft", kind: "value", insertText: "draft" };
        const item = suggestionToCompletionItem(s);
        expect(item.label).toBe("draft");
        expect(item.kind).toBe(CompletionItemKind.Value);
        expect(item.insertText).toBe("draft");
    });

    it("maps documentation to a Markdown MarkupContent when present", () => {
        const s: CompletionSuggestion = {
            label: "title",
            kind: "field",
            documentation: "The book title",
        };
        const item = suggestionToCompletionItem(s);
        expect(item.documentation).toEqual({
            kind: MarkupKind.Markdown,
            value: "The book title",
        });
    });

    it("omits detail/insertText/documentation when absent on the suggestion", () => {
        const s: CompletionSuggestion = { label: "x", kind: "value" };
        const item = suggestionToCompletionItem(s);
        expect(item.label).toBe("x");
        expect(item.kind).toBe(CompletionItemKind.Value);
        expect(item.detail).toBeUndefined();
        expect(item.insertText).toBeUndefined();
        expect(item.documentation).toBeUndefined();
    });
});

describe("hoverInfoToHover", () => {
    it("maps contents to Markdown MarkupContent and passes through range", () => {
        const h: HoverInfo = {
            contents: "`title`: string _(required)_",
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
        };
        const hover = hoverInfoToHover(h);
        expect(hover.contents).toEqual({
            kind: MarkupKind.Markdown,
            value: "`title`: string _(required)_",
        });
        expect(hover.range).toEqual({
            start: { line: 1, character: 0 },
            end: { line: 1, character: 5 },
        });
    });

    it("omits range when the HoverInfo has none", () => {
        const h: HoverInfo = { contents: "some markdown" };
        const hover = hoverInfoToHover(h);
        expect(hover.contents).toEqual({ kind: MarkupKind.Markdown, value: "some markdown" });
        expect(hover.range).toBeUndefined();
    });
});
