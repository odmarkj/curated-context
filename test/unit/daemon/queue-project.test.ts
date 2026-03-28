import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { createContainerTestEnv, type ContainerTestEnv } from '../../helpers/container-env.js';
import { getProjectSessions, markProjectSessionProcessed } from '../../../src/daemon/queue.js';

function writeSessionEvent(dir: string, sessionId: string, event: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), JSON.stringify(event) + '\n');
}

describe('queue — project-local sessions (devcontainer)', () => {
  let env: ContainerTestEnv;

  beforeEach(() => {
    env = createContainerTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('getProjectSessions returns sessions from project .curated-context/sessions/', () => {
    const event = {
      timestamp: Date.now(),
      sessionId: 'sess-1',
      projectRoot: env.workspaceDir,
      transcriptHash: 'abc',
      messageCount: 5,
      toolEventCount: 2,
      transcriptPath: '/tmp/transcript.jsonl',
    };
    writeSessionEvent(env.projectSessionsDir, 'sess-1', event);

    const sessions = getProjectSessions(env.workspaceDir);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].sessionId).toBe('sess-1');
    expect(sessions[0].projectRoot).toBe(env.workspaceDir);
  });

  it('uses project-local transcript when container path is inaccessible', () => {
    const event = {
      timestamp: Date.now(),
      sessionId: 'sess-container',
      projectRoot: env.workspaceDir,
      transcriptHash: 'xyz',
      messageCount: 3,
      toolEventCount: 1,
      transcriptPath: '/var/folders/DOESNOTEXIST/transcript.jsonl', // container-internal path
    };
    writeSessionEvent(env.projectSessionsDir, 'sess-container', event);

    // Write project-local transcript copy (as capture.js does)
    const localTranscript = join(env.projectTranscriptsDir, 'sess-container.jsonl');
    writeFileSync(localTranscript, '{"type":"user","message":{"content":"test"}}');

    const sessions = getProjectSessions(env.workspaceDir);
    expect(sessions).toHaveLength(1);
    // Should fall back to the project-local copy
    expect(sessions[0].latestTranscriptPath).toBe(localTranscript);
  });

  it('uses project-local transcript even when original path exists', () => {
    // Project-local always wins (line 125-126 in queue.ts)
    const realTranscript = join(env.base, 'real-transcript.jsonl');
    writeFileSync(realTranscript, '{"type":"user"}');

    const event = {
      timestamp: Date.now(),
      sessionId: 'sess-both',
      projectRoot: env.workspaceDir,
      transcriptHash: 'both',
      messageCount: 1,
      toolEventCount: 0,
      transcriptPath: realTranscript,
    };
    writeSessionEvent(env.projectSessionsDir, 'sess-both', event);

    const localTranscript = join(env.projectTranscriptsDir, 'sess-both.jsonl');
    writeFileSync(localTranscript, '{"type":"user","local":true}');

    const sessions = getProjectSessions(env.workspaceDir);
    expect(sessions[0].latestTranscriptPath).toBe(localTranscript);
  });

  it('returns empty array when .curated-context/sessions/ does not exist', () => {
    const sessions = getProjectSessions('/tmp/nonexistent-project-' + Date.now());
    expect(sessions).toHaveLength(0);
  });

  it('markProjectSessionProcessed cleans up session + hash + transcript', () => {
    // Create session, hash, and transcript files
    writeFileSync(join(env.projectSessionsDir, 'sess-cleanup.jsonl'), '{}');
    writeFileSync(join(env.projectSessionsDir, 'sess-cleanup.hash'), 'abc123');
    writeFileSync(join(env.projectTranscriptsDir, 'sess-cleanup.jsonl'), '{}');

    markProjectSessionProcessed(env.workspaceDir, 'sess-cleanup');

    expect(existsSync(join(env.projectSessionsDir, 'sess-cleanup.jsonl'))).toBe(false);
    expect(existsSync(join(env.projectSessionsDir, 'sess-cleanup.hash'))).toBe(false);
    expect(existsSync(join(env.projectTranscriptsDir, 'sess-cleanup.jsonl'))).toBe(false);
  });

  it('markProjectSessionProcessed handles missing files gracefully', () => {
    // Should not throw even if files don't exist
    expect(() => markProjectSessionProcessed(env.workspaceDir, 'nonexistent-session')).not.toThrow();
  });

  it('skips malformed session files', () => {
    writeFileSync(join(env.projectSessionsDir, 'bad-sess.jsonl'), 'not valid json\n');
    const sessions = getProjectSessions(env.workspaceDir);
    expect(sessions).toHaveLength(0);
  });
});
