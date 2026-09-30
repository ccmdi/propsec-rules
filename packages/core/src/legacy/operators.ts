/**
 * Operator names and display metadata for the stored schema format.
 */

// ============ Type Definitions ============

/**
 * Base comparison operators (used for cross-field comparisons)
 */
export type ComparisonOperator =
    | "equals"
    | "not_equals"
    | "greater_than"
    | "less_than"
    | "greater_or_equal"
    | "less_or_equal";

/**
 * Extended operators that include contains/not_contains and existence checks (used for property conditions)
 */
export type PropertyOperator = ComparisonOperator | "contains" | "not_contains" | "in" | "not_in" | "exists" | "not_exists";

// ============ Operator Lists ============

/**
 * All comparison operators (no contains)
 */
export const COMPARISON_OPERATORS: ComparisonOperator[] = [
    "equals",
    "not_equals",
    "greater_than",
    "less_than",
    "greater_or_equal",
    "less_or_equal",
];

/**
 * All property operators (includes contains)
 */
export const PROPERTY_OPERATORS: PropertyOperator[] = [
    ...COMPARISON_OPERATORS,
    "contains",
    "not_contains",
    "in",
    "not_in",
    "exists",
    "not_exists",
];

// ============ Operator Metadata ============

export interface OperatorInfo {
    value: PropertyOperator;
    label: string;      // UI display label
    symbol: string;     // Short symbol (=, !=, >, etc.)
}

/**
 * Complete metadata for all operators
 */
export const OPERATOR_INFO: Record<PropertyOperator, OperatorInfo> = {
    equals: { value: "equals", label: "equals", symbol: "=" },
    not_equals: { value: "not_equals", label: "not equals", symbol: "!=" },
    greater_than: { value: "greater_than", label: "greater than", symbol: ">" },
    less_than: { value: "less_than", label: "less than", symbol: "<" },
    greater_or_equal: { value: "greater_or_equal", label: ">=", symbol: ">=" },
    less_or_equal: { value: "less_or_equal", label: "<=", symbol: "<=" },
    contains: { value: "contains", label: "contains", symbol: "contains" },
    not_contains: { value: "not_contains", label: "not contains", symbol: "!contains" },
    in: { value: "in", label: "in", symbol: "in" },
    not_in: { value: "not_in", label: "not in", symbol: "!in" },
    exists: { value: "exists", label: "exists", symbol: "exists" },
    not_exists: { value: "not_exists", label: "not exists", symbol: "!exists" },
};

/**
 * Get display label for an operator
 */
export function getOperatorDisplayName(operator: PropertyOperator): string {
    return OPERATOR_INFO[operator]?.label ?? operator;
}

/**
 * Get symbol for an operator
 */
export function getOperatorSymbol(operator: PropertyOperator): string {
    return OPERATOR_INFO[operator]?.symbol ?? "?";
}

/**
 * Get operator options for UI dropdowns (comparison operators only)
 */
export function getComparisonOperatorOptions(): OperatorInfo[] {
    return COMPARISON_OPERATORS.map(op => OPERATOR_INFO[op]);
}

/**
 * Get operator options for UI dropdowns (all property operators)
 */
export function getPropertyOperatorOptions(): OperatorInfo[] {
    return PROPERTY_OPERATORS.map(op => OPERATOR_INFO[op]);
}

// ============ Operators by Property Type ============

/**
 * Get valid operators for a given Obsidian property type
 */
export function getOperatorsForPropertyType(propertyType: string): PropertyOperator[] {
    switch (propertyType) {
        case "number":
            return ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal", "in", "not_in", "exists", "not_exists"];
        case "checkbox":
            return ["equals", "not_equals", "exists", "not_exists"];
        case "date":
        case "datetime":
            return ["equals", "not_equals", "greater_than", "less_than", "greater_or_equal", "less_or_equal", "exists", "not_exists"];
        case "tags":
        case "aliases":
        case "multitext":
            return ["contains", "not_contains", "in", "not_in", "equals", "not_equals", "exists", "not_exists"];
        case "text":
        default:
            return ["equals", "not_equals", "contains", "not_contains", "in", "not_in", "exists", "not_exists"];
    }
}
