import { describe, it, expect } from "vitest";
import { describeRule } from "./describe";

describe("describeRule", () => {
    it("reads where rules in words", () => {
        expect(describeRule('file.inFolder("Books") || file.hasTag("book")')).toBe("in Books or tagged #book");
        expect(describeRule('file.folder == "Life/Instances/Daily" && file.ctime >= date("2024-09-25") && has(projects)'))
            .toBe("directly in Life/Instances/Daily and created on or after 2024-09-25 and has projects");
        expect(describeRule('(file.inFolder("Books") || file.hasTag("book")) && !has(draft) && status != "abandoned"'))
            .toBe("(in Books or tagged #book) and without draft and status is not abandoned");
        expect(describeRule('!(file.hasTag("archived") || file.inFolder("Templates"))')).toBe("not (tagged #archived or in Templates)");
        expect(describeRule('!file.inFolder("Archive")')).toBe("not in Archive");
    });

    it("reads field rules in words", () => {
        expect(describeRule("size(it) >= 1 && size(it) <= 5")).toBe("size of the value is at least 1 and size of the value is at most 5");
        expect(describeRule('it.exists(x, x.matches("^genre/"))')).toBe("some item of the value: it matches \"^genre/\"");
        expect(describeRule('status in ["done", "reading"]')).toBe("status is done or reading");
        expect(describeRule('"daily" in tags')).toBe("tags includes daily");
        expect(describeRule("started == null || it >= started")).toBe("started is empty or the value is at least started");
    });

    it("keeps what it cannot phrase as written", () => {
        expect(describeRule("rating * 2 > 7")).toBe("rating * 2 is more than 7");
        expect(describeRule("rating >")).toBe("rating >");
        expect(describeRule("")).toBe("");
    });
});
