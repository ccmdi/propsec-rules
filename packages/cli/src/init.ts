import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { buildConfigFromObsidian } from "./obsidian.js";

export interface InitResult {
    exitCode: number;
    stdout: string;
}

const TAG_NOTE =
    "Open this vault folder in your editor; inline body #tags are not read yet, so " +
    "tag-targeted schemas only match frontmatter `tags:` for now.";

async function fileExists(path: string): Promise<boolean> {
    try {
        const s = await stat(path);
        return s.isFile();
    } catch {
        return false;
    }
}

/**
 * Auto-detect candidate data.json files under <vaultDir>/.obsidian/plugins.
 * A candidate is a plugin folder whose name includes "propsec" and that
 * contains a data.json file.
 */
async function findCandidates(pluginsDir: string): Promise<string[]> {
    let entries: import("node:fs").Dirent[];
    try {
        entries = await readdir(pluginsDir, { withFileTypes: true });
    } catch {
        return [];
    }

    const candidates: string[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (!entry.name.includes("propsec")) continue;
        const dataPath = join(pluginsDir, entry.name, "data.json");
        if (await fileExists(dataPath)) candidates.push(dataPath);
    }
    candidates.sort();
    return candidates;
}

/**
 * Generate a propsec.config.json from an Obsidian propsec plugin's data.json.
 * fs-bound but pure of console/exit: returns an InitResult instead.
 */
export async function runInit(
    args: { vaultDir: string; from?: string; force: boolean },
    cwd: string
): Promise<InitResult> {
    const vaultDir = isAbsolute(args.vaultDir) ? args.vaultDir : resolve(cwd, args.vaultDir);
    const pluginsDir = join(vaultDir, ".obsidian", "plugins");

    let sourcePath: string;
    if (args.from !== undefined) {
        sourcePath = isAbsolute(args.from) ? args.from : resolve(cwd, args.from);
    } else {
        const candidates = await findCandidates(pluginsDir);
        if (candidates.length === 0) {
            return {
                exitCode: 2,
                stdout:
                    `No propsec plugin data.json found under ${pluginsDir}\n` +
                    `Pass --from <path> to point at a data.json explicitly.`,
            };
        }
        if (candidates.length > 1) {
            return {
                exitCode: 2,
                stdout:
                    `Multiple propsec plugin folders found:\n` +
                    candidates.map((c) => `  ${c}`).join("\n") +
                    `\nPass --from <path> to choose one.`,
            };
        }
        sourcePath = candidates[0];
    }

    let raw: string;
    try {
        raw = await readFile(sourcePath, "utf8");
    } catch {
        return { exitCode: 2, stdout: `Could not read data.json: ${sourcePath}` };
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        return { exitCode: 2, stdout: `Invalid JSON in ${sourcePath}: ${detail}` };
    }

    let built;
    try {
        built = buildConfigFromObsidian(parsed);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 2, stdout: message };
    }

    const targetPath = join(vaultDir, "propsec.config.json");
    if (!args.force && (await fileExists(targetPath))) {
        return {
            exitCode: 2,
            stdout: `${targetPath} already exists. Use --force to overwrite.`,
        };
    }

    const json = `${JSON.stringify(built.config, null, 2)}\n`;
    try {
        await writeFile(targetPath, json, "utf8");
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 2, stdout: `Could not write ${targetPath}: ${message}` };
    }

    const counts = `${built.schemaCount} schema${built.schemaCount === 1 ? "" : "s"}, ${
        built.customTypeCount
    } custom type${built.customTypeCount === 1 ? "" : "s"}`;

    const stdout = [
        `Source: ${sourcePath}`,
        `Wrote:  ${targetPath}`,
        counts,
        TAG_NOTE,
    ].join("\n");

    return { exitCode: 0, stdout };
}
