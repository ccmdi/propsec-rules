import {
    getMatchingSchemas,
    groupFieldsByName,
    type PropsecConfig,
    type SchemaField,
    type SchemaMapping,
    type FileMeta,
} from "@propsec/core";
import type { Position, Range } from "./position.js";
import type { ParsedFrontmatter } from "./frontmatter.js";
import type { ValueIndex } from "./valueIndex.js";

export interface CompletionSuggestion {
    label: string;
    kind: "field" | "value";
    detail?: string; // e.g. "string | null (required)" or "number"
    documentation?: string; // markdown (the field's description)
    insertText?: string; // e.g. "title: " for a field, or the literal value
}

export interface HoverInfo {
    contents: string; // markdown
    range?: Range;
}

export interface CompletionContext {
    fileMeta: FileMeta;
    parsed: ParsedFrontmatter;
    text: string; // full document text
    position: Position; // 0-based
}

function splitLines(text: string): string[] {
    return text.split(/\r\n|\n|\r/);
}

/** True if the position sits within the editable CONTENT region of the frontmatter block. */
function inFrontmatterContent(parsed: ParsedFrontmatter, position: Position): boolean {
    const block = parsed.blockRange;
    if (!block) return false;
    // Content lines are [start.line, end.line - 1]; end.line is the closing fence.
    return position.line >= block.start.line && position.line < block.end.line;
}

/**
 * Collect all SchemaField variants for `key` (case-insensitive) across matched schemas,
 * tracking which schema each group came from.
 */
function fieldGroupForKey(
    schemas: SchemaMapping[],
    key: string
): { variants: SchemaField[]; schemaNames: string[] } {
    const lower = key.toLowerCase();
    const variants: SchemaField[] = [];
    const schemaNames: string[] = [];
    for (const schema of schemas) {
        const groups = groupFieldsByName(schema.fields);
        for (const [name, fields] of groups) {
            if (name.toLowerCase() === lower) {
                variants.push(...fields);
                if (!schemaNames.includes(schema.name)) schemaNames.push(schema.name);
            }
        }
    }
    return { variants, schemaNames };
}

function flagSuffix(variants: SchemaField[]): string {
    if (variants.some((v) => v.required)) return " (required)";
    if (variants.some((v) => v.warn)) return " (recommended)";
    return "";
}

/** Distinct variant types, in first-seen order. */
function variantTypes(variants: SchemaField[]): string[] {
    const out: string[] = [];
    for (const v of variants) {
        if (!out.includes(v.type)) out.push(v.type);
    }
    return out;
}

export function computeCompletions(
    ctx: CompletionContext,
    config: PropsecConfig,
    valueIndex: ValueIndex
): CompletionSuggestion[] {
    if (!inFrontmatterContent(ctx.parsed, ctx.position)) return [];

    const line = splitLines(ctx.text)[ctx.position.line] ?? "";
    const before = line.slice(0, ctx.position.character);

    // Indented (nested) content -> top-level only for v1.
    // TODO: nested-object/array-element completion.
    if (/^\s+\S/.test(line)) return [];
    // List item line.
    if (/^\s*-\s/.test(line)) return [];

    const colonIdx = before.indexOf(":");
    if (colonIdx === -1) {
        return keyCompletions(ctx, config);
    }
    const key = before.slice(0, colonIdx).trim();
    return valueCompletions(key, config, valueIndex, ctx);
}

function keyCompletions(ctx: CompletionContext, config: PropsecConfig): CompletionSuggestion[] {
    const schemas = getMatchingSchemas(ctx.fileMeta, config);
    if (schemas.length === 0) return [];

    const allFields: SchemaField[] = schemas.flatMap((s) => s.fields);
    const groups = groupFieldsByName(allFields);

    const present = new Set<string>(
        Object.keys(ctx.fileMeta.frontmatter ?? {}).map((k) => k.toLowerCase())
    );

    const out: CompletionSuggestion[] = [];
    for (const [name, variants] of groups) {
        if (present.has(name.toLowerCase())) continue;
        const detail = variantTypes(variants).join(" | ") + flagSuffix(variants);
        const documentation = variants.find((v) => v.description)?.description;
        out.push({
            label: name,
            kind: "field",
            detail,
            documentation,
            insertText: name + ": ",
        });
    }
    return out;
}

