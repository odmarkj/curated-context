import { readFileSync } from 'fs';
const MAX_CONTENT_LENGTH = 150_000;
// --- Private content stripping (Phase 2.8) ---
// Explicit private tags
const PRIVATE_TAG_RE = /<private>[\s\S]*?<\/private>/gi;
// Sensitive patterns
const SENSITIVE_PATTERNS = [
    /\bsk-[a-zA-Z0-9]{20,}\b/g, // OpenAI/Anthropic API keys
    /\bAKIA[A-Z0-9]{16}\b/g, // AWS access key IDs
    /\b[a-zA-Z0-9]{40}(?=\s|$|")/g, // Generic 40-char tokens (GitHub PATs, etc.)
    /(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*['"]?[^\s'"]{8,}['"]?/gi, // key=value secrets
    /\bghp_[a-zA-Z0-9]{36}\b/g, // GitHub personal access tokens
    /\bglpat-[a-zA-Z0-9\-_]{20,}\b/g, // GitLab PATs
    /\bxox[bpars]-[a-zA-Z0-9\-]{10,}\b/g, // Slack tokens
];
/**
 * Strip private tags and sensitive patterns from text content.
 * Returns the sanitized text and a count of strippings performed.
 */
export function stripPrivateContent(text) {
    let strippedCount = 0;
    let result = text;
    // Strip explicit <private> tags
    const tagMatches = result.match(PRIVATE_TAG_RE);
    if (tagMatches) {
        strippedCount += tagMatches.length;
        result = result.replace(PRIVATE_TAG_RE, '[REDACTED]');
    }
    // Strip sensitive patterns
    for (const pattern of SENSITIVE_PATTERNS) {
        const matches = result.match(pattern);
        if (matches) {
            strippedCount += matches.length;
            result = result.replace(pattern, '[REDACTED]');
        }
    }
    return { sanitized: result, strippedCount };
}
/**
 * Recursively extract text from content blocks, including nested tool_result blocks.
 * tool_result blocks can contain a string `content` or an array of nested blocks.
 */
function extractTextFromBlocks(blocks) {
    const parts = [];
    for (const block of blocks) {
        if (block.type === 'text' && block.text) {
            parts.push(block.text);
        }
        else if (block.type === 'tool_result') {
            // tool_result.content can be a string or nested array of content blocks
            const content = block.content;
            if (typeof content === 'string') {
                parts.push(content);
            }
            else if (Array.isArray(content)) {
                parts.push(extractTextFromBlocks(content));
            }
        }
    }
    return parts.join('\n');
}
export function parseTranscript(filePath) {
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    let projectRoot = '';
    let sessionId = '';
    const messages = [];
    const toolEvents = [];
    for (const line of lines) {
        let entry;
        try {
            entry = JSON.parse(line);
        }
        catch {
            continue;
        }
        // Skip internal bookkeeping
        if (entry.type === 'queue-operation' || entry.type === 'file-history-snapshot') {
            continue;
        }
        // Capture project root from first user message with cwd
        if (entry.cwd && !projectRoot) {
            projectRoot = entry.cwd;
        }
        // Capture session ID
        if (entry.sessionId && !sessionId) {
            sessionId = entry.sessionId;
        }
        if (!entry.message?.content)
            continue;
        if (entry.type === 'user') {
            let text;
            if (typeof entry.message.content === 'string') {
                text = entry.message.content.trim();
            }
            else {
                text = extractTextFromBlocks(entry.message.content).trim();
            }
            // Skip observer meta-messages injected by claude-mem
            if (text.includes('<observed_from_primary_session>') ||
                text.includes('<local-command-caveat>')) {
                continue;
            }
            // Strip private/sensitive content before storing
            const { sanitized } = stripPrivateContent(text);
            if (sanitized) {
                messages.push({ role: 'user', content: sanitized });
            }
        }
        if (entry.type === 'assistant') {
            const contentBlocks = typeof entry.message.content === 'string'
                ? [{ type: 'text', text: entry.message.content }]
                : entry.message.content;
            // Extract text (skip thinking blocks)
            let text = contentBlocks
                .filter((c) => c.type === 'text')
                .map((c) => c.text ?? '')
                .join('\n')
                .trim();
            // Strip private/sensitive content
            const { sanitized } = stripPrivateContent(text);
            text = sanitized;
            if (text) {
                messages.push({ role: 'assistant', content: text });
            }
            // Extract tool_use events for structural extraction
            for (const block of contentBlocks) {
                if (block.type === 'tool_use' && block.name) {
                    toolEvents.push({
                        tool: block.name,
                        input: block.input ?? {},
                    });
                }
            }
        }
    }
    // Budget: if total content is too large, keep only the tail
    let totalLength = messages.reduce((sum, m) => sum + m.content.length, 0);
    while (totalLength > MAX_CONTENT_LENGTH && messages.length > 4) {
        const removed = messages.shift();
        totalLength -= removed.content.length;
    }
    return { projectRoot, sessionId, messages, toolEvents };
}
export function computeTranscriptHash(messages) {
    const content = messages.map((m) => `${m.role}:${m.content}`).join('|');
    // Simple hash — no crypto dependency needed for dedup
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
        const char = content.charCodeAt(i);
        hash = ((hash << 5) - hash + char) | 0;
    }
    return hash.toString(36);
}
//# sourceMappingURL=transcript.js.map