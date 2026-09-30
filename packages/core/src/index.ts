// Public API for @propsec/core

export * from "./model";
export { compile, matching } from "./program";
export type { CompiledSchema, Problem, Program } from "./program";

export { compileExpr, keyOf } from "./expr/compile";
export type { Expr } from "./expr/compile";
export { ExprError } from "./expr/parse";
export { cmp } from "./expr/values";
export { vocabulary } from "./expr/compile";
export type { Word, ValueKind } from "./expr/compile";

export { checkRule, completeRule, expandSnippet, helpersFor } from "./authoring";
export type { Completion, CompletionResult, RuleCheck, RuleContext, RuleSlot } from "./authoring";

export type * from "./legacy/types";
export { migrate, readConfig } from "./legacy/migrate";
