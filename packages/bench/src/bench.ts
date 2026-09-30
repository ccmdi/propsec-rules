import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as os from "node:os";
import {
    loadCorpus,
    validateCorpus,
    buildValueIndex,
    computeCompletions,
    parseQuery,
    executeQuery,
    buildFileMeta,
    type CorpusFile,
    type CompletionContext,
    type ValueIndex,
} from "@propsec/engine";
import { computeDiagnostics } from "@propsec/lsp";
import { compile, migrate, type Program } from "@propsec/core";
import { generateVault, bookSchemaConfig } from "./genVault.js";

// ---------- argv ----------

function parseArgs(argv: string[]): { sizes: number[] } {
    let sizes = [100, 1000, 10000];
    const extra: number[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--sizes") {
            const v = argv[++i] ?? "";
            sizes = v
                .split(",")
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => Number.isFinite(n) && n > 0);
        } else if (a.startsWith("--sizes=")) {
            sizes = a
                .slice("--sizes=".length)
                .split(",")
                .map((s) => parseInt(s.trim(), 10))
                .filter((n) => Number.isFinite(n) && n > 0);
        } else if (a === "--max") {
            const n = parseInt(argv[++i] ?? "", 10);
            if (Number.isFinite(n) && n > 0) extra.push(n);
        } else if (a.startsWith("--max=")) {
            const n = parseInt(a.slice("--max=".length), 10);
            if (Number.isFinite(n) && n > 0) extra.push(n);
        }
    }
    const merged = [...new Set([...sizes, ...extra])].sort((x, y) => x - y);
    return { sizes: merged };
}

// ---------- timing ----------

