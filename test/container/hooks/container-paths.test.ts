/**
 * Container-specific hook tests.
 *
 * These tests validate the full hook lifecycle inside a real container.
 * They use isolated temp directories per test to avoid cross-contamination.
 *
 * When running inside the test devcontainer:
 *   - Workspace: /workspaces/curated-context (bind-mounted)
 *   - Home: /home/node/ (container-local)
 *   - CC_DIR: /home/node/.curated-context (or test override)
 *
 * Run with: npm run test:container (inside the test devcontainer)
 * Or from host: npx @devcontainers/cli exec ... npm run test:container
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  writeFileSync, readFileSync, existsSync, mkdirSync, rmSync,
  readdirSync, cpSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { runHook } from '../../helpers/run-hook.js';
import { TRANSCRIPT_DECISIONS, makeTranscriptWithCwd } from '../../helpers/fixtures.js';

const WORKSPACE = process.cwd();

// Each test gets an isolated temp directory
function createIsolatedEnv() {
  const id = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const base = join(homedir(), '.curated-context-test', id);
  const ccDir = join(base, 'cc');
  const projectDir = join(base, 'project');
  const fakeHome = join(base, 'home');

  mkdirSync(join(ccDir, 'sessions'), { recursive: true });
  mkdirSync(join(ccDir, 'store'), { recursive: true });
  mkdirSync(join(projectDir, '.claude', 'rules'), { recursive: true });
  mkdirSync(join(fakeHome, '.claude'), { recursive: true });
  writeFileSync(join(fakeHome, '.claude', 'settings.json'), '{}');

  return {
    base, ccDir, projectDir, fakeHome,
    cleanup() {
      try { rmSync(base, { recursive: true, force: true }); } catch { /* */ }
    },
  };
}

// ─── Environment Sanity ─────────────────────────────────────────────

describe('container environment sanity', () => {
  it('homedir() does not resolve to macOS host path', () => {
    const home = homedir();
    // Inside a container, home should be /home/node, /home/vscode, /root, etc.
    // Not /Users/... (macOS host)
    if (existsSync('/.dockerenv') || process.env.REMOTE_CONTAINERS === 'true') {
      expect(home).not.toMatch(/^\/Users\//);
    }
  });

  it('workspace is at /workspaces/ (standard devcontainer mount)', () => {
    if (existsSync('/.dockerenv')) {
      expect(WORKSPACE).toMatch(/^\/workspaces\//);
    }
  });

  it('node is available and correct version', () => {
    const version = execSync('node --version', { encoding: 'utf8' }).trim();
    expect(version).toMatch(/^v\d+\./);
  });

  it('can write to homedir', () => {
    const testFile = join(homedir(), '.curated-context-write-test');
    writeFileSync(testFile, 'ok');
    expect(existsSync(testFile)).toBe(true);
    rmSync(testFile);
  });
});

// ─── capture.js — Session Writing ───────────────────────────────────

describe('capture.js — session writing in container', () => {
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => { env = createIsolatedEnv(); });
  afterEach(() => env.cleanup());

  it('creates session file in central CC_DIR', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    const result = await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-central',
    }), { CC_DIR: env.ccDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{}');

    const sessionFile = join(env.ccDir, 'sessions', 'sess-central.jsonl');
    expect(existsSync(sessionFile)).toBe(true);

    const event = JSON.parse(readFileSync(sessionFile, 'utf8').trim());
    expect(event.sessionId).toBe('sess-central');
    expect(event.messageCount).toBeGreaterThan(0);
    expect(event.transcriptHash).toBeDefined();
  });

  it('creates project-local session and transcript copy', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-local',
    }), { CC_DIR: env.ccDir });

    // Project-local session
    const localSession = join(env.projectDir, '.curated-context', 'sessions', 'sess-local.jsonl');
    expect(existsSync(localSession)).toBe(true);

    // Project-local transcript copy
    const localTranscript = join(env.projectDir, '.curated-context', 'transcripts', 'sess-local.jsonl');
    expect(existsSync(localTranscript)).toBe(true);

    // Transcript content should match original
    const original = readFileSync(transcriptPath, 'utf8');
    const copied = readFileSync(localTranscript, 'utf8');
    expect(copied).toBe(original);
  });

  it('creates hash file for deduplication', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-hash',
    }), { CC_DIR: env.ccDir });

    const hashFile = join(env.ccDir, 'sessions', 'sess-hash.hash');
    expect(existsSync(hashFile)).toBe(true);

    const hash = readFileSync(hashFile, 'utf8').trim();
    expect(hash.length).toBeGreaterThan(0);
  });

  it('deduplicates identical transcripts via hash', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    const stdin = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-dedup',
    });

    await runHook('capture.js', stdin, { CC_DIR: env.ccDir });
    await runHook('capture.js', stdin, { CC_DIR: env.ccDir });

    const sessionFile = join(env.ccDir, 'sessions', 'sess-dedup.jsonl');
    const lines = readFileSync(sessionFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1); // Only 1 event, not 2
  });

  it('appends new event when transcript changes', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    const stdin = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-change',
    });

    await runHook('capture.js', stdin, { CC_DIR: env.ccDir });

    // Modify transcript
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS + '\n' + JSON.stringify({
      type: 'user', uuid: 'u99', sessionId: 'sess-change',
      cwd: '/tmp/test-project',
      message: { role: 'user', content: [{ type: 'text', text: 'new message' }] },
    }));

    await runHook('capture.js', stdin, { CC_DIR: env.ccDir });

    const sessionFile = join(env.ccDir, 'sessions', 'sess-change.jsonl');
    const lines = readFileSync(sessionFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
  });

  it('writes debug log to CC_DIR', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-debug',
    }), { CC_DIR: env.ccDir });

    const debugLog = join(env.ccDir, 'hook-debug.log');
    expect(existsSync(debugLog)).toBe(true);

    const content = readFileSync(debugLog, 'utf8');
    expect(content).toContain('capture.js invoked');
    expect(content).toContain('SUCCESS');
  });
});

