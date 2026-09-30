// Public API for @propsec/core

export * from "./model";
export { compile, matching } from "./program";
export type { CompiledSchema, Problem, Program } from "./program";

export { compileExpr, keyOf } from "./expr/compile";
export type { Expr } from "./expr/compile";
export { ExprError } from "./expr/parse";
export { cmp } from "./expr/values";

export * from "./legacy/types";
export * from "./legacy/operators";
export * from "./legacy/constraintMeta";
export * from "./legacy/targeting";
export * from "./legacy/fields";
export { migrate, readConfig, lowerCondition, lowerTargeting } from "./legacy/migrate";
