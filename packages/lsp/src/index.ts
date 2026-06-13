// Public API for @propsec/lsp

export { startServer } from "./server.js";
export { computeDiagnostics, violationToDiagnostic } from "./diagnostics.js";
export { suggestionToCompletionItem, hoverInfoToHover } from "./completion.js";
export { findFieldRange } from "./configLocate.js";
export { CorpusStore } from "./corpusStore.js";
export { loadConfig, CONFIG_FILENAME } from "./config.js";
