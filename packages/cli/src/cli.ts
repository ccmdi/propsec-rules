import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { isWarningViolation } from "@propsec/core";
import { loadCorpus, validateCorpus } from "@propsec/engine";
import { loadConfig } from "./config.js";
import { formatViolations, summaryLine } from "./format.js";

export interface RunResult {
    exitCode: number;
    stdout: string;
}

const USAGE = `Usage: propsec check [dir] [--config <path>] [--strict] [--no-color]

Validate markdown frontmatter against a propsec JSON schema config.

Arguments:
  dir              Folder to scan for .md files (default: ".")

Options:
  --config <path>  Path to propsec config JSON
                   (default: <dir>/propsec.config.json, then <cwd>/propsec.config.json)
  --strict         Treat warnings as failures (exit 1)
  --no-color       Disable ANSI color output
  -h, --help       Show this help`;

interface ParsedArgs {
    command: string | undefined;
    dir: string;
    config: string | undefined;
    strict: boolean;
    color: boolean;
    help: boolean;
    unknownFlag: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
    const result: ParsedArgs = {
        command: undefined,
        dir: ".",
        config: undefined,
        strict: false,
        color: true,
        help: false,
        unknownFlag: undefined,
    };

    const positionals: string[] = [];

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            result.help = true;
        } else if (arg === "--strict") {
            result.strict = true;
        } else if (arg === "--no-color") {
            result.color = false;
        } else if (arg === "--config") {
            result.config = argv[++i];
        } else if (arg.startsWith("--config=")) {
            result.config = arg.slice("--config=".length);
        } else if (arg.startsWith("-")) {
            if (result.unknownFlag === undefined) result.unknownFlag = arg;
        } else {
            positionals.push(arg);
        }
    }

    if (positionals.length > 0) result.command = positionals[0];
    if (positionals.length > 1) result.dir = positionals[1];

    return result;
}

/**
 * Deterministic CLI core. Takes argv + cwd and RETURNS a result;
 * never calls process.exit, never reads process.argv, never writes to streams.
 * Color is controlled solely via argv (--no-color) so output is reproducible.
 */
export async function run(argv: string[], cwd: string): Promise<RunResult> {
    const args = parseArgs(argv);

    if (args.help) {
        return { exitCode: 0, stdout: USAGE };
    }

    if (args.command === undefined) {
        return { exitCode: 0, stdout: USAGE };
    }

    if (args.command !== "check") {
        return { exitCode: 2, stdout: `Unknown command: ${args.command}\n\n${USAGE}` };
    }

    if (args.unknownFlag !== undefined) {
        return { exitCode: 2, stdout: `Unknown option: ${args.unknownFlag}\n\n${USAGE}` };
    }

    const dir = isAbsolute(args.dir) ? args.dir : resolve(cwd, args.dir);

    let configPath: string;
    if (args.config !== undefined) {
        configPath = isAbsolute(args.config) ? args.config : resolve(cwd, args.config);
    } else {
        const dirConfig = resolve(dir, "propsec.config.json");
        const cwdConfig = resolve(cwd, "propsec.config.json");
        configPath = existsSync(dirConfig) ? dirConfig : cwdConfig;
    }

    try {
        const config = loadConfig(configPath);
        const files = await loadCorpus(dir);
        const violations = validateCorpus(files, config);

        const body = formatViolations(violations, { color: args.color, rootDir: dir });
        const summary = summaryLine(violations);
        const scanned = `scanned ${files.length} file${files.length === 1 ? "" : "s"}`;

        const parts = body ? [body, "", summary, scanned] : [summary, scanned];
        const stdout = parts.join("\n");

        const hasError = violations.some((v) => !isWarningViolation(v));
        const hasWarning = violations.some(isWarningViolation);
        const exitCode = hasError || (args.strict && hasWarning) ? 1 : 0;

        return { exitCode, stdout };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 2, stdout: message };
    }
}
