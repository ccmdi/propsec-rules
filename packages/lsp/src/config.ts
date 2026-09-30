import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compile, readConfig, type Program } from "@propsec/core";

const CONFIG_FILENAME = "propsec.config.json";

/**
 * Load and compile `<rootDir>/propsec.config.json`.
 * Returns null (and logs) if the file is absent or invalid. A null program means
 * only malformed-frontmatter diagnostics are produced (no schema diagnostics).
 */
export function loadConfig(
    rootDir: string,
    log: (msg: string) => void = console.error
): Program | null {
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

    try {
        const program = compile(readConfig(parsed));
        for (const p of program.problems) log(`propsec: ${p.message}`);
        return program;
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        log(`propsec: invalid config ${path}: ${detail}`);
        return null;
    }
}

export { CONFIG_FILENAME };