function valueCompletions(
    key: string,
    config: PropsecConfig,
    valueIndex: ValueIndex,
    ctx: CompletionContext
): CompletionSuggestion[] {
    const schemas = getMatchingSchemas(ctx.fileMeta, config);
    const { variants } = fieldGroupForKey(schemas, key);

    const seen = new Set<string>();
    const out: CompletionSuggestion[] = [];
    const add = (label: string) => {
        if (seen.has(label)) return;
        seen.add(label);
        out.push({ label, kind: "value", insertText: label });
    };

    const types = variantTypes(variants);
    if (types.includes("boolean")) {
        add("true");
        add("false");
    }
    if (types.includes("null")) {
        add("null");
    }

    const corpusValues = valueIndex.get(key.toLowerCase());
    if (corpusValues) {
        for (const v of corpusValues) add(v);
    }

    // No schema field and no corpus values -> [] (handled naturally: out stays empty).
    return out;
}

/** Resolve the top-level key being hovered, if any. */
function hoveredKey(ctx: CompletionContext): { key: string; range: Range } | null {
    const pos = ctx.position;

    // 1. A positions entry whose keyRange contains the cursor (same line, char in [start,end]).
    for (const [, fp] of ctx.parsed.positions) {
        const kr = fp.keyRange;
        if (
            kr.start.line === pos.line &&
            kr.end.line === pos.line &&
            pos.character >= kr.start.character &&
            pos.character <= kr.end.character
        ) {
            const line = splitLines(ctx.text)[pos.line] ?? "";
            const key = line.slice(kr.start.character, kr.end.character).trim();
            return { key, range: kr };
        }
    }

    // 2. Fall back to the key on this line if it is a top-level `key:` line.
    const line = splitLines(ctx.text)[pos.line] ?? "";
    const m = /^([^\s:][^:]*):/.exec(line);
    if (m) {
        const fp = ctx.parsed.positions.get(m[1].trim().toLowerCase());
        if (fp && fp.keyRange.start.line === pos.line) {
            return { key: m[1].trim(), range: fp.keyRange };
        }
    }

    return null;
}

function constraintBullets(variants: SchemaField[]): string[] {
    const bullets: string[] = [];
    for (const v of variants) {
        const sc = v.stringConstraints;
        if (sc?.pattern !== undefined) bullets.push(`pattern: \`${sc.pattern}\``);
        if (sc?.minLength !== undefined) bullets.push(`minLength: ${sc.minLength}`);
        if (sc?.maxLength !== undefined) bullets.push(`maxLength: ${sc.maxLength}`);

        const nc = v.numberConstraints;
        if (nc?.min !== undefined) bullets.push(`min: ${nc.min}`);
        if (nc?.max !== undefined) bullets.push(`max: ${nc.max}`);

        const dc = v.dateConstraints;
        if (dc?.min !== undefined) bullets.push(`date min: ${dc.min}`);
        if (dc?.max !== undefined) bullets.push(`date max: ${dc.max}`);

        const ac = v.arrayConstraints;
        if (ac?.minItems !== undefined) bullets.push(`minItems: ${ac.minItems}`);
        if (ac?.maxItems !== undefined) bullets.push(`maxItems: ${ac.maxItems}`);
        if (ac?.contains !== undefined) bullets.push(`contains: ${ac.contains.join(", ")}`);
    }
    // Dedupe while preserving order (variants may repeat a constraint).
    return [...new Set(bullets)];
}

export function computeHover(ctx: CompletionContext, config: PropsecConfig): HoverInfo | null {
    const hk = hoveredKey(ctx);
    if (!hk) return null;

    const schemas = getMatchingSchemas(ctx.fileMeta, config);
    const { variants, schemaNames } = fieldGroupForKey(schemas, hk.key);

    if (variants.length === 0) {
        // Key present in the document but not defined by any matched schema.
        if (schemas.length > 0) {
            return {
                contents: `\`${hk.key}\` is not defined in the matching schema(s).`,
                range: hk.range,
            };
        }
        return null;
    }

    const types = variantTypes(variants).join(" | ");
    let flag: string;
    if (variants.some((v) => v.required)) flag = " _(required)_";
    else if (variants.some((v) => v.warn)) flag = " _(recommended)_";
    else flag = " (optional)";
    if (variants.some((v) => v.unique)) flag += " · unique";

    const lines: string[] = [`\`${hk.key}\`: ${types}${flag}`];

    const description = variants.find((v) => v.description)?.description;
    if (description) {
        lines.push("");
        lines.push(description);
    }

    const bullets = constraintBullets(variants);
    if (bullets.length > 0) {
        lines.push("");
        for (const b of bullets) lines.push(`- ${b}`);
    }

    lines.push("");
    const schemaLabel = schemaNames.map((n) => `**${n}**`).join(", ");
    lines.push(`from schema: ${schemaLabel}`);

    return { contents: lines.join("\n"), range: hk.range };
}
