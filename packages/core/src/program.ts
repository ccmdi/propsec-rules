import { compileNode, keyOf, type Expr } from "./expr/compile";
import { conjuncts, parse } from "./expr/parse";
import { show } from "./expr/values";
import {
    groupFieldsByName,
    isPrimitiveType,
    isFieldWarned,
    ISO_DATE_REGEX,
    type Config,
    type Field,
    type FileMeta,
    type Schema,
    type SchemaRef,
    type Violation,
    type ViolationType,
} from "./model";

export interface Problem {
    owner: string;
    field?: string;
    source: string;
    message: string;
}

export interface CompiledSchema {
    readonly schema: Schema;
    matches(file: FileMeta): boolean;
    check(file: FileMeta): Violation[];
    duplicates(files: FileMeta[]): Violation[];
}

export interface Program {
    readonly schemas: CompiledSchema[];
    readonly problems: Problem[];
}

interface Variant {
    field: Field;
    accepts: (value: unknown) => boolean;
    when: Expr | null;
    must: Expr[];
    custom: CompiledType | undefined;
    element: { type: string; accepts: (value: unknown) => boolean; custom: CompiledType | undefined } | undefined;
}

interface Group {
    name: string;
    lower: string;
    variants: Variant[];
}

interface CompiledType {
    name: string;
    groups: Group[];
    names: Set<string>;
}

interface Sink {
    file: FileMeta;
    schema: SchemaRef;
    out: Violation[];
}

const own = Object.prototype.hasOwnProperty;
const NEVER = (): boolean => false;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function actualType(value: unknown): string {
    if (value === null) return "null";
    if (value === undefined) return "undefined";
    if (Array.isArray(value)) return "array";
    if (value instanceof Date) return "date";
    return typeof value;
}

function push(sink: Sink, field: string, type: ViolationType, warned: boolean, message: string, expected?: string, actual?: string): void {
    sink.out.push({
        filePath: sink.file.path,
        schemaMapping: sink.schema,
        field,
        type,
        severity: warned || type === "unknown_field" ? "warning" : "error",
        message,
        expected,
        actual,
    });
}

function acceptsType(type: string, types: Map<string, CompiledType>): (value: unknown) => boolean {
    if (type === "null") return v => v === null || v === undefined;
    if (isPrimitiveType(type)) {
        switch (type) {
            case "string": return v => typeof v === "string";
            case "number": return v => typeof v === "number";
            case "boolean": return v => typeof v === "boolean";
            case "date": return v => (typeof v === "string" ? ISO_DATE_REGEX.test(v) : v instanceof Date);
            case "array": return v => Array.isArray(v);
            case "object": return v => isRecord(v);
            case "unknown": return v => v !== null && v !== undefined;
        }
    }
    const def = types.get(type);
    if (!def) return NEVER;
    return v => isRecord(v) && def.groups.every(g => {
        if (!own.call(v, g.name)) return !g.variants.some(x => x.field.required);
        return g.variants.some(x => x.accepts(v[g.name]));
    });
}

function shapeErrors(value: Record<string, unknown>, def: CompiledType): string[] {
    const errors: string[] = [];
    for (const g of def.groups) {
        if (!own.call(value, g.name)) {
            if (g.variants.some(v => v.field.required)) errors.push(`missing required field "${g.name}"`);
        } else if (!g.variants.some(v => v.accepts(value[g.name]))) {
            errors.push(`"${g.name}" expected ${g.variants.map(v => v.field.type).join(" | ")}, got ${actualType(value[g.name])}`);
        }
    }
    return errors;
}

function checkValue(value: unknown, variant: Variant, path: string, warned: boolean, sink: Sink): void {
    for (const clause of variant.must) {
        if (!clause.test(sink.file, value)) {
            push(sink, path, "constraint", warned, `Constraint failed: ${path} must satisfy ${clause.source} (got ${show(value)})`, clause.source, show(value));
        }
    }
    const element = variant.element;
    if (element && Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
            const item: unknown = value[i];
            const itemPath = `${path}[${i}]`;
            if (element.accepts(item)) {
                if (element.custom && isRecord(item)) checkRecord(item, element.custom, itemPath, warned, sink);
                continue;
            }
            const errors = element.custom && isRecord(item) ? shapeErrors(item, element.custom) : [];
            const detail = errors.length > 0 ? `(expected ${element.type}): ${errors.join("; ")}` : `(expected ${element.type}, got ${actualType(item)})`;
            push(sink, itemPath, "type_mismatch", warned, `Array element type mismatch: ${itemPath} ${detail}`, element.type, actualType(item));
        }
    }
    if (variant.custom && isRecord(value)) checkRecord(value, variant.custom, path, warned, sink);
}

function checkGroup(group: Group, present: boolean, value: unknown, path: string, inherited: boolean, sink: Sink): void {
    const variants = group.variants.filter(v => v.when === null || v.when.test(sink.file));
    if (variants.length === 0) return;
    const groupWarned = isFieldWarned(variants.map(v => v.field));
    const warned = inherited || groupWarned;

    if (!present) {
        if (variants.some(v => v.field.required)) push(sink, path, "missing_required", warned, `Missing required field: ${path}`);
        else if (groupWarned) push(sink, path, "missing_warned", true, `Missing recommended field: ${path}`);
        return;
    }

    const match = variants.find(v => v.accepts(value));
    if (match) {
        checkValue(value, match, path, warned, sink);
        return;
    }

    const expected = variants.map(v => v.field.type).join(" | ");
    let message = `Type mismatch: ${path} (expected ${expected}, got ${actualType(value)})`;
    if (isRecord(value)) {
        for (const v of variants) {
            const errors = v.custom ? shapeErrors(value, v.custom) : [];
            if (errors.length > 0) {
                message = `Type mismatch: ${path} (expected ${v.field.type}): ${errors.join("; ")}`;
                break;
            }
        }
    }
    push(sink, path, groupWarned ? "type_mismatch_warned" : "type_mismatch", warned, message, expected, actualType(value));
}

