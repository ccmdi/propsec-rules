export interface FileMeta {
    path: string;
    parentPath: string;
    basename: string;
    mtime: number;
    ctime: number;
    frontmatter: Record<string, unknown> | undefined;
    tags: string[];
}

export type PrimitiveFieldType =
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "array"
    | "object"
    | "null"
    | "unknown";

export type FieldType = string;

export const PRIMITIVE_TYPES: PrimitiveFieldType[] = ["string", "number", "boolean", "date", "array", "object", "null", "unknown"];

// Obsidian's reserved frontmatter keys
export const OBSIDIAN_NATIVE_PROPERTIES = ["aliases", "tags", "cssclasses", "cssclass"];

export const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function isPrimitiveType(type: string): type is PrimitiveFieldType {
    return (PRIMITIVE_TYPES as string[]).indexOf(type) >= 0;
}

export interface Field {
    name: string;
    type: FieldType;
    required: boolean;
    warn?: boolean;
    unique?: boolean;
    description?: string;
    arrayElementType?: FieldType;
    objectKeyType?: FieldType;
    objectValueType?: FieldType;
    when?: string;
    must?: string;
}

export interface TypeDef {
    id: string;
    name: string;
    fields: Field[];
}

export interface Schema {
    id: string;
    name: string;
    enabled: boolean;
    where: string;
    fields: Field[];
}

export interface Config {
    schemas: Schema[];
    types: TypeDef[];
    unknownFields: boolean;
    exclude?: string;
    openFields: string[];
}

export type ViolationType =
    | "missing_required"
    | "missing_warned"
    | "type_mismatch"
    | "type_mismatch_warned"
    | "unknown_field"
    | "constraint"
    | "duplicate_value"
    | "malformed_frontmatter";

export type ViolationSeverity = "error" | "warning";

export interface SchemaRef {
    id: string;
    name: string;
}

export interface Violation {
    filePath: string;
    schemaMapping: SchemaRef;
    field: string;
    type: ViolationType;
    severity: ViolationSeverity;
    message: string;
    expected?: string;
    actual?: string;
}

export function isWarningViolation(violation: Violation): boolean {
    return violation.severity === "warning";
}

export const MALFORMED_SCHEMA: SchemaRef = { id: "__malformed__", name: "Malformed frontmatter" };

export function malformedViolation(filePath: string): Violation {
    return {
        filePath,
        schemaMapping: MALFORMED_SCHEMA,
        field: "frontmatter",
        type: "malformed_frontmatter",
        severity: "error",
        message: "Malformed YAML frontmatter (unparseable)",
    };
}

export function groupFieldsByName<T extends { name: string }>(fields: T[]): Map<string, T[]> {
    const groups = new Map<string, T[]>();
    for (const field of fields) {
        const existing = groups.get(field.name);
        if (existing) existing.push(field);
        else groups.set(field.name, [field]);
    }
    return groups;
}

export function isFieldWarned(variants: { required: boolean; warn?: boolean }[]): boolean {
    return !variants.some(v => v.required) && variants.some(v => v.warn === true);
}

/**
 * Format a field's type for display.
 * e.g., array with elementType "person" becomes "person[]"
 */
export function formatTypeDisplay(field: Field): string {
    if (field.type === "array" && field.arrayElementType) {
        return `${field.arrayElementType}[]`;
    }
    if (field.type === "object" && field.objectValueType) {
        const keyType = field.objectKeyType || "string";
        return `{ ${keyType}: ${field.objectValueType} }`;
    }
    return field.type;
}
