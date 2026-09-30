import { describe, it, expect } from "vitest";
import { validateFrontmatter, validationContext, fileMatchesQuery, fileMatchesPropertyFilter } from "./harness";
import { PROPERTY_OPERATORS, COMPARISON_OPERATORS } from "../legacy/operators";
import type { CustomType, PropertyFilter, SchemaField, SchemaMapping } from "../legacy/types";
import type { FileMeta } from "../model";

function rng(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const STRINGS = ["", "a", "abc", "reading", "draft", "obj/x", "2026-01-01", "2025-12-31", "12", "4", "-3", "4.5", "Abc", "x,y", "true"];
const SCALARS: unknown[] = [...STRINGS, 0, 1, 4, 5, 7, -2, 4.5, true, false, null];
const LISTS: unknown[] = [[], ["a"], ["obj/x", "b"], [1, 2], ["a", "a"], ["reading", "draft"], [4, "4"]];
const OBJECTS: unknown[] = [{ name: "x" }, { name: "x", age: 3 }, { name: 3 }, { age: 30 }, { name: "y", extra: true }];
const NAMES = ["title", "rating", "status", "tags", "due", "start", "person"];
const TYPES = ["string", "number", "boolean", "date", "array", "object", "null", "unknown", "person"];

const PERSON: CustomType = {
    id: "p",
    name: "person",
    fields: [
        { name: "name", type: "string", required: true, stringConstraints: { minLength: 2 } },
        { name: "age", type: "number", required: false, numberConstraints: { min: 0, max: 120 } },
    ],
};

describe("differential fuzz: pure engine vs oracle", () => {
    const r = rng(20260930);
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
    const maybe = (p: number): boolean => r() < p;
    const value = (): unknown => (maybe(0.6) ? pick(SCALARS) : maybe(0.6) ? pick(LISTS) : pick(OBJECTS));

    function field(): SchemaField {
        const type = pick(TYPES);
        const f: SchemaField = { name: pick(NAMES), type, required: maybe(0.4) };
        if (!f.required && maybe(0.3)) f.warn = true;
        if (type === "string" && maybe(0.6)) {
            f.stringConstraints = {
                ...(maybe(0.4) ? { minLength: pick([0, 1, 3]) } : {}),
                ...(maybe(0.4) ? { maxLength: pick([1, 3, 5]) } : {}),
                ...(maybe(0.3) ? { pattern: pick(["^a", "b$", "[", "^\\d+$"]) } : {}),
                ...(maybe(0.3) ? { allowedValues: pick([["a", "abc"], ["reading"], []]) } : {}),
            };
        }
        if (type === "number" && maybe(0.6)) f.numberConstraints = { ...(maybe(0.5) ? { min: pick([0, 1, -5]) } : {}), ...(maybe(0.5) ? { max: pick([5, 10]) } : {}) };
        if (type === "date" && maybe(0.6)) f.dateConstraints = { ...(maybe(0.5) ? { min: pick(["2026-01-01", "bogus"]) } : {}), ...(maybe(0.5) ? { max: "2026-06-30" } : {}) };
        if (type === "array") {
            if (maybe(0.5)) f.arrayElementType = pick(["string", "number", "person"]);
            if (maybe(0.6)) {
                f.arrayConstraints = {
                    ...(maybe(0.3) ? { minItems: pick([1, 2]) } : {}),
                    ...(maybe(0.3) ? { maxItems: pick([1, 2]) } : {}),
                    ...(maybe(0.3) ? { contains: pick([["a"], ["obj/x", "b"], ["4"]]) } : {}),
                    ...(maybe(0.3) ? { containsPattern: pick([["^obj/"], ["["], ["^a$", "^b$"]]) } : {}),
                    ...(maybe(0.3) ? { allowedValues: pick([["a", "b"], ["1", "2"]]) } : {}),
                    ...(maybe(0.3) ? { uniqueItems: true } : {}),
                };
            }
        }
        if (maybe(0.2)) f.crossFieldConstraint = { operator: pick(COMPARISON_OPERATORS), field: pick(NAMES) };
        if (maybe(0.3)) {
            f.conditions = Array.from({ length: pick([1, 2]) }, () => ({ field: pick(NAMES), operator: pick(PROPERTY_OPERATORS), value: pick(STRINGS) }));
            f.conditionLogic = pick(["and", "or"] as const);
        }
        return f;
    }

    function frontmatter(): Record<string, unknown> | undefined {
        if (maybe(0.05)) return undefined;
        const fm: Record<string, unknown> = {};
        for (const name of NAMES) {
            if (maybe(0.55)) fm[maybe(0.1) ? name.toUpperCase() : name] = value();
        }
        if (maybe(0.2)) fm[pick(["extra", "aliases", "Tags"])] = value();
        return fm;
    }

    function meta(fm: Record<string, unknown> | undefined): FileMeta {
        const folder = pick(["", "Books", "Books/Old", "Journal", "Journal/Gym"]);
        const basename = pick(["Dune", "Project-1", "note", "project-x"]);
        return {
            path: folder ? `${folder}/${basename}.md` : `${basename}.md`,
            parentPath: folder,
            basename,
            mtime: pick([Date.parse("2025-06-01"), Date.parse("2026-03-01")]),
            ctime: pick([Date.parse("2024-01-01"), Date.parse("2026-01-15")]),
            frontmatter: fm,
            tags: pick([[], ["book"], ["book/scifi"], ["draft", "book"], ["books"]]),
        };
    }

    const ORDERING = ["greater_than", "less_than", "greater_or_equal", "less_or_equal"];

    function diverges(run: () => void): string | null {
        try {
            run();
            return null;
        } catch (e) {
            return e instanceof Error ? e.message : String(e);
        }
    }

    function dedupeCase(fm: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
        if (!fm) return fm;
        const seen = new Set<string>();
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(fm).reverse()) {
            if (seen.has(key.toLowerCase())) continue;
            seen.add(key.toLowerCase());
            out[key] = fm[key];
        }
        return out;
    }

    const STRING_FORM = ["equals", "not_equals", "contains", "not_contains", "in", "not_in"];

    function lookup(fm: Record<string, unknown> | undefined, name: string): unknown {
        if (!fm) return undefined;
        const key = Object.keys(fm).reverse().find(k => k.toLowerCase() === name.toLowerCase());
        return key === undefined ? undefined : fm[key];
    }

    function comparesStructure<T extends { operator: string }>(fm: Record<string, unknown> | undefined, name: (c: T) => string) {
        return (c: T): boolean => {
            const v = lookup(fm, name(c));
            return STRING_FORM.indexOf(c.operator) >= 0 && typeof v === "object";
        };
    }

    function census(n: number, sample: () => { run: (ablate: string[]) => void; ablations: string[] }): { classes: Record<string, number>; unexplained: string[] } {
        const classes: Record<string, number> = {};
        const unexplained: string[] = [];
        for (let i = 0; i < n; i++) {
            const { run, ablations } = sample();
            const failure = diverges(() => run([]));
            if (failure === null) continue;
            const cause = ablations.find((_, k) => diverges(() => run(ablations.slice(0, k + 1))) === null);
            if (cause) classes[cause] = (classes[cause] ?? 0) + 1;
            else unexplained.push(failure);
        }
        return { classes, unexplained };
    }

    function report(name: string, n: number, result: { classes: Record<string, number>; unexplained: string[] }): void {
        const total = Object.keys(result.classes).reduce((sum, k) => sum + result.classes[k], 0) + result.unexplained.length;
        console.log(`${name}: ${n} cases, ${total} diverge (${((100 * total) / n).toFixed(2)}%)`, result.classes, `unexplained: ${result.unexplained.length}`);
    }

    it("validateFrontmatter: every divergence has a known cause", () => {
        validationContext.setCustomTypes([PERSON]);
        const result = census(20000, () => {
            const fields = Array.from({ length: pick([1, 2, 3, 4]) }, field);
            const fm = frontmatter();
            const unknown = maybe(0.5);
            return {
                ablations: ["no frontmatter block", "keys differing only in case", "null/list/map values compared by string form", "cross-field comparison", "ordering in conditions"],
                run: ablate => {
                    const has = (k: string) => ablate.indexOf(k) >= 0;
                    const structural = comparesStructure<{ field: string; operator: string }>(fm, c => c.field);
                    const trimmed = fields.map(f => ({
                        ...f,
                        crossFieldConstraint: has("cross-field comparison") ? undefined : f.crossFieldConstraint,
                        conditions: f.conditions
                            ?.filter(c => !has("ordering in conditions") || ORDERING.indexOf(c.operator) < 0)
                            .filter(c => !has("null/list/map values compared by string form") || !structural(c)),
                    }));
                    const schema: SchemaMapping = { id: "s", name: "S", sourceTemplatePath: null, query: "*", enabled: true, fields: trimmed };
                    let input = has("no frontmatter block") && fm === undefined ? {} : fm;
                    if (has("keys differing only in case")) input = dedupeCase(input);
                    validateFrontmatter(input, schema, "f.md", { checkUnknownFields: unknown });
                },
            };
        });
        validationContext.setCustomTypes([]);
        report("validateFrontmatter", 20000, result);
        expect(result.unexplained.slice(0, 6).join("\n\n")).toBe("");
    });

    it("targeting queries agree on 20k random files", () => {
        const terms = ["*", "Books", "Books/*", "Journal/*", "Journal/Gym", "#book", "#draft", "#book/scifi", "Books/Old/*"];
        const failures: string[] = [];
        for (let i = 0; i < 20000; i++) {
            const parts = Array.from({ length: pick([1, 2, 3]) }, () => pick(terms));
            const joins = parts.map((p, i) => (i === 0 ? p : `${pick(["and", "or", "not", "AND", "OR"])} ${p}`));
            const failure = diverges(() => fileMatchesQuery(meta(frontmatter()), joins.join(" ")));
            if (failure) failures.push(failure);
        }
        expect(failures.slice(0, 8).join("\n\n")).toBe("");
    });

    it("property filters: every divergence has a known cause", () => {
        const result = census(20000, () => {
            const filter: PropertyFilter = {
                ...(maybe(0.2) ? { fileNamePattern: pick(["^Project-", "x$", "("]) } : {}),
                ...(maybe(0.2) ? { modifiedAfter: pick(["2026-01-01", "nope"]) } : {}),
                ...(maybe(0.2) ? { createdBefore: "2025-01-01" } : {}),
                ...(maybe(0.2) ? { hasProperty: pick(NAMES) } : {}),
                ...(maybe(0.2) ? { notHasProperty: pick(NAMES) } : {}),
                ...(maybe(0.6)
                    ? { conditions: Array.from({ length: pick([1, 2]) }, () => ({ property: pick(NAMES), operator: pick(PROPERTY_OPERATORS), value: pick(STRINGS) })) }
                    : {}),
            };
            const file = meta(frontmatter());
            return {
                ablations: ["keys differing only in case", "null/list/map values compared by string form", "ordering in conditions"],
                run: ablate => {
                    const has = (k: string) => ablate.indexOf(k) >= 0;
                    const structural = comparesStructure<{ property: string; operator: string }>(file.frontmatter, c => c.property);
                    const f = has("keys differing only in case") ? { ...file, frontmatter: dedupeCase(file.frontmatter) } : file;
                    const conditions = filter.conditions
                        ?.filter(c => !has("ordering in conditions") || ORDERING.indexOf(c.operator) < 0)
                        .filter(c => !has("null/list/map values compared by string form") || !structural(c));
                    fileMatchesPropertyFilter(f, { ...filter, conditions });
                },
            };
        });
        report("fileMatchesPropertyFilter", 20000, result);
        expect(result.unexplained.slice(0, 6).join("\n\n")).toBe("");
    });
});
