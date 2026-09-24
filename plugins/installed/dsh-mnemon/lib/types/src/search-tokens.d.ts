/** Small deterministic tokenizer shared by local Document and Native recovery. */
export declare function lexicalSearchTokens(value: string, maximum?: number): string[];
export declare function lexicalTokenMatchCount(value: string, tokens: readonly string[]): number;
/** Require broader coverage only after a query is focused enough to support it. */
export declare function lexicalRequiredMatchCount(tokens: readonly string[]): number;
