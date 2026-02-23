import { readFileSync, writeFileSync, existsSync, renameSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getMemoriesByCategory } from './memory-store.js';
const MARKER_START = '<!-- curated-context:start -->';
const MARKER_END = '<!-- curated-context:end -->';
const MAX_SUMMARY_LENGTH = 500;
const MEMORY_PROTOCOL = `## Memory Protocol
When you make a project decision (architecture, design tokens, conventions,
API patterns, tech stack), append a one-line summary to \`.claude/decisions.log\`:
\`[category] key: value\`
Only log deliberate decisions, not exploratory steps.`;
/**
 * Write the marker-based section to CLAUDE.md.
 * projectRoot = null means global (~/.claude/CLAUDE.md).
 */
export function writeClaudeMdSection(projectRoot, store) {
    const claudeMdPath = projectRoot
        ? resolveProjectClaudeMd(projectRoot)
        : join(homedir(), '.claude', 'CLAUDE.md');
    let content = '';
    if (existsSync(claudeMdPath)) {
        try {
            content = readFileSync(claudeMdPath, 'utf8');
        }
        catch {
            content = '';
        }
    }
    // Check if user removed marker section entirely (opt-out signal)
    const hadMarkers = content.includes(MARKER_START) || content.includes(MARKER_END);
    // Generate the managed section
    const managedSection = generateManagedSection(store, !!projectRoot);
    if (content.includes(MARKER_START) && content.includes(MARKER_END)) {
        // Replace existing section
        const pattern = new RegExp(escapeRegex(MARKER_START) + '[\\s\\S]*?' + escapeRegex(MARKER_END));
        content = content.replace(pattern, managedSection);
    }
    else if (!hadMarkers) {
        // Append new section
        content = content.trimEnd() + '\n\n' + managedSection + '\n';
    }
    else {
        // Partial markers (corrupted) — append fresh
        content = content.trimEnd() + '\n\n' + managedSection + '\n';
    }
    // Atomic write
    const tmpPath = claudeMdPath + '.tmp';
    writeFileSync(tmpPath, content);
    renameSync(tmpPath, claudeMdPath);
}
function generateManagedSection(store, isProject) {
    const grouped = getMemoriesByCategory(store);
    const lines = [];
    for (const [category, memories] of Object.entries(grouped)) {
        const summaryParts = memories
            .slice(0, 5) // Max 5 per category in summary
            .map((m) => m.value);
        lines.push(`${capitalize(category)}: ${summaryParts.join(', ')}`);
    }
    let summary = lines.join('\n');
    // Enforce size limit
    if (summary.length > MAX_SUMMARY_LENGTH) {
        summary = summary.slice(0, MAX_SUMMARY_LENGTH - 3) + '...';
    }
    const parts = [MARKER_START];
    // Include memory protocol only for project CLAUDE.md
    if (isProject) {
        parts.push(MEMORY_PROTOCOL);
        parts.push('');
    }
    if (summary) {
        parts.push('## Project Context (auto-managed by curated-context)');
        parts.push('');
        parts.push(summary);
        parts.push('');
        if (isProject) {
            parts.push('_See .claude/rules/cc-*.md for details._');
        }
    }
    parts.push(MARKER_END);
    return parts.join('\n');
}
function resolveProjectClaudeMd(projectRoot) {
    // Check which location the project already uses
    const dotClaudePath = join(projectRoot, '.claude', 'CLAUDE.md');
    const rootPath = join(projectRoot, 'CLAUDE.md');
    if (existsSync(dotClaudePath))
        return dotClaudePath;
    if (existsSync(rootPath))
        return rootPath;
    // Default to root CLAUDE.md
    return rootPath;
}
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
//# sourceMappingURL=claude-md.js.map