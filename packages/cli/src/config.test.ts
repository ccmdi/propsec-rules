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

        expect(config.schemaMappings).toEqual([]);
        expect(config.customTypes).toEqual([]);
        expect(config.warnOnUnknownFields).toBe(true);
        expect(config.allowObsidianProperties).toBe(true);
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

        expect(config.warnOnUnknownFields).toBe(false);
        expect(config.allowObsidianProperties).toBe(false);
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
