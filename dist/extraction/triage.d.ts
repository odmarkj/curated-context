import type { ConversationMessage } from './transcript.js';
export interface TriageResult {
    shouldProcess: boolean;
    decisionScore: number;
    noiseScore: number;
    highSignalMessages: ConversationMessage[];
}
/**
 * Deterministic triage — score conversation messages by decision signal density.
 * Zero API calls. Scans ALL messages and extracts those with decision signals.
 */
export declare function triageMessages(messages: ConversationMessage[]): TriageResult;
export type ConversationMode = 'casual' | 'debugging' | 'decision-heavy' | 'mixed';
/**
 * Classify a session's conversation mode based on signal density.
 * Used to gate extraction intensity — casual/debugging sessions skip Tier 4 LLM.
 */
export declare function classifyConversationMode(messages: ConversationMessage[]): ConversationMode;
//# sourceMappingURL=triage.d.ts.map