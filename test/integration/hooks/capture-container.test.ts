import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createContainerTestEnv, type ContainerTestEnv } from '../../helpers/container-env.js';
import { runHook } from '../../helpers/run-hook.js';
import { makeTranscriptWithCwd } from '../../helpers/fixtures.js';

describe('capture.js — project-local write (devcontainer simulation)', () => {
  let env: ContainerTestEnv;

  beforeEach(() => {
    env = createContainerTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('writes session to both central and project-local dirs', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-dual-write',
    });

    const result = await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });
    expect(result.exitCode).toBe(0);

    // Central dir should have session file
    const centralFile = join(env.centralSessionsDir, 'test-dual-write.jsonl');
    expect(existsSync(centralFile)).toBe(true);

    // Project-local dir should also have session file
    const projectFile = join(env.projectSessionsDir, 'test-dual-write.jsonl');
    expect(existsSync(projectFile)).toBe(true);
  });

  it('copies raw transcript to project-local transcripts/', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-transcript-copy',
    });

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const copiedTranscript = join(env.projectTranscriptsDir, 'test-transcript-copy.jsonl');
    expect(existsSync(copiedTranscript)).toBe(true);

    // Content should match original
    const original = readFileSync(transcriptPath, 'utf8');
    const copied = readFileSync(copiedTranscript, 'utf8');
    expect(copied).toBe(original);
  });

  it('appends .curated-context/ to .gitignore', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    // Pre-create a .gitignore
    writeFileSync(join(env.workspaceDir, '.gitignore'), 'node_modules/\n');

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-gitignore',
    });

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const gitignore = readFileSync(join(env.workspaceDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('.curated-context/');
  });

  it('does not duplicate .curated-context/ in .gitignore', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    // Pre-create .gitignore that already has the entry
    writeFileSync(join(env.workspaceDir, '.gitignore'), 'node_modules/\n.curated-context/\n');

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-gitignore-nodup',
    });

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const gitignore = readFileSync(join(env.workspaceDir, '.gitignore'), 'utf8');
    const occurrences = (gitignore.match(/\.curated-context\//g) || []).length;
    expect(occurrences).toBe(1);
  });

  it('writes to central dir even when project dir write fails', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    // Make the project's .curated-context dir read-only
    // Note: this may not work when running as root (CI)
    const projectCcDir = join(env.workspaceDir, '.curated-context');
    env.makeReadOnly(projectCcDir);

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-fallback',
    });

    const result = await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });
    expect(result.exitCode).toBe(0);

    // Central should still work
    const centralFile = join(env.centralSessionsDir, 'test-fallback.jsonl');
    expect(existsSync(centralFile)).toBe(true);

    // Restore before cleanup
    env.makeWritable(projectCcDir);
  });

  it('session events contain correct metadata', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-metadata',
    });

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const centralFile = join(env.centralSessionsDir, 'test-metadata.jsonl');
    const content = readFileSync(centralFile, 'utf8').trim();
    const event = JSON.parse(content);

    expect(event.sessionId).toBe('test-metadata');
    expect(event.messageCount).toBeGreaterThan(0);
    expect(event.transcriptPath).toBe(transcriptPath);
    expect(event.transcriptHash).toBeDefined();
  });
});
