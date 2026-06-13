// Public API for @propsec/core

export * from "./types";
export * from "./operators";

export { validateFrontmatter } from "./validation/validate";
export { validationContext } from "./validation/context";

export type * from "./query/fileMeta";
export * from "./query/matcher";
export * from "./query/targeting";

export { buildLowerKeyMap, lookupKey, hasKey } from "./utils/object";
export type { LowerKeyMap } from "./utils/object";

export { groupFieldsByName } from "./utils/schema";
