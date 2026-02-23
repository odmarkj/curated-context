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
 * Claude API extractor — batched, rate-limited, last resort.
 * Only called when decision log + structural + triage leave gaps.
 */
export declare function extractWithClaude(messages: ConversationMessage[], existingMemories: Record<string, {
    key: string;
    value: string;
}>, projectRoot: string): Promise<ExtractionResult | null>;
//# sourceMappingURL=llm.d.ts.map