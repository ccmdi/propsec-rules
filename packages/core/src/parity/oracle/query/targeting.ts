import type { SchemaMapping, CustomType } from "../types";
import type { FileMeta } from "./fileMeta";
import { fileMatchesQuery, fileMatchesPropertyFilter } from "./matcher";

/**
 * Minimal, Obsidian-free config for schema targeting.
 */
export interface PropsecConfig {
    schemaMappings: SchemaMapping[];
    customTypes: CustomType[];
    globalExclusions?: string;          // query string; files matching are excluded from all schemas
    warnOnUnknownFields?: boolean;
    allowObsidianProperties?: boolean;
}

/**
 * Check if a file is excluded by global exclusion rules.
 */
export function isFileGloballyExcluded(file: FileMeta, config: PropsecConfig): boolean {
    if (!config.globalExclusions) return false;
    return fileMatchesQuery(file, config.globalExclusions);
}

/**
 * Check if a file matches a schema mapping.
 */
export function fileMatchesMapping(file: FileMeta, mapping: SchemaMapping, config: PropsecConfig): boolean {
    if (!mapping.enabled || !mapping.query) return false;
    if (isFileGloballyExcluded(file, config)) return false;
    if (!fileMatchesQuery(file, mapping.query)) return false;
    if (mapping.propertyFilter && !fileMatchesPropertyFilter(file, mapping.propertyFilter)) return false;
    return true;
}

/**
 * Get all schema mappings that match a file (accumulation model).
 */
export function getMatchingSchemas(file: FileMeta, config: PropsecConfig): SchemaMapping[] {
    return config.schemaMappings.filter(m => fileMatchesMapping(file, m, config));
}
