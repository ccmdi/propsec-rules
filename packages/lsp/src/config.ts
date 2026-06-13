import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PropsecConfig } from "@propsec/core";

const CONFIG_FILENAME = "propsec.config.json";

/**
 * Load `<rootDir>/propsec.config.json` into a PropsecConfig.
 * Returns null (and logs) if the file is absent or invalid. A null config means
 * only malformed-frontmatter diagnostics are produced (no schema diagnostics).
 *
 * Mirrors @propsec/cli's loadConfig shape/defaults: schemaMappings required;
 * customTypes default [], warnOnUnknownFields default true, allowObsidianProperties default true.
 */
export function loadConfig(
    rootDir: string,
    log: (msg: string) => void = console.error
): PropsecConfig | null {
    const path = join(rootDir, CONFIG_FILENAME);

    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        log(`propsec: no config at ${path} (schema diagnostics disabled)`);
        return null;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log(`propsec: invalid JSON in config ${path}: ${detail}`);
        return null;
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        log(`propsec: invalid config ${path}: expected a JSON object`);
        return null;
    }

    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj.schemaMappings)) {
        log(`propsec: invalid config ${path}: "schemaMappings" must be an array`);
        return null;
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

export { CONFIG_FILENAME };
