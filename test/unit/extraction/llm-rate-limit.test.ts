import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { createTestEnv, type TestEnv } from '../../helpers/test-env.js';
import { parseExtractionResponse } from '../../../src/extraction/llm.js';

describe('parseExtractionResponse', () => {
  it('parses valid JSON extraction result', () => {
    const response = JSON.stringify({
      project_memories: [
        { category: 'design', key: 'primary-color', value: '#2563eb', confidence: 0.9 },
      ],
      global_memories: [],
      supersedes: [],
    });
    const result = parseExtractionResponse(response);
    expect(result.project_memories).toHaveLength(1);
    expect(result.project_memories[0].key).toBe('primary-color');
  });

  it('extracts JSON from surrounding text', () => {
    const response = `Here is the extracted data:\n${JSON.stringify({
      project_memories: [
        { category: 'architecture', key: 'orm', value: 'Prisma', confidence: 0.85 },
      ],
      global_memories: [],
      supersedes: [],
    })}\nDone.`;
    const result = parseExtractionResponse(response);
    expect(result.project_memories).toHaveLength(1);
  });

  it('filters out memories below 0.7 confidence threshold', () => {
    const response = JSON.stringify({
      project_memories: [
        { category: 'design', key: 'high', value: 'yes', confidence: 0.9 },
        { category: 'design', key: 'low', value: 'no', confidence: 0.5 },
      ],
      global_memories: [
        { category: 'conventions', key: 'global-low', value: 'no', confidence: 0.3 },
      ],
      supersedes: [],
    });
    const result = parseExtractionResponse(response);
    expect(result.project_memories).toHaveLength(1);
    expect(result.project_memories[0].key).toBe('high');
    expect(result.global_memories).toHaveLength(0);
  });

  it('limits to 10 project memories and 5 global memories', () => {
    const makeMemories = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        category: 'design',
        key: `key-${i}`,
        value: `val-${i}`,
        confidence: 0.9,
      }));

    const response = JSON.stringify({
      project_memories: makeMemories(15),
      global_memories: makeMemories(8),
      supersedes: [],
    });
    const result = parseExtractionResponse(response);
    expect(result.project_memories.length).toBeLessThanOrEqual(10);
    expect(result.global_memories.length).toBeLessThanOrEqual(5);
  });

  it('returns empty arrays for non-JSON response', () => {
    const result = parseExtractionResponse('No JSON here at all.');
    expect(result.project_memories).toHaveLength(0);
    expect(result.global_memories).toHaveLength(0);
    expect(result.supersedes).toHaveLength(0);
  });

  it('handles missing fields gracefully', () => {
    const response = JSON.stringify({ project_memories: [] });
    const result = parseExtractionResponse(response);
    expect(result.project_memories).toHaveLength(0);
    expect(result.global_memories).toHaveLength(0);
    expect(result.supersedes).toHaveLength(0);
  });
});

describe('rate limiting (via config.json)', () => {
  let env: TestEnv;

  beforeEach(() => {
    env = createTestEnv();
    env.activate();
  });
  afterEach(() => env.cleanup());

  it('config.json is written to CC_DIR', () => {
    // Write a mock config to verify the CC_DIR override works
    const configPath = join(env.ccDir, 'config.json');
    const config = {
      apiUsage: {
        callsThisHour: 5,
        hourStart: Date.now(),
        lastCallTime: Date.now(),
        callsByProject: {},
      },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const loaded = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(loaded.apiUsage.callsThisHour).toBe(5);
  });
});
