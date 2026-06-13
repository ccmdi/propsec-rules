import {
    CompletionItemKind,
    MarkupKind,
    type CompletionItem,
    type Hover,
} from "vscode-languageserver";
import type { CompletionSuggestion, HoverInfo } from "@propsec/engine";

/** Map a pure engine CompletionSuggestion to an LSP CompletionItem. */
export function suggestionToCompletionItem(s: CompletionSuggestion): CompletionItem {
    const item: CompletionItem = {
        label: s.label,
        kind: s.kind === "field" ? CompletionItemKind.Field : CompletionItemKind.Value,
    };
    if (s.detail !== undefined) item.detail = s.detail;
    if (s.insertText !== undefined) item.insertText = s.insertText;
    if (s.documentation !== undefined) {
        item.documentation = { kind: MarkupKind.Markdown, value: s.documentation };
    }
    return item;
}

/** Map a pure engine HoverInfo to an LSP Hover (markdown contents). */
export function hoverInfoToHover(h: HoverInfo): Hover {
    const hover: Hover = {
        contents: { kind: MarkupKind.Markdown, value: h.contents },
    };
    if (h.range !== undefined) hover.range = h.range;
    return hover;
}
