import { readFileSync } from 'fs';
const MAX_CONTENT_LENGTH = 50_000;
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
            const text = entry.message.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text ?? '')
                .join('\n')
                .trim();
            if (text) {
                messages.push({ role: 'user', content: text });
            }
        }
        if (entry.type === 'assistant') {
            // Extract text (skip thinking blocks)
            const text = entry.message.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text ?? '')
                .join('\n')
                .trim();
            if (text) {
                messages.push({ role: 'assistant', content: text });
            }
            // Extract tool_use events for structural extraction
            for (const block of entry.message.content) {
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