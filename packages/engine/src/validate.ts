import { malformedViolation, type Program, type Violation } from "@propsec/core";
import type { Range } from "./position.js";
import type { CorpusFile } from "./corpus.js";

export interface LocatedViolation extends Violation {
    range: Range;
}

const ZERO_RANGE: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };

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
 * Validate an in-memory corpus, producing position-aware violations.
 * Pure over CorpusFile[] — mirrors propsec's validator.ts but no fs/Obsidian.
 */
export function validateCorpus(files: CorpusFile[], program: Program): LocatedViolation[] {
    const collected: { file: CorpusFile; violation: Violation }[] = [];
    const matched = program.schemas.map(() => [] as CorpusFile[]);

    for (const file of files) {
        if (file.parsed.malformed) collected.push({ file, violation: malformedViolation(file.meta.path) });
        program.schemas.forEach((schema, i) => {
            if (!schema.matches(file.meta)) return;
            matched[i].push(file);
            for (const violation of schema.check(file.meta)) collected.push({ file, violation });
        });
    }

    program.schemas.forEach((schema, i) => {
        const byPath = new Map(matched[i].map((f) => [f.meta.path, f]));
        for (const violation of schema.duplicates(matched[i].map((f) => f.meta))) {
            collected.push({ file: byPath.get(violation.filePath)!, violation });
        }
    });

    return collected.map(({ file, violation }) => ({
        ...violation,
        range: rangeForViolation(violation, file),
    }));
}
