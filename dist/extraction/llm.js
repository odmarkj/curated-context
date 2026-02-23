import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from './prompts.js';
const execFileAsync = promisify(execFile);
const CC_DIR = join(homedir(), '.curated-context');
const CONFIG_PATH = join(CC_DIR, 'config.json');
const MAX_CALLS_PER_HOUR = 10;
const MAX_CALLS_PER_SESSION = 3;
const PROJECT_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
/**
 * Claude API extractor — batched, rate-limited, last resort.
 * Only called when decision log + structural + triage leave gaps.
 */
export async function extractWithClaude(messages, existingMemories, projectRoot) {
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
    }
    catch (error) {
        // Log but don't throw — extraction is best-effort
        console.error('[cc] Claude extraction failed:', error);
        return null;
    }
}
function parseExtractionResponse(text) {
    // Extract JSON from response (may have surrounding text)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
        return { project_memories: [], global_memories: [], supersedes: [] };
    }
    try {
        const parsed = JSON.parse(jsonMatch[0]);
        // Validate and filter by confidence threshold
        const result = {
            project_memories: (parsed.project_memories ?? [])
                .filter((m) => m.confidence >= 0.7)
                .slice(0, 10),
            global_memories: (parsed.global_memories ?? [])
                .filter((m) => m.confidence >= 0.7)
                .slice(0, 5),
            supersedes: parsed.supersedes ?? [],
        };
        return result;
    }
    catch {
        return { project_memories: [], global_memories: [], supersedes: [] };
    }
}
function loadApiUsage() {
    mkdirSync(CC_DIR, { recursive: true });
    try {
        if (existsSync(CONFIG_PATH)) {
            const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
            return config.apiUsage ?? createFreshUsage();
        }
    }
    catch {
        // Corrupted config
    }
    return createFreshUsage();
}
function saveApiUsage(usage) {
    mkdirSync(CC_DIR, { recursive: true });
    let config = {};
    try {
        if (existsSync(CONFIG_PATH)) {
            config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
        }
    }
    catch {
        // Start fresh
    }
    config.apiUsage = usage;
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}
function createFreshUsage() {
    return {
        callsThisHour: 0,
        hourStart: Date.now(),
        lastCallTime: 0,
        callsByProject: {},
    };
}
function canMakeApiCall(projectRoot) {
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
function recordApiCall(projectRoot) {
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
//# sourceMappingURL=llm.js.map