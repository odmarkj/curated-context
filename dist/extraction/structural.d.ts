import type { ToolEvent } from './transcript.js';
export interface StructuralMemory {
    category: string;
    key: string;
    value: string;
    confidence: number;
    source: string;
}
/**
 * Extract structured memories from tool_use events (file writes/edits).
 * Zero API calls — pure parsing.
 */
export declare function extractStructural(toolEvents: ToolEvent[]): StructuralMemory[];
//# sourceMappingURL=structural.d.ts.map