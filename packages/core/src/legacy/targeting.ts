import { PropertyFilter } from "./types";
import { getOperatorSymbol } from "./operators";

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

/**
 * Validate a query string and return any errors
 */
export function validateQuery(query: string): { valid: boolean; error?: string } {
    const trimmed = query.trim();

    // Empty query is invalid
    if (!trimmed) {
        return { valid: false, error: "Query cannot be empty" };
    }

    // Parse and check for valid segments
    const segments = parseQuerySegments(trimmed);

    if (segments.length === 0) {
        return { valid: false, error: "Query must contain at least one valid condition (folder, folder/*, #tag, or *)" };
    }

    // Check each segment has valid conditions
    for (const segment of segments) {
        if (segment.andConditions.length === 0) {
            return { valid: false, error: "Each OR branch must have at least one positive condition" };
        }
    }

    return { valid: true };
}

/**
 * Get a human-readable description of a single condition
 */
function describeCondition(c: QueryCondition): string {
    switch (c.type) {
        case "all":
            return "all files";
        case "folder":
            return `in ${c.value}/`;
        case "folder_recursive":
            return `in ${c.value}/ (recursive)`;
        case "tag":
            return `tagged #${c.value}`;
        default:
            return "unknown";
    }
}

/**
 * Get a human-readable description of a query
 */
export function describeQuery(query: string): string {
    const segments = parseQuerySegments(query);

    if (segments.length === 0) {
        return "No conditions";
    }

    const segmentDescriptions = segments.map((segment) => {
        const parts: string[] = [];

        // AND conditions
        if (segment.andConditions.length > 0) {
            const andDescs = segment.andConditions.map(describeCondition);
            parts.push(andDescs.join(" and "));
        }

        // NOT conditions
        if (segment.notConditions.length > 0) {
            const notDescs = segment.notConditions.map(describeCondition);
            parts.push("not " + notDescs.join(" and not "));
        }

        return parts.join(" ");
    });

    return segmentDescriptions.join(" or ");
}

/**
 * Describe a property filter in human-readable form
 */
export function describePropertyFilter(filter: PropertyFilter): string {
    const parts: string[] = [];

    if (filter.modifiedAfter) parts.push(`modified after ${filter.modifiedAfter}`);
    if (filter.modifiedBefore) parts.push(`modified before ${filter.modifiedBefore}`);
    if (filter.createdAfter) parts.push(`created after ${filter.createdAfter}`);
    if (filter.createdBefore) parts.push(`created before ${filter.createdBefore}`);
    if (filter.hasProperty) parts.push(`has "${filter.hasProperty}"`);
    if (filter.notHasProperty) parts.push(`no "${filter.notHasProperty}"`);

    if (filter.conditions && filter.conditions.length > 0) {
        for (const cond of filter.conditions) {
            parts.push(`${cond.property} ${getOperatorSymbol(cond.operator)} ${cond.value}`);
        }
    }

    return parts.length > 0 ? parts.join(", ") : "";
}
