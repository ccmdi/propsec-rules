import { describe, it, expect } from "vitest";
import { buildConfigFromObsidian } from "./obsidian.js";

const SCHEMA = {
    id: "book",
    name: "Book",
    sourceTemplatePath: null,
    query: "Books/*",
    enabled: true,
    fields: [{ name: "title", type: "string", required: true }],
};

const CUSTOM_TYPE = {
    id: "person",
    name: "person",
    fields: [{ name: "fullName", type: "string", required: true }],
};

const RULE_SCHEMA = { id: "book", name: "Book", enabled: true, where: 'file.inFolder("Books")', fields: [{ name: "title", type: "string", required: true }] };

describe("buildConfigFromObsidian", () => {
    it("converts older plugin data to rules and drops UI-only keys", () => {
        const { config, schemaCount, customTypeCount } = buildConfigFromObsidian({
            schemaMappings: [SCHEMA],
            customTypes: [CUSTOM_TYPE],
            globalExclusions: "#status/archived",
            warnOnUnknownFields: false,
            allowObsidianProperties: false,
            // UI-only junk that must be dropped:
            templatesFolder: "Templates",
            showInStatusBar: true,
            validateOnFileOpen: true,
            colorStatusBarErrors: false,
            enablePropertySuggestions: true,
        });

        expect(config).toEqual({
            schemas: [RULE_SCHEMA],
            types: [CUSTOM_TYPE],
            exclude: 'file.hasTag("status/archived")',
            unknownFields: false,
            openFields: [],
        });
        expect(schemaCount).toBe(1);
        expect(customTypeCount).toBe(1);
    });

    it("reads current plugin data and drops UI-only keys", () => {
        const { config } = buildConfigFromObsidian({
            version: 2,
            schemas: [RULE_SCHEMA],
            types: [],
            exclude: 'file.inFolder("Templates")',
            unknownFields: true,
            openFields: ["tags"],
            templatesFolder: "Templates",
            showInStatusBar: true,
        });

        expect(config).toEqual({
            schemas: [RULE_SCHEMA],
            types: [],
            exclude: 'file.inFolder("Templates")',
            unknownFields: true,
            openFields: ["tags"],
        });
    });

    it("defaults types to [] and unknown-field warnings on when absent", () => {
        const { config, schemaCount, customTypeCount } = buildConfigFromObsidian({
            schemaMappings: [SCHEMA],
        });

        expect(config.types).toEqual([]);
        expect(config.unknownFields).toBe(true);
        expect(config.openFields).toEqual(["aliases", "tags", "cssclasses", "cssclass"]);
        expect(schemaCount).toBe(1);
        expect(customTypeCount).toBe(0);
    });

    it("omits the exclusion rule when there is none", () => {
        expect(buildConfigFromObsidian({ schemaMappings: [] }).config).not.toHaveProperty("exclude");
        expect(buildConfigFromObsidian({ schemaMappings: [], globalExclusions: "" }).config).not.toHaveProperty("exclude");
    });

    it("throws when there are no schemas", () => {
        expect(() => buildConfigFromObsidian({ customTypes: [] })).toThrow(/schemaMappings/);
        expect(() => buildConfigFromObsidian({ schemaMappings: {} })).toThrow(/schemaMappings/);
    });

    it("throws on a non-object value", () => {
        expect(() => buildConfigFromObsidian(null)).toThrow(/object/i);
        expect(() => buildConfigFromObsidian([1, 2, 3])).toThrow(/object/i);
        expect(() => buildConfigFromObsidian("string")).toThrow(/object/i);
        expect(() => buildConfigFromObsidian(42)).toThrow(/object/i);
    });
});