/** Discard 1 warm-up run, then return the median of `k` timed runs in ms. */
function measure(fn: () => void, k: number): number {
    fn(); // warm-up (discarded)
    const samples: number[] = [];
    for (let i = 0; i < k; i++) {
        const t0 = performance.now();
        fn();
        samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    return samples.length % 2 === 1 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;
}

/** Async variant for loadCorpus. */
async function measureAsync(fn: () => Promise<unknown>, k: number): Promise<number> {
    await fn(); // warm-up (discarded; also warms OS file cache)
    const samples: number[] = [];
    for (let i = 0; i < k; i++) {
        const t0 = performance.now();
        await fn();
        samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    return samples.length % 2 === 1 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;
}

const K_MEM = 5;
const K_IO = 3;

// ---------- formatting ----------

function sig3(n: number): string {
    if (!Number.isFinite(n)) return "-";
    if (n === 0) return "0";
    if (n >= 100) return n.toFixed(0);
    if (n >= 10) return n.toFixed(1);
    if (n >= 1) return n.toFixed(2);
    return n.toPrecision(3);
}

interface Row {
    size: number;
    coldLoad: number;
    warmLoad: number;
    validate: number;
    diagnostics: number;
    valueIndex: number;
    query: number;
    perEdit: number;
    completionFull: number;
    completionWarm: number;
    heapMB: number;
}

const COLUMNS: Array<{ key: keyof Row; label: string }> = [
    { key: "size", label: "size" },
    { key: "coldLoad", label: "coldLoad" },
    { key: "warmLoad", label: "warmLoad" },
    { key: "validate", label: "validate" },
    { key: "diagnostics", label: "diagnostics" },
    { key: "valueIndex", label: "valueIndex" },
    { key: "query", label: "query" },
    { key: "perEdit", label: "perEdit" },
    { key: "completionFull", label: "complFull" },
    { key: "completionWarm", label: "complWarm" },
    { key: "heapMB", label: "heapMB" },
];

function cell(row: Row, key: keyof Row): string {
    if (key === "size") return String(row.size);
    if (key === "heapMB") return sig3(row.heapMB);
    return sig3(row[key]);
}

function printTable(rows: Row[]): void {
    const header = COLUMNS.map((c) => c.label);
    const body = rows.map((r) => COLUMNS.map((c) => cell(r, c.key)));
    const widths = header.map((h, i) =>
        Math.max(h.length, ...body.map((b) => b[i].length))
    );
    const fmtRow = (cells: string[]) =>
        cells.map((c, i) => c.padStart(widths[i])).join("  ");

    console.log("\n=== RESULTS (median ms; coldLoad=no cache, warmLoad=cache hit; heapMB=heap after load) ===");
    console.log(fmtRow(header));
    console.log(widths.map((w) => "-".repeat(w)).join("  "));
    for (const b of body) console.log(fmtRow(b));
}

// ---------- per-size benchmark ----------

async function benchSize(size: number, program: Program): Promise<Row> {
    const dir = await mkdtemp(join(tmpdir(), `bench-${size}-`));
    try {
        await generateVault(dir, { count: size });

        // coldLoad: full read+parse every call (no cache). measureAsync's warm-up
        // also warms the OS file cache, so this is parse+build-dominated.
        const coldLoad = await measureAsync(() => loadCorpus(dir, { cache: false }), K_IO);

        // warmLoad: the cache hit. The first call (measureAsync's discarded warm-up)
        // builds .propsec/cache.json; every timed call reuses it (no read/parse).
        const warmLoad = await measureAsync(() => loadCorpus(dir), K_IO);

        // Stable corpus for the in-memory ops.
        const corpus = await loadCorpus(dir);

        // heap after load (optionally gc'd if launched with --expose-gc)
        const gc = (globalThis as { gc?: () => void }).gc;
        if (gc) gc();
        const heapMB = process.memoryUsage().heapUsed / 1e6;

        const validate = measure(() => void validateCorpus(corpus, program), K_MEM);
        const diagnostics = measure(() => void computeDiagnostics(corpus, program), K_MEM);
        const valueIndex = measure(() => void buildValueIndex(corpus), K_MEM);

        const parsedQuery = parseQuery('file.folder == "Books" && rating >= 3 sort by rating desc');
        const query = measure(() => void executeQuery(corpus, program, parsedQuery), K_MEM);

        // perEdit: rebuild ONE file's CorpusFile from its text and revalidate a snapshot.
        const editTarget = corpus[Math.floor(corpus.length / 2)];
        const editAbsPath = join(dir, editTarget.meta.path);
        const editText = await readFile(editAbsPath, "utf8");
        const perEdit = measure(() => {
            const rebuilt = buildFileMeta({
                path: editTarget.meta.path,
                content: editText,
                mtime: editTarget.meta.mtime,
                ctime: editTarget.meta.ctime,
            });
            const snapshot = corpus.slice();
            const idx = snapshot.indexOf(editTarget);
            snapshot[idx] = rebuilt;
            void computeDiagnostics(snapshot, program);
        }, K_MEM);

        // completion context at a KEY position (line 1, char 0 = before `title:`).
        const ctxFile = corpus[0];
        const ctxText = await readFile(join(dir, ctxFile.meta.path), "utf8");
        const ctx: CompletionContext = {
            fileMeta: ctxFile.meta,
            parsed: ctxFile.parsed,
            text: ctxText,
            position: { line: 1, character: 0 },
        };

        // completionFull = value-index rebuild + completion (what the server does per request).
        const completionFull = measure(() => {
            const vi = buildValueIndex(corpus);
            void computeCompletions(ctx, program, vi);
        }, K_MEM);

        // completionWarm = completion alone against a prebuilt index.
        const prebuilt: ValueIndex = buildValueIndex(corpus);
        const completionWarm = measure(
            () => void computeCompletions(ctx, program, prebuilt),
            K_MEM
        );

        return {
            size,
            coldLoad,
            warmLoad,
            validate,
            diagnostics,
            valueIndex,
            query,
            perEdit,
            completionFull,
            completionWarm,
            heapMB,
        };
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

// ---------- observations ----------

function ratio(rows: Row[], key: keyof Row, a: number, b: number): number | null {
    const ra = rows.find((r) => r.size === a);
    const rb = rows.find((r) => r.size === b);
    if (!ra || !rb) return null;
    const va = ra[key] as number;
    const vb = rb[key] as number;
    if (!va) return null;
    return vb / va;
}

/** Linear-fit projection of a metric to `targetSize` from the two largest rows. */
function project(rows: Row[], key: keyof Row, targetSize: number): number | null {
    if (rows.length < 2) return null;
    const sorted = [...rows].sort((a, b) => a.size - b.size);
    const p1 = sorted[sorted.length - 2];
    const p2 = sorted[sorted.length - 1];
    const x1 = p1.size;
    const x2 = p2.size;
    const y1 = p1[key] as number;
    const y2 = p2[key] as number;
    const slope = (y2 - y1) / (x2 - x1);
    // Non-positive slope means the op isn't growing with N (O(1)/noise); a linear
    // extrapolation would go negative, which is meaningless for a runtime. Report
    // it as flat at the last measured value instead.
    if (slope <= 0) return y2;
    return y2 + slope * (targetSize - x2);
}

function scalingNote(rows: Row[], key: keyof Row): string {
    const sorted = [...rows].sort((a, b) => a.size - b.size);
    if (sorted.length < 2) return "n/a (need >=2 sizes)";
    const smallest = sorted[0];
    const largest = sorted[sorted.length - 1];
    const sizeFactor = largest.size / smallest.size;
    const timeFactor = (largest[key] as number) / (smallest[key] as number || 1e-9);
    const exp = Math.log(timeFactor) / Math.log(sizeFactor);
    let shape: string;
    if (exp < 0.3) shape = "~flat (O(1))";
    else if (exp < 1.35) shape = "~linear (O(N))";
    else if (exp < 1.8) shape = "super-linear";
    else shape = "~quadratic (O(N^2))";
    return `${timeFactor.toFixed(1)}x time over ${sizeFactor.toFixed(0)}x size -> exponent ~${exp.toFixed(2)} (${shape})`;
}

function printObservations(rows: Row[]): void {
    const largest = [...rows].sort((a, b) => a.size - b.size)[rows.length - 1];

    console.log("\n=== THROUGHPUT (largest size) ===");
    console.log(`size = ${largest.size}`);
    console.log(`coldLoad: ${(largest.size / (largest.coldLoad / 1000)).toFixed(0)} files/sec`);
    console.log(`warmLoad: ${(largest.size / (largest.warmLoad / 1000)).toFixed(0)} files/sec`);
    console.log(`validate: ${(largest.size / (largest.validate / 1000)).toFixed(0)} files/sec`);

    console.log("\n=== OBSERVATIONS ===");
    const metricKeys: Array<keyof Row> = [
        "coldLoad",
        "warmLoad",
        "validate",
        "diagnostics",
        "valueIndex",
        "query",
        "perEdit",
        "completionFull",
        "completionWarm",
    ];
    for (const k of metricKeys) {
        console.log(`- ${k.padEnd(15)} ${scalingNote(rows, k)}`);
    }

    console.log("\n=== STARTUP CACHE (COLD vs WARM loadCorpus) ===");
    console.log(
        "  cold = full read+parse every call ({cache:false}); warm = .propsec/cache.json hit (no read/parse)."
    );
    for (const r of [...rows].sort((a, b) => a.size - b.size)) {
        const speedup = r.warmLoad > 0 ? r.coldLoad / r.warmLoad : Infinity;
        console.log(
            `- @${String(r.size).padEnd(6)} cold ${sig3(r.coldLoad)}ms -> warm ${sig3(
                r.warmLoad
            )}ms  (${speedup.toFixed(1)}x faster)`
        );
    }

    console.log("\n=== INTERACTIVITY (PER-KEYSTROKE LSP COSTS) ===");
    const INTERACTIVE_BUDGET = 100; // ms; above this a keystroke feels laggy
    for (const k of ["perEdit", "completionFull"] as Array<keyof Row>) {
        const at = largest[k] as number;
        const proj50k = project(rows, k, 50000);
        const verdict10k =
            at > INTERACTIVE_BUDGET
                ? `OVER ${INTERACTIVE_BUDGET}ms -> NOTICEABLE lag`
                : `under ${INTERACTIVE_BUDGET}ms -> ok`;
        const verdict50k =
            proj50k === null
                ? ""
                : proj50k > INTERACTIVE_BUDGET
                  ? ` | projected@50k ${sig3(proj50k)}ms -> OVER budget, hurts interactivity`
                  : ` | projected@50k ${sig3(proj50k)}ms -> still ok`;
        console.log(
            `- ${k.padEnd(15)} @${largest.size} = ${sig3(at)}ms -> ${verdict10k}${verdict50k}`
        );
    }
    console.log(
        "  (perEdit and completionFull run on EVERY keystroke the server processes;\n" +
            "   both rebuild over the whole corpus, so cost grows with vault size.)"
    );

    // Show completion rebuild overhead explicitly.
    const overhead = largest.completionFull - largest.completionWarm;
    console.log(
        `\n- completion value-index rebuild overhead @${largest.size}: ` +
            `${sig3(overhead)}ms (full ${sig3(largest.completionFull)} vs warm ${sig3(
                largest.completionWarm
            )}). ` +
            `The rebuild dominates; caching the value index would make completion ~O(1).`
    );
}

// ---------- gc relaunch ----------

function ensureExposeGc(): boolean {
    if ((globalThis as { gc?: () => void }).gc) return true;
    // Relaunch self once with --expose-gc so heapMB reflects live heap.
    if (process.env.BENCH_RELAUNCHED === "1") return false;
    const self = fileURLToPath(import.meta.url);
    const res = spawnSync(
        process.execPath,
        ["--expose-gc", "--import", "tsx", self, ...process.argv.slice(2)],
        {
            stdio: "inherit",
            env: { ...process.env, BENCH_RELAUNCHED: "1" },
        }
    );
    process.exit(res.status ?? 0);
}

// ---------- main ----------

async function main(): Promise<void> {
    const haveGc = ensureExposeGc();

    const { sizes } = parseArgs(process.argv.slice(2));
    const program = compile(migrate(bookSchemaConfig()));

    console.log("propsec bench");
    console.log(`node ${process.version}, cpus ${os.cpus().length}`);
    console.log(`gc: ${haveGc ? "available (--expose-gc)" : "UNAVAILABLE (heapMB not gc'd)"}`);
    console.log(`sizes: ${sizes.join(", ")}`);
    console.log(`methodology: 1 warm-up discarded, then median of K (K=${K_MEM} in-memory, K=${K_IO} loadCorpus)`);

    const rows: Row[] = [];
    for (const size of sizes) {
        process.stdout.write(`\nmeasuring size=${size} ... `);
        const row = await benchSize(size, program);
        process.stdout.write("done");
        rows.push(row);
    }

    printTable(rows);
    printObservations(rows);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
