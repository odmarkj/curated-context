export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}
export interface ToolEvent {
    tool: string;
    input: Record<string, unknown>;
}
export interface ParsedTranscript {
    projectRoot: string;
    sessionId: string;
    messages: ConversationMessage[];
    toolEvents: ToolEvent[];
}
export declare function parseTranscript(filePath: string): ParsedTranscript;
export declare function computeTranscriptHash(messages: ConversationMessage[]): string;
//# sourceMappingURL=transcript.d.ts.map