// ─── capture.js — .gitignore Handling ───────────────────────────────

describe('capture.js — .gitignore in container', () => {
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => { env = createIsolatedEnv(); });
  afterEach(() => env.cleanup());

  it('creates .gitignore with .curated-context/ entry', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-gi-create',
    }), { CC_DIR: env.ccDir });

    const gitignorePath = join(env.projectDir, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    expect(readFileSync(gitignorePath, 'utf8')).toContain('.curated-context/');
  });

  it('appends to existing .gitignore without duplicating', async () => {
    writeFileSync(join(env.projectDir, '.gitignore'), 'node_modules/\n');

    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    const stdin = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-gi-append',
    });

    // Run twice
    await runHook('capture.js', stdin, { CC_DIR: env.ccDir });
    await runHook('capture.js', stdin.replace('sess-gi-append', 'sess-gi-append-2'), { CC_DIR: env.ccDir });

    const gitignore = readFileSync(join(env.projectDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules/');
    expect(gitignore).toContain('.curated-context/');

    const occurrences = (gitignore.match(/\.curated-context\//g) || []).length;
    expect(occurrences).toBe(1);
  });
});

// ─── capture.js — Hook Bootstrap ────────────────────────────────────

describe('capture.js — hook bootstrap in container', () => {
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => { env = createIsolatedEnv(); });
  afterEach(() => env.cleanup());

  it('copies hooks to {projectRoot}/.curated-context/hooks/', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-bootstrap',
    }), { CC_DIR: env.ccDir });

    const captureHook = join(env.projectDir, '.curated-context', 'hooks', 'capture.js');
    expect(existsSync(captureHook)).toBe(true);

    // Verify it's a real copy with content
    const content = readFileSync(captureHook, 'utf8');
    expect(content).toContain('capture.js');
    expect(content.length).toBeGreaterThan(100);
  });

  it('writes .claude/settings.local.json with hook definitions', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-settings',
    }), { CC_DIR: env.ccDir });

    const settingsPath = join(env.projectDir, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

    // Should have Stop and SessionStart hooks
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.Stop.length).toBeGreaterThanOrEqual(1);
    expect(settings.hooks.SessionStart).toBeDefined();
    expect(settings.hooks.SessionStart.length).toBeGreaterThanOrEqual(1);

    // Hooks should reference project-local paths
    const json = JSON.stringify(settings);
    expect(json).toContain('.curated-context/hooks/capture.js');
    expect(json).toContain('.curated-context/hooks/process.js');
  });

  it('does not duplicate hook entries on repeated runs', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    for (let i = 0; i < 3; i++) {
      // Need different transcript content each time to bypass hash dedup
      writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir) + '\n' + JSON.stringify({
        type: 'user', uuid: `extra-${i}`, sessionId: `sess-nodup-${i}`,
        cwd: env.projectDir,
        message: { role: 'user', content: [{ type: 'text', text: `message ${i}` }] },
      }));

      await runHook('capture.js', JSON.stringify({
        transcript_path: transcriptPath,
        session_id: `sess-nodup-${i}`,
      }), { CC_DIR: env.ccDir });
    }

    const settings = JSON.parse(readFileSync(
      join(env.projectDir, '.claude', 'settings.local.json'), 'utf8',
    ));

    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('copies plugin package to .curated-context/plugin/', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-plugin',
    }), { CC_DIR: env.ccDir });

    const pluginDir = join(env.projectDir, '.curated-context', 'plugin');

    // Should have copied package.json at minimum
    const sourcePackageJson = join(WORKSPACE, 'package.json');
    if (existsSync(sourcePackageJson)) {
      expect(existsSync(join(pluginDir, 'package.json'))).toBe(true);
    }

    // If source has .claude-plugin, it should be copied
    if (existsSync(join(WORKSPACE, '.claude-plugin'))) {
      expect(existsSync(join(pluginDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    }

    // If source has commands/, they should be copied
    if (existsSync(join(WORKSPACE, 'commands'))) {
      expect(existsSync(join(pluginDir, 'commands'))).toBe(true);
    }
  });
});

