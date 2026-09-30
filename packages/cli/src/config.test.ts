import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";

describe("loadConfig", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "propsec-config-"));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("loads a valid config and applies defaults", async () => {
        const path = join(dir, "propsec.config.json");
        await writeFile(path, JSON.stringify({ schemaMappings: [] }), "utf8");

        const config = loadConfig(path);

        expect(config.schemas).toEqual([]);
        expect(config.types).toEqual([]);
        expect(config.unknownFields).toBe(true);
        expect(config.openFields).toEqual(["aliases", "tags", "cssclasses", "cssclass"]);
    });

    it("loads the rule format as-is", async () => {
        const path = join(dir, "propsec.config.json");
        const schemas = [{ id: "b", name: "Book", enabled: true, where: 'file.inFolder("Books")', fields: [{ name: "rating", type: "number", required: true, must: "it <= 5" }] }];
        await writeFile(path, JSON.stringify({ schemas, unknownFields: false }), "utf8");

        const config = loadConfig(path);

        expect(config.schemas).toEqual(schemas);
        expect(config.unknownFields).toBe(false);
        expect(config.openFields).toEqual([]);
    });

    it("preserves explicit values over defaults", async () => {
        const path = join(dir, "propsec.config.json");
        await writeFile(
            path,
            JSON.stringify({
                schemaMappings: [],
                warnOnUnknownFields: false,
                allowObsidianProperties: false,
            }),
            "utf8"
        );

        const config = loadConfig(path);

        expect(config.unknownFields).toBe(false);
        expect(config.openFields).toEqual([]);
    });

    it("throws with the path in the message when the file is missing", () => {
        const path = join(dir, "does-not-exist.json");
        expect(() => loadConfig(path)).toThrow(path);
        expect(() => loadConfig(path)).toThrow(/not found/i);
    });

    it("throws on non-JSON content", async () => {
        const path = join(dir, "propsec.config.json");
        await writeFile(path, "{ not valid json", "utf8");

        expect(() => loadConfig(path)).toThrow(path);
        expect(() => loadConfig(path)).toThrow(/json/i);
    });

    it("throws when schemaMappings is missing", async () => {
        const path = join(dir, "propsec.config.json");
        await writeFile(path, JSON.stringify({ customTypes: [] }), "utf8");

        expect(() => loadConfig(path)).toThrow(/schemaMappings/);
    });

    it("throws when the top-level value is not an object", async () => {
        const path = join(dir, "propsec.config.json");
        await writeFile(path, JSON.stringify([1, 2, 3]), "utf8");

        expect(() => loadConfig(path)).toThrow(/object/i);
    });
});
