import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { compile, isWarningViolation, type Config, type Program } from "@propsec/core";
import { loadCorpus, validateCorpus, parseQuery, executeQuery } from "@propsec/engine";
import { loadConfig } from "./config.js";
import { formatViolations, summaryLine } from "./format.js";
import { formatQueryTable } from "./queryFormat.js";
import { runInit } from "./init.js";

export interface RunResult {
    exitCode: number;
    stdout: string;
}

const USAGE = `Usage: propsec <command> [options]

Commands:
  check [dir] [--config <path>] [--strict] [--no-color]
      Validate markdown frontmatter against a propsec JSON schema config.

  query "<query>" [dir] [--config <path>] [--json]
      Run a schema-typed query over the markdown corpus and print a table.

  init [vaultDir] [--from <path>] [--force]
      Generate <vaultDir>/propsec.config.json from an Obsidian propsec
      plugin's data.json (auto-detected under .obsidian/plugins, or --from).

query arguments:
  query            A rule, then optional clauses, e.g.
                   'file.inFolder("Books") && rating > 4 sort by rating desc limit 10 select title, rating'
  dir              Folder to scan for .md files (default: ".")

query options:
  --config <path>  Path to propsec config JSON (same resolution as check)
  --json           Print rows as JSON instead of a table

check arguments:
  dir              Folder to scan for .md files (default: ".")

check options:
  --config <path>  Path to propsec config JSON
                   (default: <dir>/propsec.config.json, then <cwd>/propsec.config.json)
  --strict         Treat warnings as failures (exit 1)
  --no-color       Disable ANSI color output

init arguments:
  vaultDir         Obsidian vault folder (default: ".")

init options:
  --from <path>    Path to a specific plugin data.json
  --force          Overwrite an existing propsec.config.json

Global options:
  -h, --help       Show this help`;

interface ParsedArgs {
    command: string | undefined;
    dir: string;
    queryString: string | undefined;
    config: string | undefined;
    strict: boolean;
    color: boolean;
    json: boolean;
    from: string | undefined;
    force: boolean;
    help: boolean;
    unknownFlag: string | undefined;
}

function parseArgs(argv: string[]): ParsedArgs {
    const result: ParsedArgs = {
        command: undefined,
        dir: ".",
        queryString: undefined,
        config: undefined,
        strict: false,
        color: true,
        json: false,
        from: undefined,
        force: false,
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
        } else if (arg === "--json") {
            result.json = true;
        } else if (arg === "--force") {
            result.force = true;
        } else if (arg === "--config") {
            result.config = argv[++i];
        } else if (arg.startsWith("--config=")) {
            result.config = arg.slice("--config=".length);
        } else if (arg === "--from") {
            result.from = argv[++i];
        } else if (arg.startsWith("--from=")) {
            result.from = arg.slice("--from=".length);
        } else if (arg.startsWith("-")) {
            if (result.unknownFlag === undefined) result.unknownFlag = arg;
        } else {
            positionals.push(arg);
        }
    }

    if (positionals.length > 0) result.command = positionals[0];

    // `query` takes the query string as its first positional, then dir.
    if (result.command === "query") {
        if (positionals.length > 1) result.queryString = positionals[1];
        if (positionals.length > 2) result.dir = positionals[2];
    } else if (positionals.length > 1) {
        result.dir = positionals[1];
    }

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

    if (args.command !== "check" && args.command !== "init" && args.command !== "query") {
        return { exitCode: 2, stdout: `Unknown command: ${args.command}\n\n${USAGE}` };
    }

    if (args.unknownFlag !== undefined) {
        return { exitCode: 2, stdout: `Unknown option: ${args.unknownFlag}\n\n${USAGE}` };
    }

    if (args.command === "init") {
        return runInit({ vaultDir: args.dir, from: args.from, force: args.force }, cwd);
    }

    const dir = isAbsolute(args.dir) ? args.dir : resolve(cwd, args.dir);
    const configPath = resolveConfigPath(args.config, dir, cwd);

    if (args.command === "query") {
        return runQuery({ queryString: args.queryString, dir, configPath, json: args.json });
    }

    try {
        const config = loadConfig(configPath);
        const files = await loadCorpus(dir);
        const violations = validateCorpus(files, compileStrict(config));

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

/** Compile a config, failing on any rule that does not parse. */
function compileStrict(config: Config): Program {
    const program = compile(config);
    if (program.problems.length > 0) {
        throw new Error(program.problems.map((p) => `Invalid rule: ${p.message}`).join("\n"));
    }
    return program;
}

/** Resolve the config path: explicit --config, else <dir>, then <cwd> default. */
function resolveConfigPath(config: string | undefined, dir: string, cwd: string): string {
    if (config !== undefined) {
        return isAbsolute(config) ? config : resolve(cwd, config);
    }
    const dirConfig = resolve(dir, "propsec.config.json");
    const cwdConfig = resolve(cwd, "propsec.config.json");
    return existsSync(dirConfig) ? dirConfig : cwdConfig;
}

interface RunQueryArgs {
    queryString: string | undefined;
    dir: string;
    configPath: string;
    json: boolean;
}

async function runQuery(args: RunQueryArgs): Promise<RunResult> {
    if (args.queryString === undefined) {
        return { exitCode: 2, stdout: `query requires a query string\n\n${USAGE}` };
    }

    try {
        const query = parseQuery(args.queryString);
        const config = loadConfig(args.configPath);
        const files = await loadCorpus(args.dir);
        const result = executeQuery(files, compileStrict(config), query);

        if (args.json) {
            return { exitCode: 0, stdout: JSON.stringify(result.rows, null, 2) };
        }
        return { exitCode: 0, stdout: formatQueryTable(result) };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { exitCode: 2, stdout: message };
    }
}
