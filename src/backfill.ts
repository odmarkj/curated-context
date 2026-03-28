import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { parseTranscript } from './extraction/transcript.js';
import { processSessionCore, type ProcessingStats } from './daemon/processor.js';
import { loadStore, saveStore } from './storage/memory-store.js';
import { writeRulesFiles } from './storage/rules-writer.js';
import { writeClaudeMdSection } from './storage/claude-md.js';

export interface BackfillOptions {
  projectPath: string;
  dryRun?: boolean;
  skipApi?: boolean;
  noRateLimit?: boolean;
  clear?: boolean;
  verbose?: boolean;
}

export interface BackfillReport {
  sessionsDiscovered: number;
  sessionsProcessed: number;
  sessionsSkipped: number;
  sessionsFailed: number;
  memoriesFromStructural: number;
  memoriesFromApi: number;
  apiCallsMade: number;
  totalMemories: number;
  durationMs: number;
}

interface SessionFile {
  path: string;
  sessionId: string;
  mtime: number;
  sizeBytes: number;
}

/**
 * Convert a project path to the slug format used by ~/.claude/projects/
 * e.g. /workspaces/lde-dash -> -workspaces-lde-dash
 */
export function projectToSlug(projectPath: string): string {
  return projectPath.replace(/\//g, '-');
}

/**
 * Discover claude-mem session JSONL files for a given project.
 * Returns files sorted by modification time (oldest first).
 */
export function discoverClaudeMemSessions(projectPath: string): SessionFile[] {
  const slug = projectToSlug(projectPath);
  const claudeProjectDir = join(homedir(), '.claude', 'projects', slug);

  let entries: string[];
  try {
    entries = readdirSync(claudeProjectDir);
  } catch {
    return [];
  }

  const sessions: SessionFile[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.jsonl')) continue;

    const fullPath = join(claudeProjectDir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;

      sessions.push({
        path: fullPath,
        sessionId: entry.replace('.jsonl', ''),
        mtime: stat.mtimeMs,
        sizeBytes: stat.size,
      });
    } catch {
      continue;
    }
  }

  // Sort oldest first for chronological processing
  sessions.sort((a, b) => a.mtime - b.mtime);
  return sessions;
}

/**
 * Run backfill: process claude-mem session history through curated-context's
 * extraction pipeline to retroactively build the memory store.
 */
export async function runBackfill(options: BackfillOptions): Promise<BackfillReport> {
  const startTime = Date.now();
  const { projectPath, dryRun, skipApi, noRateLimit, clear, verbose } = options;

  const report: BackfillReport = {
    sessionsDiscovered: 0,
    sessionsProcessed: 0,
    sessionsSkipped: 0,
    sessionsFailed: 0,
    memoriesFromStructural: 0,
    memoriesFromApi: 0,
    apiCallsMade: 0,
    totalMemories: 0,
    durationMs: 0,
  };

  // Discover sessions
  const sessions = discoverClaudeMemSessions(projectPath);
  report.sessionsDiscovered = sessions.length;

  if (sessions.length === 0) {
    console.log('No claude-mem session files found for this project.');
    console.log(`Looked in: ~/.claude/projects/${projectToSlug(projectPath)}/`);
    report.durationMs = Date.now() - startTime;
    return report;
  }

  console.log(`Found ${sessions.length} claude-mem sessions for ${projectPath}`);
  const totalSize = sessions.reduce((sum, s) => sum + s.sizeBytes, 0);
  console.log(`Total size: ${(totalSize / 1024).toFixed(0)}KB`);

  if (dryRun) {
    console.log('\n[dry-run] Would process the following sessions:');
    for (const session of sessions) {
      const date = new Date(session.mtime).toISOString().slice(0, 16);
      console.log(`  ${session.sessionId} (${date}, ${(session.sizeBytes / 1024).toFixed(0)}KB)`);
    }
    report.durationMs = Date.now() - startTime;
    return report;
  }

  // Clear existing memories if requested
  if (clear) {
    console.log('\nClearing existing memories for this project...');
    const emptyStore = {
      version: 1 as const,
      projectRoot: projectPath,
      memories: {},
      lastConsolidated: 0,
      lastUpdated: 0,
    };
    saveStore(projectPath, emptyStore);
    try {
      writeRulesFiles(projectPath, emptyStore);
      writeClaudeMdSection(projectPath, emptyStore);
    } catch {
      // Project directory may be read-only — store is cleared, output files skipped
    }
  }

  console.log(`\nProcessing sessions${skipApi ? ' (skipping API)' : ''}...`);

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    const date = new Date(session.mtime).toISOString().slice(0, 16);

    try {
      const transcript = parseTranscript(session.path);

      if (transcript.messages.length < 2) {
        if (verbose) {
          console.log(`  [${i + 1}/${sessions.length}] ${session.sessionId} — skipped (${transcript.messages.length} messages)`);
        }
        report.sessionsSkipped++;
        continue;
      }

      const stats: ProcessingStats = {
        sessionsProcessed: 0,
        memoriesFromDecisionLog: 0,
        memoriesFromStructural: 0,
        memoriesFromApi: 0,
        apiCallsMade: 0,
      };

      await processSessionCore(transcript, projectPath, stats, {
        skipDecisionLog: true,
        skipApi: skipApi,
        skipRateLimit: noRateLimit,
        skipOutputFiles: true,
      });

      report.sessionsProcessed++;
      report.memoriesFromStructural += stats.memoriesFromStructural;
      report.memoriesFromApi += stats.memoriesFromApi;
      report.apiCallsMade += stats.apiCallsMade;

      if (verbose) {
        const parts = [];
        if (stats.memoriesFromStructural > 0) parts.push(`${stats.memoriesFromStructural} structural`);
        if (stats.memoriesFromApi > 0) parts.push(`${stats.memoriesFromApi} api`);
        if (stats.apiCallsMade > 0) parts.push(`${stats.apiCallsMade} api calls`);
        const detail = parts.length > 0 ? parts.join(', ') : 'no new memories';
        console.log(`  [${i + 1}/${sessions.length}] ${date} — ${transcript.messages.length} msgs, ${detail}`);
      }
    } catch (error) {
      report.sessionsFailed++;
      const errMsg = error instanceof Error ? error.message : String(error);
      if (verbose) {
        console.log(`  [${i + 1}/${sessions.length}] ${session.sessionId} — FAILED: ${errMsg}`);
      } else {
        console.error(`  Failed session ${session.sessionId}: ${errMsg}`);
      }
    }
  }

  // Write output files once at the end (rules + CLAUDE.md)
  const store = loadStore(projectPath);
  report.totalMemories = Object.keys(store.memories).length;

  if (report.totalMemories > 0) {
    try {
      writeRulesFiles(projectPath, store);
      writeClaudeMdSection(projectPath, store);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.log(`\nNote: Could not write output files to project directory: ${errMsg}`);
      console.log('Memories are saved in the store and will be available when the project is writable.');
    }
  }

  report.durationMs = Date.now() - startTime;
  return report;
}

/**
 * Print a human-readable backfill report.
 */
export function printReport(report: BackfillReport): void {
  console.log('\n--- Backfill Report ---');
  console.log(`Sessions discovered: ${report.sessionsDiscovered}`);
  console.log(`Sessions processed:  ${report.sessionsProcessed}`);
  if (report.sessionsSkipped > 0) {
    console.log(`Sessions skipped:    ${report.sessionsSkipped} (too few messages)`);
  }
  if (report.sessionsFailed > 0) {
    console.log(`Sessions failed:     ${report.sessionsFailed}`);
  }
  console.log(`Memories extracted:  ${report.memoriesFromStructural} structural, ${report.memoriesFromApi} api`);
  if (report.apiCallsMade > 0) {
    console.log(`API calls made:      ${report.apiCallsMade}`);
  }
  console.log(`Total memories:      ${report.totalMemories}`);
  console.log(`Duration:            ${(report.durationMs / 1000).toFixed(1)}s`);
}
