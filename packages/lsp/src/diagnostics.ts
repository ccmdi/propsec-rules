import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver";
import { isWarningViolation, type PropsecConfig } from "@propsec/core";
import { validateCorpus, type CorpusFile, type LocatedViolation } from "@propsec/engine";

/**
 * Map a position-aware engine violation to an LSP Diagnostic.
 * `v.range` is already LSP-shaped (0-based {line, character}), so it maps directly.
 */
export function violationToDiagnostic(v: LocatedViolation): Diagnostic {
    return {
        range: v.range,
        severity: isWarningViolation(v) ? DiagnosticSeverity.Warning : DiagnosticSeverity.Error,
        message: v.message,
        code: v.type,
        source: "propsec",
    };
}

/**
 * Validate a corpus and group the resulting diagnostics by corpus-relative file path.
 * Files with zero violations do not appear in the map (callers clear those).
 */
export function computeDiagnostics(
    files: CorpusFile[],
    config: PropsecConfig
): Map<string, Diagnostic[]> {
    const byPath = new Map<string, Diagnostic[]>();
    for (const v of validateCorpus(files, config)) {
        const list = byPath.get(v.filePath);
        const diag = violationToDiagnostic(v);
        if (list) list.push(diag);
        else byPath.set(v.filePath, [diag]);
    }
    return byPath;
}
