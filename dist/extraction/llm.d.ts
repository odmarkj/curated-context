import type { ConversationMessage } from './transcript.js';
export interface Memory {
    category: string;
    key: string;
    value: string;
    confidence: number;
    source?: string;
    file_pattern?: string;
}
export interface ExtractionResult {
    project_memories: Memory[];
    global_memories: Memory[];
    supersedes: string[];
}
/**
 * Classification via `claude -p` (uses Claude Code subscription, no API key needed).
 * Called when decision log + structural + triage leave gaps.
 */
export declare function extractWithClaude(messages: ConversationMessage[], existingMemories: Record<string, {
    key: string;
    value: string;
}>, projectRoot: string): Promise<ExtractionResult | null>;
export declare function parseExtractionResponse(text: string): ExtractionResult;
//# sourceMappingURL=llm.d.ts.map