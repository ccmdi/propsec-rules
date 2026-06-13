#!/usr/bin/env -S npx tsx
import { run } from "./cli.js";

const argv = process.argv.slice(2);

// Honor NO_COLOR here (env is read at the edge; run() stays deterministic).
if (process.env.NO_COLOR && !argv.includes("--no-color")) {
    argv.push("--no-color");
}

const result = await run(argv, process.cwd());

console.log(result.stdout);
process.exitCode = result.exitCode;
