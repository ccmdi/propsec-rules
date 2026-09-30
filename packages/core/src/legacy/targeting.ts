
/**
 * Query syntax:
 * - "*" - all files (wildcard)
 * - "folder" - files directly in folder
 * - "folder/*" - files in folder and subfolders
 * - "#tag" - files with tag
 * - "folder/* or #tag" - union of conditions (OR)
 * - "folder/* and #tag" - intersection of conditions (AND)
 * - "folder/* not #draft" - exclusion (files in folder but not with #draft)
 *
 * Precedence (highest to lowest): NOT, AND, OR
 *
 * Examples:
 * - "*" - all markdown files in vault
 * - "Journal/Gym" - only files directly in Journal/Gym/
 * - "Journal/Gym/*" - files in Journal/Gym/ and all subfolders
 * - "#book" - all files with #book tag
 * - "Library/* or #book" - files in Library/ (recursive) OR with #book tag
 * - "Library/* and #book" - files in Library/ (recursive) AND with #book tag
 * - "Library/* not #draft" - files in Library/ excluding those with #draft
 * - "Library/* and #book not #draft" - files in Library/ with #book, excluding #draft
 */

export interface QueryCondition {
    type: "all" | "folder" | "folder_recursive" | "tag";
    value: string;
}

/**
 * A query segment represents one OR branch
 * Within a segment, AND conditions are intersected, NOT conditions are excluded
 */
export interface QuerySegment {
    andConditions: QueryCondition[];
    notConditions: QueryCondition[];
}

/**
 * Parse a single term into a QueryCondition
 */
function parseTerm(term: string): QueryCondition | null {
    const trimmed = term.trim();
    if (!trimmed) return null;

    if (trimmed === "*") {
        return { type: "all", value: "*" };
    } else if (trimmed.startsWith("#")) {
        return { type: "tag", value: trimmed.substring(1) };
    } else if (trimmed.endsWith("/*")) {
        return { type: "folder_recursive", value: trimmed.slice(0, -2).replace(/\/$/, "") };
    } else {
        return { type: "folder", value: trimmed.replace(/\/$/, "") };
    }
}

/**
 * Parse a query string into segments (OR branches)
 * Each segment contains AND conditions and NOT conditions
 */
export function parseQuerySegments(query: string): QuerySegment[] {
    const segments: QuerySegment[] = [];

    // Split by " or " (case insensitive) - lowest precedence
    const orParts = query.split(/\s+or\s+/i);

    for (const orPart of orParts) {
        const trimmed = orPart.trim();
        if (!trimmed) continue;

        const segment: QuerySegment = {
            andConditions: [],
            notConditions: [],
        };

        // split by NOT, first part is ANDs, rest are NOTs
        const notParts = trimmed.split(/\s+not\s+/i);

        // First part contains AND conditions
        const andPart = notParts[0];
        if (andPart) {
            const andTerms = andPart.split(/\s+and\s+/i);
            for (const term of andTerms) {
                const condition = parseTerm(term);
                if (condition) {
                    segment.andConditions.push(condition);
                }
            }
        }

        // Remaining parts are NOT conditions (each can also have ANDs within)
        for (let i = 1; i < notParts.length; i++) {
            // Each NOT part could be a single term or multiple terms ANDed
            // "NOT #draft AND #archived" means exclude files that have BOTH
            const notAndTerms = notParts[i].split(/\s+and\s+/i);
            for (const term of notAndTerms) {
                const condition = parseTerm(term);
                if (condition) {
                    segment.notConditions.push(condition);
                }
            }
        }

        if (segment.andConditions.length > 0) {
            segments.push(segment);
        }
    }

    return segments;
}
