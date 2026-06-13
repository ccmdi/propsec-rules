import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInit } from "./init.js";

const SCHEMAS = [
    {
        id: "book",
        name: "Book",
        sourceTemplatePath: null,
        query: "Books/*",
        enabled: true,
        fields: [
            { name: "title", type: "string", required: true },
            { name: "author", type: "string", required: true },
        ],
    },
    {
        id: "note",
        name: "Note",
        sourceTemplatePath: null,
        query: "#note",
        enabled: true,
        fields: [{ name: "created", type: "date", required: false }],
    },
];

const CUSTOM_TYPES = [
    {
        id: "person",
        name: "person",
        fields: [{ name: "fullName", type: "string", required: true }],
    },
];

// A realistic data.json with UI-only junk that must NOT survive into the config.
const DATA_JSON = {
    schemaMappings: SCHEMAS,
    customTypes: CUSTOM_TYPES,
    globalExclusions: "#status/archived",
    warnOnUnknownFields: true,
    allowObsidianProperties: true,
    templatesFolder: "Templates",
    showInStatusBar: true,
    colorStatusBarErrors: true,
    validateOnFileOpen: true,
    validateOnFileSave: true,
    excludeWarningsFromCount: true,
    enablePropertySuggestions: true,
};

const EXPECTED_CONFIG = {
    schemaMappings: SCHEMAS,
    customTypes: CUSTOM_TYPES,
    globalExclusions: "#status/archived",
    warnOnUnknownFields: true,
    allowObsidianProperties: true,
};

const createdDirs: string[] = [];

async function makeTmp(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "propsec-init-"));
    createdDirs.push(dir);
    return dir;
}

async function writePlugin(vault: string, pluginName: string, data: unknown): Promise<string> {
    const dir = join(vault, ".obsidian", "plugins", pluginName);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "data.json");
    await writeFile(path, JSON.stringify(data), "utf8");
    return path;
}

afterEach(async () => {
    while (createdDirs.length > 0) {
        const dir = createdDirs.pop()!;
        await rm(dir, { recursive: true, force: true });
    }
});

