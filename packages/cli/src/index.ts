// Public API for @propsec/cli

export { run } from "./cli.js";
export type { RunResult } from "./cli.js";
export { loadConfig } from "./config.js";
export { formatViolations, summarize, summaryLine } from "./format.js";
export type { FormatOptions, Summary } from "./format.js";
export { buildConfigFromObsidian } from "./obsidian.js";
export type { BuildResult } from "./obsidian.js";
export { runInit } from "./init.js";
export type { InitResult } from "./init.js";
