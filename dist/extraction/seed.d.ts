/**
 * Project Seeding (Phase 2.6)
 *
 * Scans a project's config files and bootstraps memories on first encounter.
 * No LLM required — purely structural/deterministic extraction.
 */
import type { Memory } from './llm.js';
interface SeedResult {
    memories: Memory[];
    filesScanned: number;
}
/**
 * Scan a project root and extract seed memories from configs, package files, and structure.
 */
export declare function seedProject(projectRoot: string): SeedResult;
export {};
//# sourceMappingURL=seed.d.ts.map