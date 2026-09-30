// Public API for @propsec/engine

export type { Position, Range } from "./position.js";
export { parseFrontmatter } from "./frontmatter.js";
export type { FieldPositions, ParsedFrontmatter } from "./frontmatter.js";
export { buildFileMeta } from "./fileMeta.js";
export type { BuildFileMetaInput } from "./fileMeta.js";
export { loadCorpus } from "./corpus.js";
export type { CorpusFile } from "./corpus.js";
export { validateCorpus } from "./validate.js";
export type { LocatedViolation } from "./validate.js";
export { buildValueIndex } from "./valueIndex.js";
export type { ValueIndex } from "./valueIndex.js";
export { computeCompletions, computeHover, keyAtPosition } from "./suggest.js";
export type { CompletionSuggestion, HoverInfo, CompletionContext } from "./suggest.js";
export { findFieldReferences, documentFieldSymbols } from "./nav.js";
export { parseQuery, executeQuery } from "./query.js";
export type { Query, QueryRow, QueryResult } from "./query.js";