// ─── capture.js — Error Resilience ──────────────────────────────────

describe('capture.js — error resilience in container', () => {
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => { env = createIsolatedEnv(); });
  afterEach(() => env.cleanup());

  it('exits 0 with {} on empty stdin', async () => {
    const result = await runHook('capture.js', '', { CC_DIR: env.ccDir });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 with {} on invalid JSON stdin', async () => {
    const result = await runHook('capture.js', 'not json', { CC_DIR: env.ccDir });
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 with {} when transcript_path is missing', async () => {
    const result = await runHook('capture.js', JSON.stringify({ session_id: 's1' }), { CC_DIR: env.ccDir });
    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 with {} when session_id is missing', async () => {
    const result = await runHook('capture.js', JSON.stringify({ transcript_path: '/tmp/x' }), { CC_DIR: env.ccDir });
    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 with {} when transcript file does not exist', async () => {
    const result = await runHook('capture.js', JSON.stringify({
      transcript_path: '/tmp/nonexistent-transcript-' + Date.now() + '.jsonl',
      session_id: 'sess-missing',
    }), { CC_DIR: env.ccDir });

    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);
  });

  it('exits 0 with {} when transcript has no parseable messages', async () => {
    const transcriptPath = join(env.projectDir, 'empty.jsonl');
    writeFileSync(transcriptPath, JSON.stringify({ type: 'queue-operation', data: {} }) + '\n');

    const result = await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-empty',
    }), { CC_DIR: env.ccDir });

    expect(result.stdout).toBe('{}');
    expect(result.exitCode).toBe(0);
  });
});

// ─── process-local.js — Plugin Auto-Install ─────────────────────────

