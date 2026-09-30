import * as oldValidate from "./oracle/validation/validate";
import * as oldUnique from "./oracle/validation/unique";
import * as oldMatcher from "./oracle/query/matcher";
import * as oldTargeting from "./oracle/query/targeting";
import * as oldOperators from "./oracle/operators";
import { validationContext } from "./oracle/validation/context";
import type { Violation as OldViolation } from "./oracle/types";
import { compile, matching } from "../program";
import { compileExpr } from "../expr/compile";
import { lowerCondition, lowerTargeting, migrate } from "../legacy/migrate";
import type { PropertyFilter, PropertyOperator, PropsecConfig, SchemaMapping } from "../legacy/types";
import type { FileMeta, Violation } from "../model";

export { validationContext };
export { normalizeValueForUnique, type UniqueEntry } from "./oracle/validation/unique";
export {
    compareNumbers,
    compareDates,
    compareStrings,
    evaluateNumericComparison,
    compareCrossFieldValues,
} from "./oracle/operators";
export type { PropsecConfig };

const STRUCTURAL = ["missing_required", "missing_warned", "type_mismatch", "type_mismatch_warned", "unknown_field", "duplicate_value", "malformed_frontmatter"];

export const divergences: string[] = [];

function file(path: string, frontmatter: Record<string, unknown> | undefined): FileMeta {
    return { path, parentPath: "", basename: path, mtime: 0, ctime: 0, frontmatter, tags: [] };
}

function projectOld(v: OldViolation): string {
    const kind = STRUCTURAL.indexOf(v.type) >= 0 ? v.type : "constraint";
    const field = v.type === "array_disallowed_value" ? v.field.replace(/\[\d+\]$/, "") : v.field;
    return `${field} | ${kind} | ${v.severity}`;
}

function projectNew(v: Violation): string {
    return `${v.field} | ${v.type} | ${v.severity}`;
}

function distinctSorted(items: string[]): string[] {
    return items.filter((x, i) => items.indexOf(x) === i).sort();
}

const ACCEPTED: { what: string; reason: string; applies: (input: any) => boolean }[] = [
    {
        what: "fileMatchesQuery",
        reason: "FileMeta.path is forward-slash by contract; matching no longer re-normalizes it",
        applies: i => i.meta.path.indexOf("\\") >= 0,
    },
    {
        what: "evaluatePropertyOperator",
        reason: "a null value is null, not the string \"null\"",
        applies: i => i.propValue == null,
    },
];

export const accepted: string[] = [];

function agree(what: string, input: unknown, expected: unknown, actual: unknown): void {
    const a = JSON.stringify(expected);
    const b = JSON.stringify(actual);
    if (a === b) return;
    const known = ACCEPTED.find(k => k.what === what && k.applies(input));
    if (known) {
        accepted.push(known.reason);
        return;
    }
    const report = `${what}\n  input:  ${JSON.stringify(input)}\n  oracle: ${a}\n  pure:   ${b}`;
    divergences.push(report);
    throw new Error(`Parity divergence in ${report}`);
}

function program(config: PropsecConfig) {
    const compiled = compile(migrate(config));
    if (compiled.problems.length > 0) throw new Error(`Migration produced invalid expressions: ${JSON.stringify(compiled.problems)}`);
    return compiled;
}

export function validateFrontmatter(
    frontmatter: Record<string, unknown> | undefined,
    schema: SchemaMapping,
    filePath: string,
    options: { checkUnknownFields: boolean }
): OldViolation[] {
    const expected = oldValidate.validateFrontmatter(frontmatter, schema, filePath, options);
    const compiled = program({
        schemaMappings: [{ ...schema, enabled: true, query: "*" }],
        customTypes: validationContext.customTypes,
        warnOnUnknownFields: options.checkUnknownFields,
        allowObsidianProperties: false,
    });
    const actual = compiled.schemas[0].check(file(filePath, frontmatter));
    agree(
        "validateFrontmatter",
        { frontmatter, fields: schema.fields, customTypes: validationContext.customTypes },
        distinctSorted(expected.map(projectOld)),
        distinctSorted(actual.map(projectNew))
    );
    return expected;
}

