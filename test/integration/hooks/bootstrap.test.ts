import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createContainerTestEnv, type ContainerTestEnv } from '../../helpers/container-env.js';
import { runHook } from '../../helpers/run-hook.js';
import { makeTranscriptWithCwd } from '../../helpers/fixtures.js';

describe('capture.js — hook bootstrap (devcontainer)', () => {
  let env: ContainerTestEnv;

  beforeEach(() => {
    env = createContainerTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('copies hooks to {projectRoot}/.curated-context/hooks/', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-bootstrap',
    });

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const captureTarget = join(env.workspaceDir, '.curated-context', 'hooks', 'capture.js');
    expect(existsSync(captureTarget)).toBe(true);

    // The copied capture.js should contain the same key functions
    const content = readFileSync(captureTarget, 'utf8');
    expect(content).toContain('capture.js');
  });

  it('writes hook settings to .claude/settings.local.json', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-settings',
    });

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const settingsPath = join(env.workspaceDir, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(settings.hooks).toBeDefined();
    expect(settings.hooks.Stop).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();

    // Check that hooks reference the project-local paths
    const stopHookJson = JSON.stringify(settings.hooks.Stop);
    expect(stopHookJson).toContain('.curated-context/hooks/capture.js');

    const startHookJson = JSON.stringify(settings.hooks.SessionStart);
    expect(startHookJson).toContain('.curated-context/hooks/process.js');
  });

  it('does not duplicate hooks in existing settings.local.json', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-no-dup',
    });

    // Run twice
    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });
    await runHook('capture.js', stdinData.replace('test-no-dup', 'test-no-dup-2'), { CC_DIR: env.ccDir });

    const settingsPath = join(env.workspaceDir, '.claude', 'settings.local.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'));

    // Should have exactly 1 Stop hook entry, not 2
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it('copies plugin package to .curated-context/plugin/', async () => {
    const transcriptPath = join(env.workspaceDir, 'transcript.jsonl');
    writeFileSync(transcriptPath, makeTranscriptWithCwd(env.workspaceDir));

    const stdinData = JSON.stringify({
      transcript_path: transcriptPath,
      session_id: 'test-plugin-copy',
    });

    await runHook('capture.js', stdinData, { CC_DIR: env.ccDir });

    const pluginDir = join(env.workspaceDir, '.curated-context', 'plugin');
    // Plugin marker should exist (if .claude-plugin dir exists in source)
    const pluginMarker = join(pluginDir, '.claude-plugin', 'plugin.json');

    // Only assert if the source plugin dir exists (development vs installed)
    const sourcePluginDir = join(process.cwd(), '.claude-plugin');
    if (existsSync(sourcePluginDir)) {
      expect(existsSync(pluginMarker)).toBe(true);
    }
  });
});