describe("runInit", () => {
    it("happy path: auto-detects, writes config with junk dropped, reports counts", async () => {
        const vault = await makeTmp();
        await writePlugin(vault, "propsec-dev", DATA_JSON);

        const { exitCode, stdout } = await runInit({ vaultDir: vault, force: false }, process.cwd());

        expect(exitCode).toBe(0);

        const targetPath = join(vault, "propsec.config.json");
        const written = JSON.parse(await readFile(targetPath, "utf8"));
        expect(written).toEqual(EXPECTED_CONFIG);

        // junk is gone
        expect(written).not.toHaveProperty("templatesFolder");
        expect(written).not.toHaveProperty("showInStatusBar");

        // counts + source mention
        expect(stdout).toContain("2 schemas, 1 custom type");
        expect(stdout).toContain("propsec-dev");
        expect(stdout).toContain(targetPath);

        // pretty-printed with trailing newline
        const rawTarget = await readFile(targetPath, "utf8");
        expect(rawTarget.endsWith("\n")).toBe(true);
        expect(rawTarget).toContain("\n  ");
    });

    it("--from explicit path works (ignores auto-detect)", async () => {
        const vault = await makeTmp();
        const elsewhere = await makeTmp();
        const fromPath = join(elsewhere, "custom-data.json");
        await writeFile(fromPath, JSON.stringify(DATA_JSON), "utf8");

        const { exitCode, stdout } = await runInit(
            { vaultDir: vault, from: fromPath, force: false },
            process.cwd()
        );

        expect(exitCode).toBe(0);
        expect(stdout).toContain(fromPath);

        const written = JSON.parse(await readFile(join(vault, "propsec.config.json"), "utf8"));
        expect(written).toEqual(EXPECTED_CONFIG);
    });

    it("exit 2 and lists candidates when multiple propsec plugin dirs exist", async () => {
        const vault = await makeTmp();
        const a = await writePlugin(vault, "propsec", DATA_JSON);
        const b = await writePlugin(vault, "propsec-dev", DATA_JSON);

        const { exitCode, stdout } = await runInit({ vaultDir: vault, force: false }, process.cwd());

        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/multiple/i);
        expect(stdout).toContain(a);
        expect(stdout).toContain(b);
        expect(stdout).toMatch(/--from/);
    });

    it("exit 2 when no propsec plugin data.json is found", async () => {
        const vault = await makeTmp();
        // an unrelated plugin without "propsec" in the name
        await writePlugin(vault, "dataview", DATA_JSON);

        const { exitCode, stdout } = await runInit({ vaultDir: vault, force: false }, process.cwd());

        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/no propsec plugin/i);
        expect(stdout).toMatch(/--from/);
    });

    it("ignores a propsec folder that lacks a data.json", async () => {
        const vault = await makeTmp();
        await mkdir(join(vault, ".obsidian", "plugins", "propsec"), { recursive: true });

        const { exitCode, stdout } = await runInit({ vaultDir: vault, force: false }, process.cwd());

        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/no propsec plugin/i);
    });

    it("exit 2 when target exists without --force, overwrites with --force", async () => {
        const vault = await makeTmp();
        await writePlugin(vault, "propsec", DATA_JSON);
        const targetPath = join(vault, "propsec.config.json");
        await writeFile(targetPath, JSON.stringify({ schemaMappings: ["STALE"] }), "utf8");

        const blocked = await runInit({ vaultDir: vault, force: false }, process.cwd());
        expect(blocked.exitCode).toBe(2);
        expect(blocked.stdout).toMatch(/already exists/i);
        expect(blocked.stdout).toMatch(/--force/);

        // file is untouched
        const stillStale = JSON.parse(await readFile(targetPath, "utf8"));
        expect(stillStale.schemaMappings).toEqual(["STALE"]);

        const forced = await runInit({ vaultDir: vault, force: true }, process.cwd());
        expect(forced.exitCode).toBe(0);
        const overwritten = JSON.parse(await readFile(targetPath, "utf8"));
        expect(overwritten).toEqual(EXPECTED_CONFIG);
    });

    it("exit 2 when --from path does not exist", async () => {
        const vault = await makeTmp();
        const { exitCode, stdout } = await runInit(
            { vaultDir: vault, from: join(vault, "nope.json"), force: false },
            process.cwd()
        );
        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/could not read/i);
    });

    it("exit 2 on invalid JSON in the source data.json", async () => {
        const vault = await makeTmp();
        const dir = join(vault, ".obsidian", "plugins", "propsec");
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, "data.json"), "{ not valid", "utf8");

        const { exitCode, stdout } = await runInit({ vaultDir: vault, force: false }, process.cwd());
        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/invalid json/i);
    });

    it("exit 2 when data.json has no schemaMappings", async () => {
        const vault = await makeTmp();
        await writePlugin(vault, "propsec", { customTypes: [] });

        const { exitCode, stdout } = await runInit({ vaultDir: vault, force: false }, process.cwd());
        expect(exitCode).toBe(2);
        expect(stdout).toMatch(/schemaMappings/);
    });

    it("resolves a relative vaultDir against cwd", async () => {
        const vault = await makeTmp();
        await writePlugin(vault, "propsec", DATA_JSON);

        // pass the leaf name as relative, with cwd = parent of the temp dir
        const parent = join(vault, "..");
        const leaf = vault.slice(parent.length + 1);

        const { exitCode } = await runInit({ vaultDir: leaf, force: false }, parent);
        expect(exitCode).toBe(0);

        const written = JSON.parse(await readFile(join(vault, "propsec.config.json"), "utf8"));
        expect(written).toEqual(EXPECTED_CONFIG);
    });
});
