import type { ConversationMessage } from './transcript.js';
export interface TriageResult {
    shouldProcess: boolean;
    decisionScore: number;
    noiseScore: number;
    highSignalMessages: ConversationMessage[];
}
/**
 * Deterministic triage — score conversation messages by decision signal density.
 * Zero API calls. Filters out ~75% of turns.
 */
export declare function triageMessages(messages: ConversationMessage[]): TriageResult;
//# sourceMappingURL=triage.d.ts.map