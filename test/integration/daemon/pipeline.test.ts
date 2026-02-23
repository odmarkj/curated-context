import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { startDaemon, type DaemonInstance } from '../../helpers/daemon-runner.js';
import { TRANSCRIPT_DECISIONS, DECISIONS_LOG, TRANSCRIPT_NOISE } from '../../helpers/fixtures.js';

// Use a unique port to avoid conflicts with a running daemon
const TEST_PORT = 17377;

describe('daemon pipeline', { timeout: 30_000 }, () => {
  let env: TestEnv;
  let daemon: DaemonInstance;

  beforeEach(async () => {
    env = createTestEnv(TEST_PORT);
    env.activate();

    // Exhaust the API rate limit so Tier 4 (claude -p) is never called.
    // This ensures integration tests only exercise tiers 1-3 (no external dependencies).
    writeFileSync(join(env.ccDir, 'config.json'), JSON.stringify({
      apiUsage: {
        callsThisHour: 999,
        hourStart: Date.now(),
        lastCallTime: Date.now(),
        callsByProject: {},
      },
    }));
  });

  afterEach(async () => {
    if (daemon) {
      try { await daemon.stop(); } catch { /* already stopped */ }
    }
    env.cleanup();
  });

  it('processes decision log entries into memory store and rules files', async () => {
    // Write a decisions.log
    mkdirSync(join(env.projectRoot, '.claude'), { recursive: true });
    writeFileSync(join(env.projectRoot, '.claude', 'decisions.log'), DECISIONS_LOG);

    // Create transcript fixture
    const transcriptPath = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    // Create session file
    const sessionEvent = {
      timestamp: Date.now(),
      sessionId: 'test-sess-dl',
      projectRoot: env.projectRoot,
      transcriptHash: 'abc123',
      messageCount: 4,
      toolEventCount: 3,
      transcriptPath,
    };
    writeFileSync(join(env.sessionsDir, 'test-sess-dl.jsonl'), JSON.stringify(sessionEvent) + '\n');

    // Start daemon and process
    daemon = await startDaemon({ CC_DIR: env.ccDir, CC_PORT: String(TEST_PORT) });
    await daemon.waitForReady();

    const res = await fetch(`http://localhost:${TEST_PORT}/process`, { method: 'POST' });
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.stats.sessionsProcessed).toBe(1);
    expect(body.stats.memoriesFromDecisionLog).toBe(4);

    // Verify rules files created
    const rulesDir = join(env.projectRoot, '.claude', 'rules');
    const rulesFiles = readdirSync(rulesDir).filter((f: string) => f.startsWith('cc-'));
    expect(rulesFiles.length).toBeGreaterThan(0);

    // Verify memory store exists
    const storeFiles = readdirSync(env.storeDir);
    expect(storeFiles.length).toBeGreaterThan(0);

    // Verify decisions.log was cleared
    const logContent = readFileSync(join(env.projectRoot, '.claude', 'decisions.log'), 'utf8');
    expect(logContent).toBe('');
  });

  it('extracts structural memories from tool_use events', async () => {
    const transcriptPath = join(env.projectRoot, 'transcript.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_DECISIONS);

    const sessionEvent = {
      timestamp: Date.now(),
      sessionId: 'test-sess-struct',
      projectRoot: env.projectRoot,
      transcriptHash: 'def456',
      messageCount: 4,
      toolEventCount: 3,
      transcriptPath,
    };
    writeFileSync(join(env.sessionsDir, 'test-sess-struct.jsonl'), JSON.stringify(sessionEvent) + '\n');

    daemon = await startDaemon({ CC_DIR: env.ccDir, CC_PORT: String(TEST_PORT) });
    await daemon.waitForReady();

    const res = await fetch(`http://localhost:${TEST_PORT}/process`, { method: 'POST' });
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.stats.memoriesFromStructural).toBeGreaterThan(0);
  });

  it('health endpoint returns correct stats', async () => {
    daemon = await startDaemon({ CC_DIR: env.ccDir, CC_PORT: String(TEST_PORT) });
    await daemon.waitForReady();

    const res = await fetch(`http://localhost:${TEST_PORT}/health`);
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body).toHaveProperty('uptime');
    expect(body).toHaveProperty('queueDepth');
    expect(body).toHaveProperty('isProcessing');
    expect(body.isProcessing).toBe(false);
  });

  it('noise-only transcript produces no API calls', async () => {
    const transcriptPath = join(env.projectRoot, 'transcript-noise.jsonl');
    writeFileSync(transcriptPath, TRANSCRIPT_NOISE);

    const sessionEvent = {
      timestamp: Date.now(),
      sessionId: 'test-sess-noise',
      projectRoot: env.projectRoot,
      transcriptHash: 'noise123',
      messageCount: 4,
      toolEventCount: 0,
      transcriptPath,
    };
    writeFileSync(join(env.sessionsDir, 'test-sess-noise.jsonl'), JSON.stringify(sessionEvent) + '\n');

    daemon = await startDaemon({ CC_DIR: env.ccDir, CC_PORT: String(TEST_PORT) });
    await daemon.waitForReady();

    const res = await fetch(`http://localhost:${TEST_PORT}/process`, { method: 'POST' });
    const body = await res.json();

    expect(body.status).toBe('ok');
    expect(body.stats.apiCallsMade).toBe(0);
  });
});
