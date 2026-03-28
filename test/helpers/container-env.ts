/**
 * Container test environment helper.
 * Extends the base test env to simulate devcontainer scenarios:
 * - Project workspace at a separate path (like /workspaces/project)
 * - Separate home directory (simulating bind-mounted ~/.claude)
 * - Project-local .curated-context/ directories
 */

import { mkdirSync, rmSync, mkdtempSync, chmodSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface ContainerTestEnv {
  /** Root temp directory */
  base: string;
  /** Simulated ~/.curated-context (central CC dir) */
  ccDir: string;
  /** Simulated project workspace (like /workspaces/project) */
  workspaceDir: string;
  /** Simulated home directory */
  homeDir: string;
  /** Simulated ~/.claude directory (bind-mounted) */
  claudeConfigDir: string;
  /** Central sessions directory */
  centralSessionsDir: string;
  /** Project-local sessions directory */
  projectSessionsDir: string;
  /** Project-local transcripts directory */
  projectTranscriptsDir: string;
  /** Set env vars for all modules */
  activate(): void;
  /** Make a path read-only to simulate bind mount constraints */
  makeReadOnly(path: string): void;
  /** Restore a path to writable */
  makeWritable(path: string): void;
  /** Clean up temp files and restore env */
  cleanup(): void;
}

export function createContainerTestEnv(): ContainerTestEnv {
  const base = mkdtempSync(join(tmpdir(), 'cc-container-test-'));

  // Simulated central CC dir (like ~/.curated-context on host)
  const ccDir = join(base, 'curated-context-home');
  const centralSessionsDir = join(ccDir, 'sessions');

  // Simulated project workspace (like /workspaces/project)
  const workspaceDir = join(base, 'workspace');

  // Simulated home directory
  const homeDir = join(base, 'home');
  const claudeConfigDir = join(homeDir, '.claude');

  // Project-local CC dirs (like <project>/.curated-context/)
  const projectSessionsDir = join(workspaceDir, '.curated-context', 'sessions');
  const projectTranscriptsDir = join(workspaceDir, '.curated-context', 'transcripts');

  // Create all directories
  mkdirSync(centralSessionsDir, { recursive: true });
  mkdirSync(projectSessionsDir, { recursive: true });
  mkdirSync(projectTranscriptsDir, { recursive: true });
  mkdirSync(join(workspaceDir, '.claude', 'rules'), { recursive: true });
  mkdirSync(claudeConfigDir, { recursive: true });
  mkdirSync(join(ccDir, 'store'), { recursive: true });

  // Create minimal .claude/settings.json
  writeFileSync(join(claudeConfigDir, 'settings.json'), '{}');

  const saved: Record<string, string | undefined> = {};
  const readOnlyPaths: string[] = [];

  return {
    base,
    ccDir,
    workspaceDir,
    homeDir,
    claudeConfigDir,
    centralSessionsDir,
    projectSessionsDir,
    projectTranscriptsDir,

    activate() {
      saved.CC_DIR = process.env.CC_DIR;
      saved.HOME = process.env.HOME;
      process.env.CC_DIR = ccDir;
      // Don't override HOME by default — only for specific tests
    },

    makeReadOnly(path: string) {
      try {
        chmodSync(path, 0o444);
        readOnlyPaths.push(path);
      } catch {
        // May fail if not owner; skip on CI as root
      }
    },

    makeWritable(path: string) {
      try {
        chmodSync(path, 0o755);
      } catch { /* best effort */ }
    },

    cleanup() {
      // Restore permissions first so rmSync can delete
      for (const p of readOnlyPaths) {
        try { chmodSync(p, 0o755); } catch { /* */ }
      }

      // Close SQLite handles
      try {
        const { closeAllDbs } = require('../../../src/storage/memory-store.js');
        closeAllDbs();
      } catch { /* */ }

      // Restore env
      for (const [key, val] of Object.entries(saved)) {
        if (val !== undefined) process.env[key] = val;
        else delete process.env[key];
      }

      try {
        rmSync(base, { recursive: true, force: true });
      } catch { /* best effort */ }
    },
  };
}
