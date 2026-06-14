import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PropsecConfig } from "@propsec/core";

/**
 * Deterministic synthetic vault generator for benchmarking.
 *
 * NO Math.random: a seeded mulberry32 PRNG drives every choice (field values,
 * body length, where duplicates/violations land) so a given seed reproduces the
 * exact same vault byte-for-byte. This keeps benchmark numbers comparable run to
 * run and lets the correctness tests assert on injected dups/violations.
 */

/** mulberry32: tiny, fast, deterministic 32-bit PRNG. Returns floats in [0, 1). */
function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const FIXED_SEED = 0x9e3779b9;

/**
 * Realistic Book-like schema. Query targets the `Books` folder recursively so
 * files spread across subfolders are still covered. `isbn` is UNIQUE to exercise
 * the cross-file duplicate check; `rating` has a max constraint.
 */
export function bookSchemaConfig(): PropsecConfig {
    return {
        schemaMappings: [
            {
                id: "book-schema",
                name: "Book",
                sourceTemplatePath: null,
                query: "Books/*",
                enabled: true,
                fields: [
                    { name: "title", type: "string", required: true },
                    { name: "author", type: "string", required: true },
                    {
                        name: "rating",
                        type: "number",
                        required: false,
                        numberConstraints: { max: 5 },
                    },
                    { name: "status", type: "string", required: false },
                    { name: "pages", type: "number", required: false },
                    { name: "isbn", type: "string", required: false, unique: true },
                    { name: "published", type: "date", required: false },
                    { name: "tags", type: "array", required: false, arrayElementType: "string" },
                    { name: "publisher", type: "string", required: false },
                    { name: "language", type: "string", required: false },
                ],
            },
        ],
        customTypes: [],
        // Bodies carry no extra frontmatter keys, but keep this off so any future
        // body-tag normalization can't introduce unknown-field noise into numbers.
        warnOnUnknownFields: false,
        allowObsidianProperties: true,
    };
}

const FIRST_NAMES = [
    "Ada", "Frank", "Ursula", "George", "Octavia", "Isaac", "Margaret", "Ray",
    "Philip", "Kurt", "Mary", "Arthur", "Doris", "Neal", "China", "Iain",
];
const LAST_NAMES = [
    "Lovelace", "Herbert", "Le Guin", "Orwell", "Butler", "Asimov", "Atwood",
    "Bradbury", "Dick", "Vonnegut", "Shelley", "Clarke", "Lessing", "Stephenson",
    "Mieville", "Banks",
];
const TITLE_HEADS = [
    "The", "A", "Beyond the", "Children of", "Shadows of", "The Last", "Echoes of",
    "Empire of", "The Lost", "Songs of", "The Hidden", "Wings of",
];
const TITLE_NOUNS = [
    "Dune", "Garden", "Cipher", "Tower", "Machine", "Sea", "Memory", "Forge",
    "Lantern", "Compass", "Archive", "Spire", "Harvest", "Threshold", "Beacon",
    "Atlas",
];
const STATUSES = ["unread", "reading", "finished", "abandoned", "wishlist"];
const PUBLISHERS = [
    "Ace", "Gollancz", "Tor", "Penguin", "Vintage", "Orbit", "Del Rey", "Harper",
];
const LANGUAGES = ["en", "fr", "de", "es", "it", "ja"];
const TAG_POOL = [
    "scifi", "fantasy", "classic", "dystopia", "favorite", "owned", "borrowed",
    "reread", "award-winner", "series",
];
const WORD_POOL = [
    "the", "a", "narrative", "drifts", "across", "a", "ruined", "world", "where",
    "memory", "and", "machine", "blur", "into", "one", "long", "argument", "about",
    "what", "it", "means", "to", "endure", "characters", "trade", "secrets", "in",
    "quiet", "rooms", "while", "empires", "fold", "outside", "the", "prose", "is",
    "spare", "deliberate", "and", "occasionally", "luminous", "each", "chapter",
    "turns", "the", "premise", "another", "degree", "until", "the", "ending",
    "lands", "with", "an", "unhurried", "weight", "readers", "of", "speculative",
    "fiction", "will", "find", "familiar", "shapes", "rendered", "strange",
];

function pick<T>(rng: () => number, arr: readonly T[]): T {
    return arr[Math.floor(rng() * arr.length)];
}

function randInt(rng: () => number, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1));
}

/** Deterministic body of `words` words split into 3-5 paragraphs. */
function generateBody(rng: () => number, words: number): string {
    const sentences: string[] = [];
    let remaining = words;
    while (remaining > 0) {
        const len = Math.min(remaining, randInt(rng, 8, 18));
        const parts: string[] = [];
        for (let i = 0; i < len; i++) parts.push(pick(rng, WORD_POOL));
        let s = parts.join(" ");
        s = s.charAt(0).toUpperCase() + s.slice(1) + ".";
        sentences.push(s);
        remaining -= len;
    }
    // Group sentences into paragraphs.
    const paras: string[] = [];
    let i = 0;
    while (i < sentences.length) {
        const take = randInt(rng, 2, 4);
        paras.push(sentences.slice(i, i + take).join(" "));
        i += take;
    }
    return paras.join("\n\n");
}

