import type { MemoryStore } from './memory-store.js';
/**
 * Write categorized memory files to .claude/rules/cc-<category>.md
 * For projects: <projectRoot>/.claude/rules/
 * For global (__global__): ~/.claude/rules/
 */
export declare function writeRulesFiles(projectRoot: string, store: MemoryStore): void;
//# sourceMappingURL=rules-writer.d.ts.map