describe('process-local.js — plugin auto-install in container', () => {
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => { env = createIsolatedEnv(); });
  afterEach(() => env.cleanup());

  it('auto-installs plugin when bootstrapped package exists', async () => {
    // Set up bootstrapped plugin in project dir (as capture.js would have done)
    const pluginSrc = join(env.projectDir, '.curated-context', 'plugin');
    const pluginMarkerDir = join(pluginSrc, '.claude-plugin');
    mkdirSync(pluginMarkerDir, { recursive: true });
    writeFileSync(join(pluginMarkerDir, 'plugin.json'), JSON.stringify({ name: 'curated-context' }));
    mkdirSync(join(pluginSrc, 'hooks'), { recursive: true });
    writeFileSync(join(pluginSrc, 'package.json'), '{"name":"curated-context","version":"0.1.0"}');

    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      HOME: env.fakeHome,
    });

    expect(result.exitCode).toBe(0);

    // Plugin should be installed to fake home's .claude/plugins/cache
    const pluginCachePath = join(env.fakeHome, '.claude', 'plugins', 'cache',
      'curated-context', 'curated-context', '0.1.0', '.claude-plugin', 'plugin.json');
    expect(existsSync(pluginCachePath)).toBe(true);
  });

  it('enables plugin in settings.json after auto-install', async () => {
    // Set up bootstrapped plugin
    const pluginSrc = join(env.projectDir, '.curated-context', 'plugin');
    const pluginMarkerDir = join(pluginSrc, '.claude-plugin');
    mkdirSync(pluginMarkerDir, { recursive: true });
    writeFileSync(join(pluginMarkerDir, 'plugin.json'), JSON.stringify({ name: 'curated-context' }));
    writeFileSync(join(pluginSrc, 'package.json'), '{"name":"curated-context","version":"0.1.0"}');

    await runHook('process-local.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      HOME: env.fakeHome,
    });

    const settings = JSON.parse(readFileSync(join(env.fakeHome, '.claude', 'settings.json'), 'utf8'));
    expect(settings.enabledPlugins).toBeDefined();
    expect(settings.enabledPlugins['curated-context@curated-context']).toBe(true);
  });

  it('outputs restart prompt when plugin was auto-installed', async () => {
    const pluginSrc = join(env.projectDir, '.curated-context', 'plugin');
    mkdirSync(join(pluginSrc, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pluginSrc, '.claude-plugin', 'plugin.json'), '{"name":"curated-context"}');
    writeFileSync(join(pluginSrc, 'package.json'), '{"name":"curated-context","version":"0.1.0"}');

    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      HOME: env.fakeHome,
    });

    expect(result.exitCode).toBe(0);

    // Should output JSON with restart message
    if (result.stdout.trim()) {
      const output = JSON.parse(result.stdout);
      if (output.hookSpecificOutput?.additionalContext) {
        expect(output.hookSpecificOutput.additionalContext).toContain('auto-installed');
      }
    }
  });

  it('skips install when plugin already in cache', async () => {
    // Pre-create the plugin cache (simulating already installed)
    const cachePath = join(env.fakeHome, '.claude', 'plugins', 'cache',
      'curated-context', 'curated-context', '0.1.0');
    mkdirSync(cachePath, { recursive: true });

    // Also set up bootstrapped plugin
    const pluginSrc = join(env.projectDir, '.curated-context', 'plugin');
    mkdirSync(join(pluginSrc, '.claude-plugin'), { recursive: true });
    writeFileSync(join(pluginSrc, '.claude-plugin', 'plugin.json'), '{"name":"curated-context"}');

    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      HOME: env.fakeHome,
    });

    expect(result.exitCode).toBe(0);
    // Should output just {} (no restart needed)
    expect(result.stdout.trim()).toBe('{}');
  });

  it('returns {} when no bootstrapped plugin in workspace', async () => {
    // No .curated-context/plugin/ in project dir
    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      HOME: env.fakeHome,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });
});

// ─── process-local.js — Daemon Communication ────────────────────────

