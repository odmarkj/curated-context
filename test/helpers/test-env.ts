import { mkdirSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

export interface TestEnv {
  /** Root temp directory */
  base: string;
  /** Replaces ~/.curated-context */
  ccDir: string;
  /** Fake project root with .claude/ subdirectory */
  projectRoot: string;
  /** Path to sessions directory */
  sessionsDir: string;
  /** Path to store directory */
  storeDir: string;
  /** Global CLAUDE.md path */
  globalClaudeMd: string;
  /** Set env vars for all modules */
  activate(): void;
  /** Clean up temp files and restore env */
  cleanup(): void;
}

export function createTestEnv(port = 0): TestEnv {
  const base = mkdtempSync(join(tmpdir(), 'cc-test-'));
  const ccDir = join(base, '.curated-context');
  const projectRoot = join(base, 'project');
  const sessionsDir = join(ccDir, 'sessions');
  const storeDir = join(ccDir, 'store');
  const globalClaudeMd = join(base, '.claude', 'CLAUDE.md');

  mkdirSync(sessionsDir, { recursive: true });
  mkdirSync(storeDir, { recursive: true });
  mkdirSync(join(projectRoot, '.claude', 'rules'), { recursive: true });
  mkdirSync(join(base, '.claude'), { recursive: true });

  const saved: Record<string, string | undefined> = {};

  return {
    base,
    ccDir,
    projectRoot,
    sessionsDir,
    storeDir,
    globalClaudeMd,
    activate() {
      saved.CC_DIR = process.env.CC_DIR;
      saved.CC_PORT = process.env.CC_PORT;
      saved.CC_GLOBAL_CLAUDE_MD = process.env.CC_GLOBAL_CLAUDE_MD;

      process.env.CC_DIR = ccDir;
      process.env.CC_GLOBAL_CLAUDE_MD = globalClaudeMd;
      if (port > 0) {
        process.env.CC_PORT = String(port);
      }
    },
    cleanup() {
      for (const [key, val] of Object.entries(saved)) {
        if (val !== undefined) process.env[key] = val;
        else delete process.env[key];
      }
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        // best effort
      }
    },
  };
}
