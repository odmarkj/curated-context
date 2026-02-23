import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from './prompts.js';
import type { ConversationMessage } from './transcript.js';

const execFileAsync = promisify(execFile);

function ccDir(): string {
  return process.env.CC_DIR || join(homedir(), '.curated-context');
}

function configPath(): string {
  return join(ccDir(), 'config.json');
}

export interface Memory {
  category: string;
  key: string;
  value: string;
  confidence: number;
  source?: string;
  file_pattern?: string;
}

export interface ExtractionResult {
  project_memories: Memory[];
  global_memories: Memory[];
  supersedes: string[];
}

interface ApiUsage {
  callsThisHour: number;
  hourStart: number;
  lastCallTime: number;
  callsByProject: Record<string, number>;
}

const MAX_CALLS_PER_HOUR = 30;
const MAX_CALLS_PER_SESSION = 10;
const PROJECT_COOLDOWN_MS = 60 * 1000; // 1 minute

/**
 * Classification via `claude -p` (uses Claude Code subscription, no API key needed).
 * Called when decision log + structural + triage leave gaps.
 */
export async function extractWithClaude(
  messages: ConversationMessage[],
  existingMemories: Record<string, { key: string; value: string }>,
  projectRoot: string,
): Promise<ExtractionResult | null> {
  // Check rate limits
  if (!canMakeApiCall(projectRoot)) {
    return null;
  }

  const userContent = buildExtractionPrompt(messages, existingMemories);
  const fullPrompt = `${EXTRACTION_SYSTEM_PROMPT}\n\n${userContent}`;

  try {
    const { stdout } = await execFileAsync('claude', [
      '-p', fullPrompt,
      '--output-format', 'json',
      '--max-turns', '1',
      '--model', 'sonnet',
    ], {
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    });

    recordApiCall(projectRoot);

    // claude --output-format json returns { result: "..." }
    const output = JSON.parse(stdout);
    const text = typeof output.result === 'string' ? output.result : stdout;

    return parseExtractionResponse(text);
  } catch (error) {
    // Log but don't throw — extraction is best-effort
    console.error('[cc] Claude extraction failed:', error);
    return null;
  }
}

export function parseExtractionResponse(text: string): ExtractionResult {
  // Extract JSON from response (may have surrounding text)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { project_memories: [], global_memories: [], supersedes: [] };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and filter by confidence threshold
    const result: ExtractionResult = {
      project_memories: (parsed.project_memories ?? [])
        .filter((m: Memory) => m.confidence >= 0.7)
        .slice(0, 10),
      global_memories: (parsed.global_memories ?? [])
        .filter((m: Memory) => m.confidence >= 0.7)
        .slice(0, 5),
      supersedes: parsed.supersedes ?? [],
    };

    return result;
  } catch {
    return { project_memories: [], global_memories: [], supersedes: [] };
  }
}

function loadApiUsage(): ApiUsage {
  mkdirSync(ccDir(), { recursive: true });

  try {
    if (existsSync(configPath())) {
      const config = JSON.parse(readFileSync(configPath(), 'utf8'));
      return config.apiUsage ?? createFreshUsage();
    }
  } catch {
    // Corrupted config
  }

  return createFreshUsage();
}

function saveApiUsage(usage: ApiUsage): void {
  mkdirSync(ccDir(), { recursive: true });

  let config: Record<string, unknown> = {};
  try {
    if (existsSync(configPath())) {
      config = JSON.parse(readFileSync(configPath(), 'utf8'));
    }
  } catch {
    // Start fresh
  }

  config.apiUsage = usage;
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
}

function createFreshUsage(): ApiUsage {
  return {
    callsThisHour: 0,
    hourStart: Date.now(),
    lastCallTime: 0,
    callsByProject: {},
  };
}

function canMakeApiCall(projectRoot: string): boolean {
  const usage = loadApiUsage();
  const now = Date.now();

  // Reset hourly counter if hour has passed
  if (now - usage.hourStart > 3600_000) {
    usage.callsThisHour = 0;
    usage.hourStart = now;
    usage.callsByProject = {};
    saveApiUsage(usage);
  }

  // Check hourly limit
  if (usage.callsThisHour >= MAX_CALLS_PER_HOUR) {
    return false;
  }

  // Check per-session limit (approximated by per-project count this hour)
  const projectCalls = usage.callsByProject[projectRoot] ?? 0;
  if (projectCalls >= MAX_CALLS_PER_SESSION) {
    return false;
  }

  // Check project cooldown
  if (usage.lastCallTime && now - usage.lastCallTime < PROJECT_COOLDOWN_MS) {
    return false;
  }

  return true;
}

function recordApiCall(projectRoot: string): void {
  const usage = loadApiUsage();
  const now = Date.now();

  // Reset if hour passed
  if (now - usage.hourStart > 3600_000) {
    usage.callsThisHour = 0;
    usage.hourStart = now;
    usage.callsByProject = {};
  }

  usage.callsThisHour++;
  usage.lastCallTime = now;
  usage.callsByProject[projectRoot] = (usage.callsByProject[projectRoot] ?? 0) + 1;

  saveApiUsage(usage);
}
