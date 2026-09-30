import { parseTree, type Node } from "jsonc-parser";
import type { Range } from "@propsec/engine";

/** The string value of an object node's property, or undefined. */
function propValue(objNode: Node, name: string): unknown {
    if (objNode.type !== "object" || !objNode.children) return undefined;
    for (const prop of objNode.children) {
        const keyNode = prop.children?.[0];
        if (keyNode?.value === name) return prop.children?.[1]?.value;
    }
    return undefined;
}

/** The value Node of an object node's property, or undefined. */
function propNode(objNode: Node, name: string): Node | undefined {
    if (objNode.type !== "object" || !objNode.children) return undefined;
    for (const prop of objNode.children) {
        const keyNode = prop.children?.[0];
        if (keyNode?.value === name) return prop.children?.[1];
    }
    return undefined;
}

/** Convert a character offset into configText to a 0-based {line, character}. */
function offsetToPosition(text: string, offset: number): { line: number; character: number } {
    let line = 0;
    let lineStart = 0;
    for (let i = 0; i < offset && i < text.length; i++) {
        if (text[i] === "\n") {
            line++;
            lineStart = i + 1;
        }
    }
    return { line, character: offset - lineStart };
}

function nodeRange(text: string, node: Node): Range {
    return {
        start: offsetToPosition(text, node.offset),
        end: offsetToPosition(text, node.offset + node.length),
    };
}

/**
 * Locate the field definition `fieldName` (case-insensitive) inside the schema mapping
 * whose `id` === `schemaId`, returning that field object node's Range. Null if not found.
 */
export function findFieldRange(
    configText: string,
    schemaId: string,
    fieldName: string
): Range | null {
    const root = parseTree(configText);
    if (!root) return null;

    const mappings = propNode(root, "schemas") ?? propNode(root, "schemaMappings");
    if (!mappings || mappings.type !== "array" || !mappings.children) return null;

    const schemaNode = mappings.children.find((el) => propValue(el, "id") === schemaId);
    if (!schemaNode) return null;

    const fields = propNode(schemaNode, "fields");
    if (!fields || fields.type !== "array" || !fields.children) return null;

    const lower = fieldName.toLowerCase();
    const fieldNode = fields.children.find((el) => {
        const name = propValue(el, "name");
        return typeof name === "string" && name.toLowerCase() === lower;
    });
    if (!fieldNode) return null;

    return nodeRange(configText, fieldNode);
}
