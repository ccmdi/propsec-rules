import { readFileSync } from "node:fs";
import type { PropsecConfig } from "@propsec/core";

/**
 * Load and minimally validate a propsec JSON config from disk.
 * Applies defaults for customTypes / warnOnUnknownFields / allowObsidianProperties.
 * Throws a friendly Error (naming the path) on missing file, bad JSON, or wrong shape.
 */
export function loadConfig(path: string): PropsecConfig {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        throw new Error(`Config not found: ${path}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid JSON in config ${path}: ${detail}`);
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid config ${path}: expected a JSON object`);
    }

    const obj = parsed as Record<string, unknown>;

    if (!Array.isArray(obj.schemaMappings)) {
        throw new Error(`Invalid config ${path}: "schemaMappings" must be an array`);
    }

    return {
        schemaMappings: obj.schemaMappings,
        customTypes: Array.isArray(obj.customTypes) ? obj.customTypes : [],
        globalExclusions:
            typeof obj.globalExclusions === "string" ? obj.globalExclusions : undefined,
        warnOnUnknownFields:
            typeof obj.warnOnUnknownFields === "boolean" ? obj.warnOnUnknownFields : true,
        allowObsidianProperties:
            typeof obj.allowObsidianProperties === "boolean"
                ? obj.allowObsidianProperties
                : true,
    } as PropsecConfig;
}