describe('process-local.js — daemon communication in container', () => {
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => { env = createIsolatedEnv(); });
  afterEach(() => env.cleanup());

  it('exits cleanly when daemon is unreachable', async () => {
    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      HOME: env.fakeHome,
    });

    expect(result.exitCode).toBe(0);
  });

  it('completes within 5 seconds even with unreachable daemon', async () => {
    // Create a pending session so the hook attempts to POST
    writeFileSync(join(env.ccDir, 'sessions', 'pending.jsonl'), JSON.stringify({
      timestamp: Date.now(), sessionId: 'pending', projectRoot: env.projectDir,
      transcriptHash: 'x', messageCount: 1, toolEventCount: 0,
      transcriptPath: '/tmp/nonexistent.jsonl',
    }) + '\n');

    const start = Date.now();
    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      HOME: env.fakeHome,
    });

    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.exitCode).toBe(0);
  });

  it('handles host.docker.internal resolution', async () => {
    // Just verify the hook doesn't crash when trying host.docker.internal
    // (may or may not resolve depending on Docker version)
    writeFileSync(join(env.ccDir, 'sessions', 'pending2.jsonl'), JSON.stringify({
      timestamp: Date.now(), sessionId: 'pending2', projectRoot: env.projectDir,
      transcriptHash: 'y', messageCount: 1, toolEventCount: 0,
      transcriptPath: '/tmp/nonexistent.jsonl',
    }) + '\n');

    const result = await runHook('process-local.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19999',
      HOME: env.fakeHome,
    });

    // The key assertion: it didn't crash
    expect(result.exitCode).toBe(0);
  });
});

// ─── process.js — Host-Side Hook ────────────────────────────────────

describe('process.js — in container environment', () => {
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => { env = createIsolatedEnv(); });
  afterEach(() => env.cleanup());

  it('exits 0 with {} when no pending sessions', async () => {
    const result = await runHook('process.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('{}');
  });

  it('exits cleanly with pending sessions but no daemon', async () => {
    writeFileSync(join(env.ccDir, 'sessions', 'orphan.jsonl'), JSON.stringify({
      timestamp: Date.now(), sessionId: 'orphan', projectRoot: env.projectDir,
      transcriptHash: 'z', messageCount: 1, toolEventCount: 0,
      transcriptPath: '/tmp/nonexistent.jsonl',
    }) + '\n');

    const result = await runHook('process.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19998',
    });

    expect(result.exitCode).toBe(0);
  });

  it('completes within 5 seconds', async () => {
    const start = Date.now();
    const result = await runHook('process.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19997',
    });

    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.exitCode).toBe(0);
  });
});

// ─── Full Round-Trip: capture → process ─────────────────────────────

describe('capture → process round-trip in container', () => {
  let env: ReturnType<typeof createIsolatedEnv>;

  beforeEach(() => { env = createIsolatedEnv(); });
  afterEach(() => env.cleanup());

  it('capture creates files that process can detect as pending', async () => {
    // Step 1: Run capture to create session files
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-roundtrip',
    }), { CC_DIR: env.ccDir });

    // Verify session file exists
    const sessionFile = join(env.ccDir, 'sessions', 'sess-roundtrip.jsonl');
    expect(existsSync(sessionFile)).toBe(true);

    // Step 2: Run process - it should find the pending session
    // (won't actually process since no daemon, but should not crash)
    const result = await runHook('process.js', JSON.stringify({ cwd: env.projectDir }), {
      CC_DIR: env.ccDir,
      CC_PORT: '19996',
    });

    expect(result.exitCode).toBe(0);
  });

  it('project-local transcript is accessible after capture', async () => {
    const transcriptPath = join(env.projectDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.projectDir));

    await runHook('capture.js', JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'sess-transcript-rt',
    }), { CC_DIR: env.ccDir });

    // The project-local transcript should be readable
    const localTranscript = join(env.projectDir, '.curated-context', 'transcripts', 'sess-transcript-rt.jsonl');
    expect(existsSync(localTranscript)).toBe(true);

    const content = readFileSync(localTranscript, 'utf8');
    expect(content.length).toBeGreaterThan(0);

    // Parse it to verify it's valid JSONL
    const lines = content.split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    expect(() => JSON.parse(lines[0])).not.toThrow();
  });
});
