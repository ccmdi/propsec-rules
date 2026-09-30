import { readConfig, type Config } from "@propsec/core";

export interface BuildResult {
    config: Config;
    schemaCount: number;
    customTypeCount: number;
}

/**
 * Extract a clean Config from an Obsidian propsec plugin's data.json, in either
 * the rule format or the older one. Pure: no fs, no console. Drops UI-only
 * fields (templatesFolder, status-bar settings, etc.).
 */
export function buildConfigFromObsidian(data: unknown): BuildResult {
    let config: Config;
    try {
        config = readConfig(data);
    } catch (err) {
        throw new Error(`Obsidian data.json: ${err instanceof Error ? err.message : String(err)}`);
    }
    return {
        config,
        schemaCount: config.schemas.length,
        customTypeCount: config.types.length,
    };
}
