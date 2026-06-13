import type { PropsecConfig } from "@propsec/core";

export interface BuildResult {
    config: PropsecConfig;
    schemaCount: number;
    customTypeCount: number;
}

/**
 * Extract a clean PropsecConfig from an Obsidian propsec plugin's data.json.
 * Pure: no fs, no console. Keeps only the keys the LSP/CLI cares about and
 * drops UI-only fields (templatesFolder, status-bar settings, etc.).
 */
export function buildConfigFromObsidian(data: unknown): BuildResult {
    if (data === null || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Obsidian data.json: expected a JSON object");
    }

    const obj = data as Record<string, unknown>;

    if (!Array.isArray(obj.schemaMappings)) {
        throw new Error('Obsidian data.json: "schemaMappings" must be an array');
    }

    const config: PropsecConfig = {
        schemaMappings: obj.schemaMappings,
        customTypes: Array.isArray(obj.customTypes) ? obj.customTypes : [],
        warnOnUnknownFields:
            typeof obj.warnOnUnknownFields === "boolean" ? obj.warnOnUnknownFields : true,
        allowObsidianProperties:
            typeof obj.allowObsidianProperties === "boolean"
                ? obj.allowObsidianProperties
                : true,
    };

    if (typeof obj.globalExclusions === "string") {
        config.globalExclusions = obj.globalExclusions;
    }

    return {
        config,
        schemaCount: config.schemaMappings.length,
        customTypeCount: config.customTypes.length,
    };
}
