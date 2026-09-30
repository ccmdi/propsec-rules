import type { SchemaMapping, Violation } from "../types";
import { isFieldWarned } from "../utils/schema";

/** Normalize a value to a string for duplicate comparison. (Verbatim from the plugin/engine.) */
export function normalizeValueForUnique(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return JSON.stringify(value.slice().sort());
  if (typeof value === "object" && value !== null) return JSON.stringify(value) ?? "";
  return String(value);
}

export interface UniqueEntry {
  filePath: string;
  basename: string;   // for the "also in" message
  value: unknown;
}

/**
 * For ONE unique field across a set of files, return one `duplicate_value` Violation
 * per file that shares a normalized value with another file. null/undefined values are
 * skipped (a missing value is never a duplicate). Message format MUST match the plugin's
 * current one EXACTLY: `Duplicate value: "<val>" also in: <basename, basename>`.
 */
export function findDuplicateViolations(
  mapping: SchemaMapping,
  fieldName: string,
  entries: UniqueEntry[]
): Violation[] {
  const groups = new Map<string, UniqueEntry[]>();
  for (const e of entries) {
    if (e.value === null || e.value === undefined) continue;
    const key = normalizeValueForUnique(e.value);
    const arr = groups.get(key);
    if (arr) arr.push(e); else groups.set(key, [e]);
  }
  const severity = isFieldWarned(mapping.fields.filter(f => f.name === fieldName)) ? "warning" : "error";
  const out: Violation[] = [];
  for (const [valueStr, members] of groups) {
    if (members.length < 2) continue;
    for (const m of members) {
      const others = members.filter(o => o.filePath !== m.filePath).map(o => o.basename);
      out.push({
        filePath: m.filePath,
        schemaMapping: mapping,
        field: fieldName,
        type: "duplicate_value",
        severity,
        message: `Duplicate value: "${valueStr}" also in: ${others.join(", ")}`,
        actual: valueStr,
      });
    }
  }
  return out;
}
