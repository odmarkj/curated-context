import { writeFileSync, mkdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getMemoriesByCategory } from './memory-store.js';
const RULES_PREFIX = 'cc-';
const MAX_RULES_FILE_SIZE = 1024; // 1KB per file
/**
 * Write categorized memory files to .claude/rules/cc-<category>.md
 * For projects: <projectRoot>/.claude/rules/
 * For global (__global__): ~/.claude/rules/
 */
export function writeRulesFiles(projectRoot, store) {
    if (!projectRoot)
        return;
    const rulesDir = projectRoot === '__global__'
        ? join(homedir(), '.claude', 'rules')
        : join(projectRoot, '.claude', 'rules');
    mkdirSync(rulesDir, { recursive: true });
    const grouped = getMemoriesByCategory(store);
    const writtenCategories = new Set();
    for (const [category, memories] of Object.entries(grouped)) {
        const filename = `${RULES_PREFIX}${category}.md`;
        const filePath = join(rulesDir, filename);
        // Build content
        const isPreferences = category === 'preferences';
        const description = isPreferences
            ? 'Technology preferences inferred from usage patterns (auto-managed by curated-context). These are suggestions — offer as options, do not auto-apply.'
            : `${capitalize(category)} context (auto-managed by curated-context)`;
        let content = `---\ndescription: ${description}\n---\n\n`;
        if (isPreferences) {
            content += `_These are the developer's observed preferences. Suggest or offer as options when relevant, but do not automatically apply them._\n\n`;
        }
        for (const mem of memories) {
            const line = isPreferences
                ? `- **${mem.key}**: ${mem.value} _(preference)_\n`
                : `- **${mem.key}**: ${mem.value}\n`;
            content += line;
        }
        // Enforce size limit — trim oldest entries if too large
        if (Buffer.byteLength(content, 'utf8') > MAX_RULES_FILE_SIZE) {
            // Sort by updatedAt desc, keep adding until we hit the limit
            const sorted = [...memories].sort((a, b) => b.updatedAt - a.updatedAt);
            content = `---\ndescription: ${description}\n---\n\n`;
            if (isPreferences) {
                content += `_These are the developer's observed preferences. Suggest or offer as options when relevant, but do not automatically apply them._\n\n`;
            }
            for (const mem of sorted) {
                const line = isPreferences
                    ? `- **${mem.key}**: ${mem.value} _(preference)_\n`
                    : `- **${mem.key}**: ${mem.value}\n`;
                if (Buffer.byteLength(content + line, 'utf8') > MAX_RULES_FILE_SIZE)
                    break;
                content += line;
            }
        }
        writeFileSync(filePath, content);
        writtenCategories.add(filename);
    }
    // Clean up rule files for categories that no longer have memories
    try {
        const existingFiles = readdirSync(rulesDir).filter((f) => f.startsWith(RULES_PREFIX) && f.endsWith('.md'));
        for (const file of existingFiles) {
            if (!writtenCategories.has(file)) {
                unlinkSync(join(rulesDir, file));
            }
        }
    }
    catch {
        // Best effort cleanup
    }
}
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
//# sourceMappingURL=rules-writer.js.map