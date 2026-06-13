import {
    validateFrontmatter,
    validationContext,
    getMatchingSchemas,
    OBSIDIAN_NATIVE_PROPERTIES,
    MALFORMED_SCHEMA,
    type PropsecConfig,
    type SchemaMapping,
    type SchemaField,
    type Violation,
} from "@propsec/core";
import type { Range } from "./position.js";
import type { CorpusFile } from "./corpus.js";

export interface LocatedViolation extends Violation {
    range: Range;
}

const ZERO_RANGE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

/**
 * Normalize a value for unique comparison.
 * Ported verbatim from propsec validator.ts (normalizeValueForUnique).
 */
function normalizeValueForUnique(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return JSON.stringify(value.sort());
    if (typeof value === "object" && value !== null) return JSON.stringify(value) ?? "";
    return String(value);
}

function lookupKeyCI(obj: Record<string, unknown>, key: string): string | undefined {
    const lower = key.toLowerCase();
    for (const k of Object.keys(obj)) {
        if (k.toLowerCase() === lower) return k;
    }
    return undefined;
}

/**
 * Resolve a violation's field to a file-absolute Range.
 *
 * Phase-1 limitation: nested field paths (`author.name`, `tags[0]`) fall back to
 * the TOP-LEVEL key's range. Precise nested ranges are future work.
 */
function rangeForViolation(violation: Violation, file: CorpusFile): Range {
    const { positions, blockRange } = file.parsed;

    if (violation.type === "malformed_frontmatter") {
        return blockRange ?? ZERO_RANGE;
    }

    if (violation.type === "missing_required" || violation.type === "missing_warned") {
        return blockRange ?? ZERO_RANGE;
    }

    // Direct top-level field hit.
    const direct = positions.get(violation.field.toLowerCase());
    if (direct) return direct.keyRange;

    // Nested path: anchor on the top-level head (split on '.' or '[').
    const head = violation.field.split(/[.[]/)[0];
    const headPos = positions.get(head.toLowerCase());
    if (headPos) return headPos.keyRange;

    return blockRange ?? ZERO_RANGE;
}

/**
 * Cross-file `unique` check. Ports propsec's incremental O(N) algorithm:
 * detect duplicate normalized values across all files matching a schema and
 * emit duplicate_value violations on ALL files sharing a value.
 */
function checkUniqueForSchema(
    schema: SchemaMapping,
    uniqueFields: SchemaField[],
    matchedFiles: CorpusFile[],
    sink: (file: CorpusFile, v: Violation) => void
): void {
    // For each unique field, group files by normalized value (encounter order),
    // then emit one violation per file in any group of size >= 2 with the
    // complete "also in" list — matching propsec's final store state.
    for (const field of uniqueFields) {
        const groups = new Map<string, { value: string; files: CorpusFile[] }>();

        for (const file of matchedFiles) {
            const fm = file.meta.frontmatter;
            if (!fm) continue;

            const actualKey = lookupKeyCI(fm, field.name);
            if (!actualKey) continue;

            const value = fm[actualKey];
            if (value === null || value === undefined) continue;

            const valueStr = normalizeValueForUnique(value);
            const group = groups.get(valueStr);
            if (group) group.files.push(file);
            else groups.set(valueStr, { value: valueStr, files: [file] });
        }

        for (const { value, files } of groups.values()) {
            if (files.length < 2) continue;
            for (const dupFile of files) {
                const others = files
                    .filter((f) => f.meta.path !== dupFile.meta.path)
                    .map((f) => f.meta.basename);
                sink(dupFile, {
                    filePath: dupFile.meta.path,
                    schemaMapping: schema,
                    field: field.name,
                    type: "duplicate_value",
                    message: `Duplicate value: "${value}" also in: ${others.join(", ")}`,
                    actual: value,
                });
            }
        }
    }
}

/**
 * Validate an in-memory corpus, producing position-aware violations.
 * Pure over CorpusFile[] — mirrors propsec's validator.ts but no fs/Obsidian.
 */
export function validateCorpus(files: CorpusFile[], config: PropsecConfig): LocatedViolation[] {
    validationContext.setCustomTypes(config.customTypes);

    const checkUnknownFields = config.warnOnUnknownFields ?? true;
    const allowObsidian = config.allowObsidianProperties ?? true;

    // Collect raw violations per file (so unique can be re-emitted), tagged with the file.
    const collected: { file: CorpusFile; violation: Violation }[] = [];

    // Per-file schema validation + malformed.
    for (const file of files) {
        if (file.parsed.malformed) {
            collected.push({
                file,
                violation: {
                    filePath: file.meta.path,
                    schemaMapping: MALFORMED_SCHEMA,
                    field: "frontmatter",
                    type: "malformed_frontmatter",
                    message: "Malformed YAML frontmatter (unparseable)",
                },
            });
        }

        const schemas = getMatchingSchemas(file.meta, config);
        for (const schema of schemas) {
            let violations = validateFrontmatter(file.meta.frontmatter, schema, file.meta.path, {
                checkUnknownFields,
            });
            if (allowObsidian) {
                violations = violations.filter(
                    (v) =>
                        v.type !== "unknown_field" ||
                        !OBSIDIAN_NATIVE_PROPERTIES.includes(v.field)
                );
            }
            for (const v of violations) collected.push({ file, violation: v });
        }
    }

    // Cross-file unique, per schema, across all files matching that schema.
    for (const schema of config.schemaMappings) {
        if (!schema.enabled || !schema.query) continue;
        const uniqueFields = schema.fields.filter((f) => f.unique === true);
        if (uniqueFields.length === 0) continue;

        const matchedFiles = files.filter((f) =>
            getMatchingSchemas(f.meta, config).some((m) => m.id === schema.id)
        );

        checkUniqueForSchema(schema, uniqueFields, matchedFiles, (file, v) => {
            collected.push({ file, violation: v });
        });
    }

    return collected.map(({ file, violation }) => ({
        ...violation,
        range: rangeForViolation(violation, file),
    }));
}