function checkRecord(value: Record<string, unknown>, def: CompiledType, path: string, warned: boolean, sink: Sink): void {
    for (const key of Object.keys(value)) {
        if (!def.names.has(key)) {
            push(sink, `${path}.${key}`, "unknown_field", warned, `Unknown field: ${path}.${key} (not defined in type "${def.name}")`);
        }
    }
    for (const g of def.groups) {
        const present = own.call(value, g.name);
        checkGroup(g, present, present ? value[g.name] : undefined, `${path}.${g.name}`, warned, sink);
    }
}

function uniqueKey(value: unknown): string {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return JSON.stringify(value.slice().sort());
    return show(value);
}

export function compile(config: Config): Program {
    const problems: Problem[] = [];
    const types = new Map<string, CompiledType>();

    const expressions = (source: string | undefined, owner: string, field: string | undefined, split: boolean): Expr[] | null => {
        if (source === undefined || source.trim() === "") return [];
        try {
            const root = parse(source);
            return (split ? conjuncts(root) : [root]).map(n => compileNode(n, source.slice(n.start, n.end)));
        } catch (e) {
            const detail = e instanceof Error ? e.message : String(e);
            problems.push({ owner, field, source, message: `${owner}${field ? `.${field}` : ""}: ${detail} in \`${source}\`` });
            return null;
        }
    };

    const groupsOf = (fields: Field[], owner: string): Group[] => {
        const groups: Group[] = [];
        groupFieldsByName(fields).forEach((members, name) => {
            groups.push({
                name,
                lower: name.toLowerCase(),
                variants: members.map(field => {
                    const when = expressions(field.when, owner, field.name, false);
                    const elementType = field.type === "array" ? field.arrayElementType : undefined;
                    return {
                        field,
                        accepts: acceptsType(field.type, types),
                        when: when === null ? { source: "", refs: [], value: NEVER, test: NEVER } : when.length > 0 ? when[0] : null,
                        must: expressions(field.must, owner, field.name, true) ?? [],
                        custom: types.get(field.type),
                        element: elementType
                            ? { type: elementType, accepts: acceptsType(elementType, types), custom: types.get(elementType) }
                            : undefined,
                    };
                }),
            });
        });
        return groups;
    };

    for (const type of config.types) {
        if (!types.has(type.name)) types.set(type.name, { name: type.name, groups: [], names: new Set(type.fields.map(f => f.name)) });
    }
    const filled = new Set<string>();
    for (const type of config.types) {
        if (filled.has(type.name)) continue;
        filled.add(type.name);
        types.get(type.name)!.groups = groupsOf(type.fields, `type ${type.name}`);
    }

    const open = new Set(config.openFields.map(f => f.toLowerCase()));

    const schemas = config.schemas.filter(s => s.enabled).map((schema): CompiledSchema => {
        const where = expressions(schema.where, schema.id, undefined, false);
        const matches = where !== null && where.length > 0 ? where[0].test : NEVER;
        const groups = groupsOf(schema.fields, schema.id);
        const known = new Set(groups.map(g => g.lower));
        const ref: SchemaRef = schema;
        const unique = groups.filter(g => g.variants.some(v => v.field.unique === true));

        return {
            schema,
            matches: file => matches(file),
            check: file => {
                const sink: Sink = { file, schema: ref, out: [] };
                const fm = file.frontmatter;
                for (const g of groups) {
                    const key = keyOf(fm, g.name, g.lower);
                    checkGroup(g, key !== undefined, key === undefined ? undefined : fm![key], g.name, false, sink);
                }
                if (config.unknownFields && fm) {
                    for (const key of Object.keys(fm)) {
                        if (known.has(key)) continue;
                        const lower = key.toLowerCase();
                        if (known.has(lower) || open.has(lower)) continue;
                        push(sink, key, "unknown_field", false, `Unknown field: ${key} (not defined in schema)`);
                    }
                }
                return sink.out;
            },
            duplicates: files => {
                const out: Violation[] = [];
                for (const g of unique) {
                    const byValue = new Map<string, FileMeta[]>();
                    for (const file of files) {
                        const key = keyOf(file.frontmatter, g.name, g.lower);
                        const value = key === undefined ? undefined : file.frontmatter![key];
                        if (value === null || value === undefined) continue;
                        const id = uniqueKey(value);
                        const members = byValue.get(id);
                        if (members) members.push(file);
                        else byValue.set(id, [file]);
                    }
                    const warned = isFieldWarned(g.variants.map(v => v.field));
                    byValue.forEach((members, id) => {
                        if (members.length < 2) return;
                        for (const file of members) {
                            const others = members.filter(o => o.path !== file.path).map(o => o.basename);
                            push({ file, schema: ref, out }, g.name, "duplicate_value", warned, `Duplicate value: "${id}" also in: ${others.join(", ")}`, undefined, id);
                        }
                    });
                }
                return out;
            },
        };
    });

    return { schemas, problems };
}

export function matching(program: Program, file: FileMeta): CompiledSchema[] {
    return program.schemas.filter(s => s.matches(file));
}