export function fileMatchesQuery(meta: FileMeta, query: string): boolean {
    const expected = oldMatcher.fileMatchesQuery(meta, query);
    agree("fileMatchesQuery", { meta, query }, expected, compileExpr(lowerTargeting(query)).test(meta));
    return expected;
}

export function fileMatchesPropertyFilter(meta: FileMeta, filter: PropertyFilter): boolean {
    const expected = oldMatcher.fileMatchesPropertyFilter(meta, filter);
    const compiled = program({
        schemaMappings: [{ id: "s", name: "s", sourceTemplatePath: null, query: "*", enabled: true, fields: [], propertyFilter: filter }],
        customTypes: [],
    });
    agree("fileMatchesPropertyFilter", { meta, filter }, expected, compiled.schemas[0].matches(meta));
    return expected;
}

export function isFileGloballyExcluded(meta: FileMeta, config: PropsecConfig): boolean {
    const expected = oldTargeting.isFileGloballyExcluded(meta, config);
    const actual = config.globalExclusions ? compileExpr(lowerTargeting(config.globalExclusions)).test(meta) : false;
    agree("isFileGloballyExcluded", { meta, exclusions: config.globalExclusions }, expected, actual);
    return expected;
}

export function getMatchingSchemas(meta: FileMeta, config: PropsecConfig): SchemaMapping[] {
    const expected = oldTargeting.getMatchingSchemas(meta, config);
    agree("getMatchingSchemas", { meta, config }, expected.map(m => m.id), matching(program(config), meta).map(s => s.schema.id));
    return expected;
}

export function fileMatchesMapping(meta: FileMeta, mapping: SchemaMapping, config: PropsecConfig): boolean {
    const expected = oldTargeting.fileMatchesMapping(meta, mapping, config);
    const actual = matching(program({ ...config, schemaMappings: [mapping] }), meta).length > 0;
    agree("fileMatchesMapping", { meta, mapping, config }, expected, actual);
    return expected;
}

export function findDuplicateViolations(mapping: SchemaMapping, fieldName: string, entries: oldUnique.UniqueEntry[]): OldViolation[] {
    const expected = oldUnique.findDuplicateViolations(mapping, fieldName, entries);
    const others = mapping.fields.filter(f => f.name !== fieldName);
    const named = mapping.fields.filter(f => f.name === fieldName);
    const fields = [...others, ...(named.length > 0 ? named : [{ name: fieldName, type: "unknown", required: false }]).map(f => ({ ...f, unique: true }))];
    const compiled = program({ schemaMappings: [{ ...mapping, fields, enabled: true, query: "*" }], customTypes: [] });
    const files = entries.map((e): FileMeta => ({ ...file(e.filePath, { [fieldName]: e.value }), basename: e.basename }));
    const actual = compiled.schemas[0].duplicates(files).filter(v => v.field === fieldName);
    const shape = (v: { filePath: string; severity: string; message: string }) => `${v.filePath} | ${v.severity} | ${v.message}`;
    agree("findDuplicateViolations", { fieldName, entries }, expected.map(shape).sort(), actual.map(shape).sort());
    return expected;
}

export function evaluatePropertyOperator(propValue: unknown, operator: PropertyOperator, compareValue: string): boolean {
    const expected = oldOperators.evaluatePropertyOperator(propValue, operator, compareValue);
    if (operator !== "exists" && operator !== "not_exists") {
        const actual = compileExpr(lowerCondition("p", operator, compareValue, false)).test(file("f", { p: propValue }));
        agree("evaluatePropertyOperator", { propValue, operator, compareValue }, expected, actual);
    }
    return expected;
}
