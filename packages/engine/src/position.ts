// LSP-style 0-based positions.

export interface Position {
    line: number;       // 0-based
    character: number;  // 0-based
}

export interface Range {
    start: Position;
    end: Position;
}
