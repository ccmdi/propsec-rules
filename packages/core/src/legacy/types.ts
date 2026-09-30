import type { FieldType } from "../model";

export type ComparisonOperator =
    | "equals"
    | "not_equals"
    | "greater_than"
    | "less_than"
    | "greater_or_equal"
    | "less_or_equal";

export type PropertyOperator = ComparisonOperator | "contains" | "not_contains" | "in" | "not_in" | "exists" | "not_exists";

// Type definition - user-defined reusable types
export interface CustomType {
    id: string;        // UUID for stable references
    name: string;      // Type name (e.g., "exercise", "person")
    fields: SchemaField[];  // Schema-like field definitions
}

// Constraint types for different field types
export interface StringConstraints {
    pattern?: string;      // Regex pattern
    minLength?: number;
    maxLength?: number;
    allowedValues?: string[];  // Value must be one of these
}

export interface NumberConstraints {
    min?: number;
    max?: number;
}

export interface DateConstraints {
    min?: string;  // ISO date string YYYY-MM-DD
    max?: string;  // ISO date string YYYY-MM-DD
}

// Cross-field constraint: compare this field's value to another field's value
export interface CrossFieldConstraint {
    operator: ComparisonOperator;
    field: string;  // The other field to compare against
}

export interface ArrayConstraints {
    minItems?: number;
    maxItems?: number;
    contains?: string[];  // Array must contain all these values
    containsPattern?: string[];  // Each regex must match at least one element
    uniqueItems?: boolean;  // Array items must be unique
    allowedValues?: string[];  // Every element must be one of these values
}

export interface SchemaField {
    name: string;
    type: FieldType;
    required: boolean;
    // Human-readable documentation for this field (metadata only; not used by validation)
    description?: string;
    // Report this field's violations as warnings (mutually exclusive with required - either warn or required, not both)
    //TODO discrim union
    warn?: boolean;
    // Value must be unique across all files matching the schema
    unique?: boolean;

    // Conditional validation
    conditions?: FieldCondition[];
    conditionLogic?: "and" | "or";

    // For arrays: specify what type the elements should be
    arrayElementType?: FieldType;

    // For objects: specify key and value types
    objectKeyType?: FieldType;      // Usually "string"
    objectValueType?: FieldType;    // Can be any type

    // Optional constraints based on type
    stringConstraints?: StringConstraints;
    numberConstraints?: NumberConstraints;
    dateConstraints?: DateConstraints;
    arrayConstraints?: ArrayConstraints;

    // Cross-field constraint: compare this field to another field
    crossFieldConstraint?: CrossFieldConstraint;
}

// A single property condition
export interface PropertyCondition {
    property: string;
    operator: PropertyOperator;
    value: string;
}

// Condition for when a field should be validated (e.g., "if type=book then isbn is required")
export interface FieldCondition {
    field: string;  // The field to check (e.g., "type")
    operator: PropertyOperator;
    value: string;  // The value to compare (e.g., "book")
}

// Property filter for fine-grained schema application
export interface PropertyFilter {
    // Filter by file name
    fileNamePattern?: string; // Regex pattern to match against file name (without extension)
    // Filter by file dates
    modifiedAfter?: string;   // ISO date: only files modified after this date
    modifiedBefore?: string;  // ISO date: only files modified before this date
    createdAfter?: string;    // ISO date: only files created after this date
    createdBefore?: string;   // ISO date: only files created before this date
    // Filter by frontmatter property existence/value
    hasProperty?: string;     // Property must exist (any value)
    notHasProperty?: string;  // Property must NOT exist
    // Multiple property conditions (AND logic)
    conditions?: PropertyCondition[];
}

export interface SchemaMapping {
    id: string;
    name: string;
    sourceTemplatePath: string | null;
    // Query syntax: "folder", "folder/*", "#tag", "folder/* or #tag"
    query: string;
    enabled: boolean;
    fields: SchemaField[];
    // Optional property-based filter for fine-grained control
    propertyFilter?: PropertyFilter;
}

// Obsidian's reserved frontmatter keys, what the older `allowObsidianProperties` flag allowed
export const OBSIDIAN_NATIVE_PROPERTIES = ["aliases", "tags", "cssclasses", "cssclass"];

export interface PropsecConfig {
    schemaMappings: SchemaMapping[];
    customTypes: CustomType[];
    globalExclusions?: string;          // query string; files matching are excluded from all schemas
    warnOnUnknownFields?: boolean;
    allowObsidianProperties?: boolean;
}
