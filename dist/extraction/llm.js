import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionPrompt } from './prompts.js';
function ccDir() {
    return process.env.CC_DIR || join(homedir(), '.curated-context');
}
function configPath() {
    return join(ccDir(), 'config.json');
}
const MAX_CALLS_PER_HOUR = 30;
const MAX_CALLS_PER_SESSION = 10;
const PROJECT_COOLDOWN_MS = 60 * 1000; // 1 minute
/**
 * Classification via `claude -p` (uses Claude Code subscription, no API key needed).
 * Called when decision log + structural + triage leave gaps.
 */
export async function extractWithClaude(messages, existingMemories, projectRoot) {
    // Check rate limits
    if (!canMakeApiCall(projectRoot)) {
        return null;
    }
    const userContent = buildExtractionPrompt(messages, existingMemories);
    const fullPrompt = `${EXTRACTION_SYSTEM_PROMPT}\n\n${userContent}`;
    try {
        // Strip CLAUDECODE env var to avoid "cannot launch inside another session" error
        const cleanEnv = { ...process.env };
        delete cleanEnv.CLAUDECODE;
        const stdout = await runClaude(fullPrompt, cleanEnv);
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
function runClaude(prompt, env) {
    return new Promise((resolve, reject) => {
        const child = spawn('claude', [
            '-p',
            '--output-format', 'json',
            '--max-turns', '1',
            '--model', 'sonnet',
        ], {
            env,
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (data) => { stdout += data.toString(); });
        child.stderr.on('data', (data) => { stderr += data.toString(); });
        child.on('close', (code) => {
            if (code === 0) {
                resolve(stdout);
            }
            else {
                reject(new Error(`claude exited with code ${code}: ${stderr}`));
            }
        });
        child.on('error', reject);
        // Send prompt via stdin
        child.stdin.write(prompt);
        child.stdin.end();
        // Timeout after 60 seconds
        setTimeout(() => {
            child.kill('SIGTERM');
            reject(new Error('claude -p timed out after 60s'));
        }, 60_000);
    });
}
export function parseExtractionResponse(text) {
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
    mkdirSync(ccDir(), { recursive: true });
    try {
        if (existsSync(configPath())) {
            const config = JSON.parse(readFileSync(configPath(), 'utf8'));
            return config.apiUsage ?? createFreshUsage();
        }
    }
    catch {
        // Corrupted config
    }
    return createFreshUsage();
}
function saveApiUsage(usage) {
    mkdirSync(ccDir(), { recursive: true });
    let config = {};
    try {
        if (existsSync(configPath())) {
            config = JSON.parse(readFileSync(configPath(), 'utf8'));
        }
    }
    catch {
        // Start fresh
    }
    config.apiUsage = usage;
    writeFileSync(configPath(), JSON.stringify(config, null, 2));
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