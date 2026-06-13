import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { run } from "./cli.js";

const BOOK_CONFIG = {
    schemaMappings: [
        {
            id: "book",
            name: "Book",
            sourceTemplatePath: null,
            query: "Books/* or #book",
            enabled: true,
            fields: [
                { name: "title", type: "string", required: true },
                { name: "author", type: "string", required: true },
                { name: "rating", type: "number", required: false },
            ],
        },
    ],
    customTypes: [],
    warnOnUnknownFields: true,
    allowObsidianProperties: true,
};

const createdDirs: string[] = [];

async function makeVault(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "propsec-query-"));
    createdDirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
        const abs = join(dir, rel);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
    }
    return dir;
}

afterEach(async () => {
    while (createdDirs.length > 0) {
        const dir = createdDirs.pop()!;
        await rm(dir, { recursive: true, force: true });
    }
});

const VAULT_FILES = {
    "propsec.config.json": JSON.stringify(BOOK_CONFIG),
    "Books/Dune.md": `---\ntitle: Dune\nauthor: Frank Herbert\nrating: 5\n---\nok\n`,
    "Books/Ten.md": `---\ntitle: Ten\nauthor: X\nrating: 10\n---\nok\n`,
    "Books/Hobbit.md": `---\ntitle: The Hobbit\nauthor: Tolkien\nrating: 4\n---\nok\n`,
    "Notes/todo.md": `---\ntitle: todo\n---\nnot a book\n`,
};

describe("run query --json", () => {
    it("returns the right files in the right order (numeric sort desc, rating>4)", async () => {
        const dir = await makeVault(VAULT_FILES);

        const { exitCode, stdout } = await run(
            ["query", "Books/* where rating > 4 sort by rating desc", dir, "--json"],
            process.cwd()
        );

        expect(exitCode).toBe(0);
        const rows = JSON.parse(stdout) as Array<{ path: string; values: Record<string, unknown> }>;
        expect(rows.map((r) => r.path)).toEqual(["Books/Ten.md", "Books/Dune.md"]);
        // Hobbit (rating 4) excluded by > 4; numeric, so Ten(10) sorts above Dune(5).
        expect(rows.map((r) => r.path)).not.toContain("Books/Hobbit.md");
    });

    it("projects selected columns into row values", async () => {
        const dir = await makeVault(VAULT_FILES);

        const { exitCode, stdout } = await run(
            ["query", "Books/* sort by title select title, rating", dir, "--json"],
            process.cwd()
        );

        expect(exitCode).toBe(0);
        const rows = JSON.parse(stdout) as Array<{ path: string; values: Record<string, unknown> }>;
        expect(rows[0].values).toHaveProperty("title");
        expect(rows[0].values).toHaveProperty("rating");
        // Case-sensitive string sort: "Dune" < "Ten" < "The Hobbit" ('e' < 'h' at index 1).
        expect(rows.map((r) => r.values.title)).toEqual(["Dune", "Ten", "The Hobbit"]);
    });
});

describe("run query (table)", () => {
    it("prints an aligned table with path + columns and a row count", async () => {
        const dir = await makeVault(VAULT_FILES);

        const { exitCode, stdout } = await run(
            ["query", "Books/* where rating >= 4 sort by rating desc select title, rating", dir],
            process.cwd()
        );

        expect(exitCode).toBe(0);
        const lines = stdout.split("\n");
        expect(lines[0]).toMatch(/^path\s+title\s+rating$/);
        expect(stdout).toContain("Books/Ten.md");
        expect(stdout).toContain("Books/Dune.md");
        expect(stdout).toContain("Books/Hobbit.md");
        expect(lines[lines.length - 1]).toMatch(/^3 rows$/);
    });

    it("surfaces an unknown-field warning in table mode", async () => {
        const dir = await makeVault(VAULT_FILES);

        const { exitCode, stdout } = await run(
            ["query", "Books/* where bogus = 1", dir],
            process.cwd()
        );

        expect(exitCode).toBe(0);
        expect(stdout).toContain('warning: field "bogus" is not defined in any schema in scope');
    });
});

describe("run query errors", () => {
    it("exits 2 with the parse error message for a malformed query", async () => {
        const dir = await makeVault(VAULT_FILES);

        const { exitCode, stdout } = await run(["query", "where rating", dir], process.cwd());

        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/operator/i);
    });

    it("exits 2 when the query string is missing", async () => {
        const dir = await makeVault(VAULT_FILES);
        const { exitCode, stdout } = await run(["query"], process.cwd());
        // dir defaults to cwd; query string is undefined -> usage error
        void dir;
        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/query requires a query string/i);
    });

    it("exits 2 with a helpful message when the config is missing", async () => {
        const dir = await makeVault({
            "Books/Dune.md": `---\ntitle: Dune\nauthor: x\nrating: 5\n---\nok\n`,
        });

        const { exitCode, stdout } = await run(["query", "Books/*", dir], process.cwd());

        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/not found/i);
    });

    it("resolves --config and applies targeting via #tag", async () => {
        const dir = await makeVault({
            "myconf.json": JSON.stringify(BOOK_CONFIG),
            "Reading/F451.md": `---\ntitle: F451\nauthor: Bradbury\nrating: 3\ntags:\n  - book\n---\nbook by tag\n`,
            "Notes/x.md": `---\ntitle: x\n---\nnope\n`,
        });

        const { exitCode, stdout } = await run(
            ["query", "#book select title", dir, "--json", "--config", join(dir, "myconf.json")],
            process.cwd()
        );

        expect(exitCode).toBe(0);
        const rows = JSON.parse(stdout) as Array<{ path: string }>;
        expect(rows.map((r) => r.path)).toEqual(["Reading/F451.md"]);
    });
});

describe("query help", () => {
    it("usage documents the query command", async () => {
        const { stdout } = await run(["--help"], process.cwd());
        expect(stdout).toMatch(/query/);
        expect(stdout).toMatch(/--json/);
    });
});
