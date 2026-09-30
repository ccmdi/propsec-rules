import type { Config, Field, Schema, TypeDef } from "../model";
import type { ComparisonOperator, PropertyOperator } from "./operators";
import { parseQuerySegments, type QueryCondition } from "./targeting";
import { OBSIDIAN_NATIVE_PROPERTIES, type CustomType, type PropertyFilter, type PropsecConfig, type SchemaField, type SchemaMapping } from "./types";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KEYWORDS = ["it", "file", "note", "true", "false", "null", "in"];
const COMPOUND = /\|\||&&|\?/;

const SYMBOLS: Record<ComparisonOperator, string> = {
    equals: "==",
    not_equals: "!=",
    greater_than: ">",
    less_than: "<",
    greater_or_equal: ">=",
    less_or_equal: "<=",
};

function str(value: string): string {
    return JSON.stringify(value);
}

function ref(name: string): string {
    return IDENTIFIER.test(name) && KEYWORDS.indexOf(name) < 0 ? name : `note[${str(name)}]`;
}

function group(expr: string): string {
    return COMPOUND.test(expr) ? `(${expr})` : expr;
}

function not(expr: string): string {
    return expr.indexOf(" ") < 0 ? `!${expr}` : `!(${expr})`;
}

function join(parts: string[], op: "&&" | "||"): string {
    return parts.length === 1 ? parts[0] : parts.map(group).join(` ${op} `);
}

function isRegex(pattern: string): boolean {
    try {
        new RegExp(pattern);
        return true;
    } catch {
        return false;
    }
}

function isDate(value: string): boolean {
    return !isNaN(new Date(value).getTime());
}

export function lowerCondition(name: string, operator: PropertyOperator, value: string, missingIsEmpty: boolean): string {
    const p = ref(name);
    const v = str(value);
    const blank = missingIsEmpty && value === "";
    switch (operator) {
        case "exists": return `has(${p})`;
        case "not_exists": return `!has(${p})`;
        case "equals": return blank ? `${p} == null || ${p} == ""` : `${p} == ${v}`;
        case "not_equals": return blank ? `${p} != null && ${p} != ""` : `${p} != ${v}`;
        case "contains": return blank ? `${p} == null || ${p}.contains("")` : `${p}.contains(${v})`;
        case "not_contains": return blank ? `!(${p} == null || ${p}.contains(""))` : `!${p}.contains(${v})`;
        case "in":
        case "not_in": {
            const allowed = `[${value.split(",").map(s => s.trim()).filter(s => s !== "").map(str).join(", ")}]`;
            const member = `type(${p}) == "list" ? ${p}.exists(x, x in ${allowed}) : ${p} in ${allowed}`;
            if (operator === "in") return member;
            return missingIsEmpty ? `!(${member})` : `has(${p}) && !(${member})`;
        }
        default: return `${p} ${SYMBOLS[operator]} ${v}`;
    }
}

function lowerTerm(c: QueryCondition): string {
    const value = str(c.value.replace(/\\/g, "/"));
    switch (c.type) {
        case "all": return "true";
        case "folder": return `file.folder == ${value}`;
        case "folder_recursive": return `file.inFolder(${value})`;
        case "tag": return `file.hasTag(${str(c.value)})`;
    }
}

export function lowerTargeting(query: string): string {
    const segments = parseQuerySegments(query);
    if (segments.length === 0) return "false";
    return join(
        segments.map(s => join([...s.andConditions.map(lowerTerm), ...s.notConditions.map(c => not(lowerTerm(c)))], "&&")),
        "||"
    );
}

function lowerFilter(filter: PropertyFilter): string[] {
    const parts: string[] = [];
    if (filter.fileNamePattern) {
        parts.push(isRegex(filter.fileNamePattern) ? `file.name.matches(${str(filter.fileNamePattern)}, "i")` : "false");
    }
    if (filter.modifiedAfter && isDate(filter.modifiedAfter)) parts.push(`file.mtime >= date(${str(filter.modifiedAfter)})`);
    if (filter.modifiedBefore && isDate(filter.modifiedBefore)) parts.push(`file.mtime <= date(${str(filter.modifiedBefore)})`);
    if (filter.createdAfter && isDate(filter.createdAfter)) parts.push(`file.ctime >= date(${str(filter.createdAfter)})`);
    if (filter.createdBefore && isDate(filter.createdBefore)) parts.push(`file.ctime <= date(${str(filter.createdBefore)})`);
    if (filter.hasProperty) parts.push(`has(${ref(filter.hasProperty)})`);
    if (filter.notHasProperty) parts.push(`!has(${ref(filter.notHasProperty)})`);
    for (const c of filter.conditions ?? []) parts.push(lowerCondition(c.property, c.operator, c.value, false));
    return parts;
}

