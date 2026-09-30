import { readFileSync } from "node:fs";
import { readConfig, type Config } from "@propsec/core";

/**
 * Load and minimally validate a propsec JSON config from disk.
 * Accepts the rule format (`schemas`) and the older plugin format (`schemaMappings`).
 * Throws a friendly Error (naming the path) on missing file, bad JSON, or wrong shape.
 */
export function loadConfig(path: string): Config {
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

    try {
        return readConfig(parsed);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Invalid config ${path}: ${detail}`);
    }
}
