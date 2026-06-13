import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { run } from "./cli.js";

const BOOK_CONFIG = {
    schemaMappings: [
        {
            id: "book",
            name: "Book",
            sourceTemplatePath: null,
            query: "Books/*",
            enabled: true,
            fields: [
                { name: "title", type: "string", required: true },
                { name: "author", type: "string", required: true },
                { name: "rating", type: "number", required: false, numberConstraints: { max: 5 } },
                { name: "isbn", type: "string", required: false, unique: true },
            ],
        },
    ],
    customTypes: [],
    warnOnUnknownFields: true,
    allowObsidianProperties: true,
};

const createdDirs: string[] = [];

async function makeVault(files: Record<string, string>): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "propsec-cli-"));
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

describe("run check", () => {
    it("reports violations with file:line:col and a summary, exit 1", async () => {
        const dir = await makeVault({
            "propsec.config.json": JSON.stringify(BOOK_CONFIG),
            "Books/Dune.md": `---\ntitle: Dune\nauthor: Frank Herbert\nrating: 5\nisbn: "A1"\n---\nok\n`,
            "Books/Hobbit.md": `---\ntitle: The Hobbit\nrating: 4\nisbn: "A2"\n---\nmissing author\n`,
            "Books/1984.md": `---\ntitle: "1984"\nauthor: Orwell\nrating: great\nextra: foo\nisbn: "A3"\n---\nbad\n`,
            "Books/BNW.md": `---\ntitle: BNW\nauthor: Huxley\nisbn: "DUP"\n---\ndup\n`,
            "Books/F451.md": `---\ntitle: F451\nauthor: Bradbury\nrating: 9\nisbn: "DUP"\n---\ndup+big\n`,
            "Broken.md": `---\ntitle: Broken\nauthor: [unclosed\n---\nbad yaml\n`,
        });

        const { exitCode, stdout } = await run(["check", dir, "--no-color"], process.cwd());

        expect(exitCode).toBe(1);

        // missing_required
        expect(stdout).toContain("Books/Hobbit.md");
        expect(stdout).toContain("Missing required field: author");
        // type_mismatch + unknown_field
        expect(stdout).toContain("Books/1984.md");
        expect(stdout).toMatch(/Type mismatch: rating/);
        expect(stdout).toMatch(/Unknown field: extra/);
        // number_too_large
        expect(stdout).toMatch(/Number too large: rating is 9/);
        // duplicate_value on both files
        expect(stdout).toContain("Books/BNW.md");
        expect(stdout).toContain("Books/F451.md");
        expect(stdout).toMatch(/Duplicate value: "DUP"/);
        // malformed
        expect(stdout).toContain("Broken.md");
        expect(stdout).toMatch(/Malformed YAML frontmatter/);

        // a concrete file:line:col line (1-based): rating mismatch on 1984 is line 4 col 1
        expect(stdout).toMatch(/4:1\s+error\s+Type mismatch: rating/);

        // summary + scanned lines
        expect(stdout).toMatch(/\d+ errors?, \d+ warnings? in \d+ files?/);
        expect(stdout).toMatch(/scanned 6 files/);

        // no ANSI when --no-color
        expect(stdout).not.toContain("\x1b[");
    });

    it("exits 0 for a clean vault", async () => {
        const dir = await makeVault({
            "propsec.config.json": JSON.stringify(BOOK_CONFIG),
            "Books/Dune.md": `---\ntitle: Dune\nauthor: Frank Herbert\nrating: 5\nisbn: "Z1"\n---\nok\n`,
        });

        const { exitCode, stdout } = await run(["check", dir, "--no-color"], process.cwd());

        expect(exitCode).toBe(0);
        expect(stdout).toMatch(/0 errors, 0 warnings in 0 files/);
        expect(stdout).toMatch(/scanned 1 file/);
    });

    it("exits 1 under --strict for a warnings-only vault", async () => {
        // Only an unknown_field (warning), no errors.
        const dir = await makeVault({
            "propsec.config.json": JSON.stringify(BOOK_CONFIG),
            "Books/Dune.md": `---\ntitle: Dune\nauthor: Frank Herbert\nextra: foo\n---\nwarn only\n`,
        });

        const lenient = await run(["check", dir, "--no-color"], process.cwd());
        expect(lenient.exitCode).toBe(0);
        expect(lenient.stdout).toMatch(/Unknown field: extra/);

        const strict = await run(["check", dir, "--no-color", "--strict"], process.cwd());
        expect(strict.exitCode).toBe(1);
        expect(strict.stdout).toMatch(/Unknown field: extra/);
    });

    it("exits 2 with a helpful message when the config is missing", async () => {
        const dir = await makeVault({
            "Books/Dune.md": `---\ntitle: Dune\n---\nno config\n`,
        });

        const { exitCode, stdout } = await run(["check", dir, "--no-color"], process.cwd());

        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/not found/i);
        expect(stdout).toMatch(/propsec\.config\.json/);
    });

    it("resolves --config relative to cwd and a dir default", async () => {
        const dir = await makeVault({
            "myconf.json": JSON.stringify(BOOK_CONFIG),
            "Books/Hobbit.md": `---\ntitle: The Hobbit\nisbn: "B1"\n---\nmissing author\n`,
        });

        const { exitCode, stdout } = await run(
            ["check", dir, "--no-color", "--config", join(dir, "myconf.json")],
            process.cwd()
        );

        expect(exitCode).toBe(1);
        expect(stdout).toContain("Missing required field: author");
    });
});

describe("run usage / unknown commands", () => {
    it("prints usage with exit 0 for --help", async () => {
        const { exitCode, stdout } = await run(["--help"], process.cwd());
        expect(exitCode).toBe(0);
        expect(stdout).toMatch(/Usage: propsec/);
    });

    it("prints usage with exit 0 for no args", async () => {
        const { exitCode, stdout } = await run([], process.cwd());
        expect(exitCode).toBe(0);
        expect(stdout).toMatch(/Usage: propsec/);
    });

    it("exits 2 for an unknown command", async () => {
        const { exitCode, stdout } = await run(["frobnicate"], process.cwd());
        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/Unknown command: frobnicate/);
    });

    it("help mentions both check and init", async () => {
        const { stdout } = await run(["--help"], process.cwd());
        expect(stdout).toMatch(/check/);
        expect(stdout).toMatch(/init/);
    });
});

describe("run init dispatch", () => {
    it("dispatches init and writes a config (exit 0)", async () => {
        const dir = await makeVault({
            ".obsidian/plugins/propsec/data.json": JSON.stringify({
                schemaMappings: BOOK_CONFIG.schemaMappings,
                customTypes: [],
                templatesFolder: "Templates",
            }),
        });

        const { exitCode, stdout } = await run(["init", dir], process.cwd());

        expect(exitCode).toBe(0);
        const written = JSON.parse(await readFile(join(dir, "propsec.config.json"), "utf8"));
        expect(written.schemaMappings).toEqual(BOOK_CONFIG.schemaMappings);
        expect(written).not.toHaveProperty("templatesFolder");
        expect(stdout).toMatch(/1 schema, 0 custom types/);
    });

    it("init exits 2 when no propsec plugin is found", async () => {
        const dir = await makeVault({ "note.md": "hi\n" });
        const { exitCode, stdout } = await run(["init", dir], process.cwd());
        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/no propsec plugin/i);
    });
});
