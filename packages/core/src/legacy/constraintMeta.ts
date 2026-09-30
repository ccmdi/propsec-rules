import type { FieldType } from "../model";

export type ConstraintInput = "text" | "integer" | "number" | "date" | "string-list" | "boolean";

export interface ConstraintFieldMeta {
    key: string;
    label: string;
    input: ConstraintInput;
    placeholder?: string;
}

export interface ConstraintGroupMeta {
    key: "stringConstraints" | "numberConstraints" | "dateConstraints" | "arrayConstraints";
    title: string;
    appliesTo: FieldType;
    fields: ConstraintFieldMeta[];
}

export const CONSTRAINT_GROUPS: ConstraintGroupMeta[] = [
    {
        key: "stringConstraints",
        title: "String constraints",
        appliesTo: "string",
        fields: [
            { key: "pattern", label: "Pattern (regex):", input: "text", placeholder: "e.g., ^[A-Z].*" },
            { key: "minLength", label: "Min length:", input: "integer" },
            { key: "maxLength", label: "Max length:", input: "integer" },
            { key: "allowedValues", label: "Allowed values:", input: "string-list", placeholder: "value1, value2" },
        ],
    },
    {
        key: "numberConstraints",
        title: "Number constraints",
        appliesTo: "number",
        fields: [
            { key: "min", label: "Min value:", input: "number" },
            { key: "max", label: "Max value:", input: "number" },
        ],
    },
    {
        key: "dateConstraints",
        title: "Date constraints",
        appliesTo: "date",
        fields: [
            { key: "min", label: "Min date:", input: "date" },
            { key: "max", label: "Max date:", input: "date" },
        ],
    },
    {
        key: "arrayConstraints",
        title: "Array constraints",
        appliesTo: "array",
        fields: [
            { key: "minItems", label: "Min items:", input: "integer" },
            { key: "maxItems", label: "Max items:", input: "integer" },
            { key: "contains", label: "Contains:", input: "string-list", placeholder: "value1, value2" },
            { key: "containsPattern", label: "Contains pattern (regex):", input: "string-list", placeholder: "e.g., ^obj/, ^field/" },
            { key: "allowedValues", label: "Allowed values:", input: "string-list", placeholder: "value1, value2" },
            { key: "uniqueItems", label: "Unique items:", input: "boolean" },
        ],
    },
];
