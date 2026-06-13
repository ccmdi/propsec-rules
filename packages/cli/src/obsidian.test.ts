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

describe("buildConfigFromObsidian", () => {
    it("extracts the relevant subset and drops UI-only keys", () => {
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
            schemaMappings: [SCHEMA],
            customTypes: [CUSTOM_TYPE],
            globalExclusions: "#status/archived",
            warnOnUnknownFields: false,
            allowObsidianProperties: false,
        });
        expect(schemaCount).toBe(1);
        expect(customTypeCount).toBe(1);

        // Explicitly assert the junk is gone.
        expect(config).not.toHaveProperty("templatesFolder");
        expect(config).not.toHaveProperty("showInStatusBar");
        expect(config).not.toHaveProperty("validateOnFileOpen");
        expect(config).not.toHaveProperty("colorStatusBarErrors");
        expect(config).not.toHaveProperty("enablePropertySuggestions");
    });

    it("defaults customTypes to [] and the two booleans to true when absent", () => {
        const { config, schemaCount, customTypeCount } = buildConfigFromObsidian({
            schemaMappings: [SCHEMA],
        });

        expect(config.customTypes).toEqual([]);
        expect(config.warnOnUnknownFields).toBe(true);
        expect(config.allowObsidianProperties).toBe(true);
        expect(schemaCount).toBe(1);
        expect(customTypeCount).toBe(0);
    });

    it("defaults customTypes to [] when it is not an array", () => {
        const { config } = buildConfigFromObsidian({
            schemaMappings: [],
            customTypes: "nope",
        });
        expect(config.customTypes).toEqual([]);
    });

    it("preserves globalExclusions when a string (including empty)", () => {
        const withValue = buildConfigFromObsidian({
            schemaMappings: [],
            globalExclusions: "#archived",
        });
        expect(withValue.config.globalExclusions).toBe("#archived");

        const empty = buildConfigFromObsidian({
            schemaMappings: [],
            globalExclusions: "",
        });
        expect(empty.config.globalExclusions).toBe("");
    });

    it("omits globalExclusions when absent or not a string", () => {
        const absent = buildConfigFromObsidian({ schemaMappings: [] });
        expect(absent.config).not.toHaveProperty("globalExclusions");

        const wrongType = buildConfigFromObsidian({
            schemaMappings: [],
            globalExclusions: 123,
        });
        expect(wrongType.config).not.toHaveProperty("globalExclusions");
    });

    it("throws when schemaMappings is missing", () => {
        expect(() => buildConfigFromObsidian({ customTypes: [] })).toThrow(/schemaMappings/);
    });

    it("throws when schemaMappings is not an array", () => {
        expect(() => buildConfigFromObsidian({ schemaMappings: {} })).toThrow(/schemaMappings/);
    });

    it("throws on a non-object value", () => {
        expect(() => buildConfigFromObsidian(null)).toThrow(/object/i);
        expect(() => buildConfigFromObsidian([1, 2, 3])).toThrow(/object/i);
        expect(() => buildConfigFromObsidian("string")).toThrow(/object/i);
        expect(() => buildConfigFromObsidian(42)).toThrow(/object/i);
    });
});
