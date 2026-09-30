import { describe, it, expect } from "vitest";
import {
    compareNumbers,
    compareDates,
    compareStrings,
    evaluatePropertyOperator,
    evaluateNumericComparison,
    compareCrossFieldValues,
} from "./harness";

describe("operators", () => {









    describe("compareNumbers", () => {
        it("handles equals", () => {
            expect(compareNumbers(5, 5, "equals")).toBe(true);
            expect(compareNumbers(5, 6, "equals")).toBe(false);
        });

        it("handles not_equals", () => {
            expect(compareNumbers(5, 6, "not_equals")).toBe(true);
            expect(compareNumbers(5, 5, "not_equals")).toBe(false);
        });

        it("handles greater_than", () => {
            expect(compareNumbers(6, 5, "greater_than")).toBe(true);
            expect(compareNumbers(5, 5, "greater_than")).toBe(false);
            expect(compareNumbers(4, 5, "greater_than")).toBe(false);
        });

        it("handles less_than", () => {
            expect(compareNumbers(4, 5, "less_than")).toBe(true);
            expect(compareNumbers(5, 5, "less_than")).toBe(false);
            expect(compareNumbers(6, 5, "less_than")).toBe(false);
        });

        it("handles greater_or_equal", () => {
            expect(compareNumbers(6, 5, "greater_or_equal")).toBe(true);
            expect(compareNumbers(5, 5, "greater_or_equal")).toBe(true);
            expect(compareNumbers(4, 5, "greater_or_equal")).toBe(false);
        });

        it("handles less_or_equal", () => {
            expect(compareNumbers(4, 5, "less_or_equal")).toBe(true);
            expect(compareNumbers(5, 5, "less_or_equal")).toBe(true);
            expect(compareNumbers(6, 5, "less_or_equal")).toBe(false);
        });

        it("handles negative numbers", () => {
            expect(compareNumbers(-5, -3, "less_than")).toBe(true);
            expect(compareNumbers(-5, -5, "equals")).toBe(true);
        });

        it("handles decimals", () => {
            expect(compareNumbers(3.14, 3.14, "equals")).toBe(true);
            expect(compareNumbers(3.14, 3.15, "less_than")).toBe(true);
        });
    });

    describe("compareDates", () => {
        it("compares date timestamps", () => {
            const earlier = new Date("2024-01-01").getTime();
            const later = new Date("2024-12-31").getTime();

            expect(compareDates(earlier, later, "less_than")).toBe(true);
            expect(compareDates(later, earlier, "greater_than")).toBe(true);
            expect(compareDates(earlier, earlier, "equals")).toBe(true);
        });
    });

    describe("compareStrings", () => {
        it("handles equals", () => {
            expect(compareStrings("hello", "hello", "equals")).toBe(true);
            expect(compareStrings("hello", "world", "equals")).toBe(false);
        });

        it("handles not_equals", () => {
            expect(compareStrings("hello", "world", "not_equals")).toBe(true);
            expect(compareStrings("hello", "hello", "not_equals")).toBe(false);
        });

        it("handles lexicographic comparison", () => {
            expect(compareStrings("apple", "banana", "less_than")).toBe(true);
            expect(compareStrings("banana", "apple", "greater_than")).toBe(true);
        });

        it("is case-sensitive", () => {
            expect(compareStrings("Apple", "apple", "equals")).toBe(false);
            expect(compareStrings("Apple", "apple", "less_than")).toBe(true); // 'A' < 'a' in ASCII
        });
    });

    describe("evaluatePropertyOperator", () => {
        describe("equals/not_equals", () => {
            it("compares as strings", () => {
                expect(evaluatePropertyOperator("hello", "equals", "hello")).toBe(true);
                expect(evaluatePropertyOperator("hello", "equals", "world")).toBe(false);
                expect(evaluatePropertyOperator("hello", "not_equals", "world")).toBe(true);
                expect(evaluatePropertyOperator(123, "equals", "123")).toBe(true);
            });
        });

        describe("contains/not_contains", () => {
            it("checks substring for strings", () => {
                expect(evaluatePropertyOperator("hello world", "contains", "world")).toBe(true);
                expect(evaluatePropertyOperator("hello", "contains", "world")).toBe(false);
                expect(evaluatePropertyOperator("hello", "not_contains", "world")).toBe(true);
            });

            it("checks element for arrays", () => {
                expect(evaluatePropertyOperator(["a", "b", "c"], "contains", "b")).toBe(true);
                expect(evaluatePropertyOperator(["a", "b", "c"], "contains", "d")).toBe(false);
                expect(evaluatePropertyOperator(["a", "b", "c"], "not_contains", "d")).toBe(true);
            });

            it("converts array elements to strings for comparison", () => {
                expect(evaluatePropertyOperator([1, 2, 3], "contains", "2")).toBe(true);
            });
        });

        describe("in/not_in", () => {
            it("checks membership in a comma-separated list", () => {
                expect(evaluatePropertyOperator("conversation", "in", "conversation, source")).toBe(true);
                expect(evaluatePropertyOperator("note", "in", "conversation, source")).toBe(false);
                expect(evaluatePropertyOperator("note", "not_in", "conversation, source")).toBe(true);
            });

            it("compares by string form", () => {
                expect(evaluatePropertyOperator(3, "in", "1, 2, 3")).toBe(true);
                expect(evaluatePropertyOperator(4, "in", "1, 2, 3")).toBe(false);
            });

            it("matches any element for arrays", () => {
                expect(evaluatePropertyOperator(["a", "x"], "in", "x, y")).toBe(true);
                expect(evaluatePropertyOperator(["a", "b"], "in", "x, y")).toBe(false);
                expect(evaluatePropertyOperator(["a", "b"], "not_in", "x, y")).toBe(true);
            });

            it("treats an empty list as no match", () => {
                expect(evaluatePropertyOperator("anything", "in", "")).toBe(false);
                expect(evaluatePropertyOperator("anything", "not_in", "")).toBe(true);
            });
        });

        describe("numeric comparison", () => {
            it("compares numbers", () => {
                expect(evaluatePropertyOperator(10, "greater_than", "5")).toBe(true);
                expect(evaluatePropertyOperator(10, "less_than", "5")).toBe(false);
                expect(evaluatePropertyOperator(10, "greater_or_equal", "10")).toBe(true);
            });

            it("parses string values as numbers", () => {
                expect(evaluatePropertyOperator("10", "greater_than", "5")).toBe(true);
            });
        });
    });

    describe("evaluateNumericComparison", () => {
        it("compares numbers directly", () => {
            expect(evaluateNumericComparison(10, "greater_than", "5")).toBe(true);
            expect(evaluateNumericComparison(5, "less_than", "10")).toBe(true);
        });

        it("falls back to date comparison when not valid numbers", () => {
            // Date strings like "2024-12-31" are parsed by parseFloat as 2024
            // so they don't trigger date fallback. Use non-numeric strings instead.
            expect(evaluateNumericComparison("Dec 31, 2024", "greater_than", "Jan 1, 2024")).toBe(true);
            expect(evaluateNumericComparison("Jan 1, 2024", "less_than", "Dec 31, 2024")).toBe(true);
        });

        it("returns false when neither number nor date", () => {
            expect(evaluateNumericComparison("abc", "greater_than", "xyz")).toBe(false);
        });
    });

    describe("compareCrossFieldValues", () => {
        it("compares numbers", () => {
            expect(compareCrossFieldValues(10, 5, "greater_than")).toBe(true);
            expect(compareCrossFieldValues(5, 10, "less_than")).toBe(true);
            expect(compareCrossFieldValues(5, 5, "equals")).toBe(true);
        });

        it("compares dates", () => {
            expect(compareCrossFieldValues("2024-12-31", "2024-01-01", "greater_than")).toBe(true);
            expect(compareCrossFieldValues("2024-01-01", "2024-12-31", "less_than")).toBe(true);
        });

        it("compares Date objects", () => {
            const earlier = new Date("2024-01-01");
            const later = new Date("2024-12-31");
            expect(compareCrossFieldValues(earlier, later, "less_than")).toBe(true);
            expect(compareCrossFieldValues(later, earlier, "greater_than")).toBe(true);
        });

        it("falls back to string comparison", () => {
            expect(compareCrossFieldValues("apple", "banana", "less_than")).toBe(true);
            expect(compareCrossFieldValues("hello", "hello", "equals")).toBe(true);
        });

        it("does not parse date-like strings as numbers", () => {
            // "2024-12-31" should not be parsed as 2024
            expect(compareCrossFieldValues("2024-12-31", "2025-01-01", "less_than")).toBe(true);
        });
    });

    describe("edge cases", () => {
        it("handles empty strings", () => {
            expect(evaluatePropertyOperator("", "equals", "")).toBe(true);
            expect(evaluatePropertyOperator("hello", "contains", "")).toBe(true);
        });

        it("handles empty arrays", () => {
            expect(evaluatePropertyOperator([], "contains", "a")).toBe(false);
            expect(evaluatePropertyOperator([], "not_contains", "a")).toBe(true);
        });

        it("handles null/undefined as strings", () => {
            expect(evaluatePropertyOperator(null, "equals", "null")).toBe(true);
            expect(evaluatePropertyOperator(undefined, "equals", "undefined")).toBe(true);
        });

        it("handles boolean values as strings", () => {
            expect(evaluatePropertyOperator(true, "equals", "true")).toBe(true);
            expect(evaluatePropertyOperator(false, "equals", "false")).toBe(true);
        });

        it("handles zero correctly", () => {
            expect(compareNumbers(0, 0, "equals")).toBe(true);
            expect(compareNumbers(0, 1, "less_than")).toBe(true);
            expect(evaluatePropertyOperator(0, "equals", "0")).toBe(true);
        });

        it("handles Infinity", () => {
            expect(compareNumbers(Infinity, 1000000, "greater_than")).toBe(true);
            expect(compareNumbers(-Infinity, -1000000, "less_than")).toBe(true);
        });
    });
});