function lowerConstraints(field: SchemaField, nested: boolean): string[] {
    const parts: string[] = [];
    const list = (values: string[]): string => `[${values.map(str).join(", ")}]`;
    const bound = (n: unknown): n is number => typeof n === "number" && isFinite(n);

    const s = field.type === "string" ? field.stringConstraints : undefined;
    if (s) {
        if (s.allowedValues && s.allowedValues.length > 0) parts.push(`it in ${list(s.allowedValues)}`);
        if (s.pattern && isRegex(s.pattern)) parts.push(`it.matches(${str(s.pattern)})`);
        if (bound(s.minLength)) parts.push(`size(it) >= ${s.minLength}`);
        if (bound(s.maxLength)) parts.push(`size(it) <= ${s.maxLength}`);
    }

    const n = field.type === "number" ? field.numberConstraints : undefined;
    if (n) {
        if (bound(n.min)) parts.push(`it >= ${n.min}`);
        if (bound(n.max)) parts.push(`it <= ${n.max}`);
    }

    const d = field.type === "date" ? field.dateConstraints : undefined;
    if (d) {
        if (d.min && isDate(d.min)) parts.push(`it >= ${str(d.min)}`);
        if (d.max && isDate(d.max)) parts.push(`it <= ${str(d.max)}`);
    }

    const a = field.type === "array" ? field.arrayConstraints : undefined;
    if (a) {
        if (bound(a.minItems)) parts.push(`size(it) >= ${a.minItems}`);
        if (bound(a.maxItems)) parts.push(`size(it) <= ${a.maxItems}`);
        for (const required of a.contains ?? []) parts.push(`${str(required)} in it`);
        for (const pattern of a.containsPattern ?? []) {
            if (isRegex(pattern)) parts.push(`it.exists(x, x.matches(${str(pattern)}))`);
        }
        if (a.allowedValues && a.allowedValues.length > 0) parts.push(`it.all(x, x in ${list(a.allowedValues)})`);
        if (a.uniqueItems) parts.push("size(it.distinct()) == size(it)");
    }

    const c = nested ? undefined : field.crossFieldConstraint;
    if (c && c.field) parts.push(`${ref(c.field)} == null || it ${SYMBOLS[c.operator]} ${ref(c.field)}`);

    return parts;
}

function lowerField(field: SchemaField, nested: boolean): Field {
    const out: Field = { name: field.name, type: field.type, required: field.required };
    if (field.warn !== undefined) out.warn = field.warn;
    if (field.unique !== undefined) out.unique = field.unique;
    if (field.description !== undefined) out.description = field.description;
    if (field.arrayElementType !== undefined) out.arrayElementType = field.arrayElementType;
    if (field.objectKeyType !== undefined) out.objectKeyType = field.objectKeyType;
    if (field.objectValueType !== undefined) out.objectValueType = field.objectValueType;

    if (!nested && field.conditions && field.conditions.length > 0) {
        out.when = join(
            field.conditions.map(c => lowerCondition(c.field, c.operator, c.value, true)),
            field.conditionLogic === "or" ? "||" : "&&"
        );
    }
    const must = lowerConstraints(field, nested);
    if (must.length > 0) out.must = join(must, "&&");
    return out;
}

function lowerSchema(mapping: SchemaMapping): Schema {
    const where = [lowerTargeting(mapping.query)];
    if (mapping.propertyFilter) where.push(...lowerFilter(mapping.propertyFilter));
    return {
        id: mapping.id,
        name: mapping.name,
        enabled: mapping.enabled,
        where: join(where, "&&"),
        fields: mapping.fields.map(f => lowerField(f, false)),
    };
}

function lowerType(type: CustomType): TypeDef {
    return { id: type.id, name: type.name, fields: type.fields.map(f => lowerField(f, true)) };
}

export function readConfig(value: unknown): Config {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("expected a JSON object");
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.schemas)) {
        return {
            schemas: obj.schemas as Schema[],
            types: Array.isArray(obj.types) ? (obj.types as TypeDef[]) : [],
            unknownFields: typeof obj.unknownFields === "boolean" ? obj.unknownFields : true,
            openFields: Array.isArray(obj.openFields) ? (obj.openFields as string[]) : [],
            exclude: typeof obj.exclude === "string" && obj.exclude.trim() !== "" ? obj.exclude : undefined,
        };
    }
    if (!Array.isArray(obj.schemaMappings)) throw new Error(`"schemas" (or the older "schemaMappings") must be an array`);
    return migrate({
        schemaMappings: obj.schemaMappings as SchemaMapping[],
        customTypes: Array.isArray(obj.customTypes) ? (obj.customTypes as CustomType[]) : [],
        globalExclusions: typeof obj.globalExclusions === "string" ? obj.globalExclusions : undefined,
        warnOnUnknownFields: typeof obj.warnOnUnknownFields === "boolean" ? obj.warnOnUnknownFields : true,
        allowObsidianProperties: typeof obj.allowObsidianProperties === "boolean" ? obj.allowObsidianProperties : true,
    });
}

export function migrate(legacy: PropsecConfig): Config {
    return {
        schemas: legacy.schemaMappings.map(lowerSchema),
        types: legacy.customTypes.map(lowerType),
        unknownFields: legacy.warnOnUnknownFields ?? true,
        openFields: (legacy.allowObsidianProperties ?? true) ? OBSIDIAN_NATIVE_PROPERTIES : [],
        exclude: legacy.globalExclusions?.trim() ? lowerTargeting(legacy.globalExclusions) : undefined,
    };
}