function isoDate(rng: () => number): string {
    const year = randInt(rng, 1950, 2024);
    const month = String(randInt(rng, 1, 12)).padStart(2, "0");
    const day = String(randInt(rng, 1, 28)).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function makeIsbn(rng: () => number): string {
    let digits = "";
    for (let i = 0; i < 10; i++) digits += String(randInt(rng, 0, 9));
    return `978-${digits.slice(0, 1)}${digits.slice(1, 7)}${digits.slice(7)}`;
}

function yamlString(v: string): string {
    // Quote to keep YAML safe regardless of content (colons, leading digits, etc.).
    return `"${v.replace(/"/g, '\\"')}"`;
}

interface ViolationKind {
    kind: "rating-string" | "missing-required" | "rating-over-max";
}

function frontmatterFor(
    rng: () => number,
    isbn: string,
    violation: ViolationKind | null
): string {
    const title = `${pick(rng, TITLE_HEADS)} ${pick(rng, TITLE_NOUNS)}`;
    const author = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    const rating = randInt(rng, 1, 5);
    const status = pick(rng, STATUSES);
    const pages = randInt(rng, 80, 1200);
    const published = isoDate(rng);
    const publisher = pick(rng, PUBLISHERS);
    const language = pick(rng, LANGUAGES);
    const tagCount = randInt(rng, 1, 3);
    const tags: string[] = [];
    for (let i = 0; i < tagCount; i++) {
        const t = pick(rng, TAG_POOL);
        if (!tags.includes(t)) tags.push(t);
    }

    const lines: string[] = ["---"];

    // `missing-required` drops `title`; everything else keeps it.
    if (!(violation && violation.kind === "missing-required")) {
        lines.push(`title: ${yamlString(title)}`);
    }
    lines.push(`author: ${yamlString(author)}`);

    if (violation && violation.kind === "rating-string") {
        lines.push(`rating: ${yamlString("five")}`); // type_mismatch: string where number expected
    } else if (violation && violation.kind === "rating-over-max") {
        lines.push(`rating: ${randInt(rng, 6, 10)}`); // number_too_large vs max 5
    } else {
        lines.push(`rating: ${rating}`);
    }

    lines.push(`status: ${yamlString(status)}`);
    lines.push(`pages: ${pages}`);
    lines.push(`isbn: ${yamlString(isbn)}`);
    lines.push(`published: ${published}`);
    lines.push(`tags: [${tags.map(yamlString).join(", ")}]`);
    lines.push(`publisher: ${yamlString(publisher)}`);
    lines.push(`language: ${yamlString(language)}`);
    lines.push("---");
    return lines.join("\n");
}

export interface GenerateVaultOptions {
    count: number;
    dupRate?: number;
    violationRate?: number;
}

/**
 * Write `count` book notes under `<dir>/Books/` (spread across a few subfolders)
 * plus `<dir>/propsec.config.json`. Each note has all ~10 frontmatter fields and
 * a 300-600 word body. `dupRate` of files reuse an earlier isbn (drives the
 * cross-file `unique` check); `violationRate` of files carry one schema violation.
 */
export async function generateVault(dir: string, opts: GenerateVaultOptions): Promise<void> {
    const { count } = opts;
    const dupRate = opts.dupRate ?? 0.02;
    const violationRate = opts.violationRate ?? 0.05;
    const rng = mulberry32(FIXED_SEED);

    const booksDir = join(dir, "Books");
    // A handful of subfolders so loadCorpus walks a real tree; "" = directly in Books/.
    const subfolders = ["", "", "", "scifi", "fantasy", "classics"];
    for (const sub of subfolders) {
        if (sub) await mkdir(join(booksDir, sub), { recursive: true });
    }
    await mkdir(booksDir, { recursive: true });

    const issuedIsbns: string[] = [];

    const violationCycle: ViolationKind["kind"][] = [
        "rating-string",
        "missing-required",
        "rating-over-max",
    ];
    let violationCounter = 0;

    for (let i = 0; i < count; i++) {
        // Decide isbn: reuse an earlier one (duplicate) or mint a fresh one.
        let isbn: string;
        if (issuedIsbns.length > 0 && rng() < dupRate) {
            isbn = issuedIsbns[Math.floor(rng() * issuedIsbns.length)];
        } else {
            isbn = makeIsbn(rng);
            issuedIsbns.push(isbn);
        }

        // Decide violation.
        let violation: ViolationKind | null = null;
        if (rng() < violationRate) {
            const kind = violationCycle[violationCounter % violationCycle.length];
            violationCounter++;
            violation = { kind };
        }

        const fm = frontmatterFor(rng, isbn, violation);
        const body = generateBody(rng, randInt(rng, 300, 600));
        const content = `${fm}\n\n${body}\n`;

        const sub = pick(rng, subfolders);
        const targetDir = sub ? join(booksDir, sub) : booksDir;
        const fileName = `book-${String(i).padStart(6, "0")}.md`;
        await writeFile(join(targetDir, fileName), content, "utf8");
    }

    await writeFile(
        join(dir, "propsec.config.json"),
        JSON.stringify(bookSchemaConfig(), null, 2),
        "utf8"
    );
}
